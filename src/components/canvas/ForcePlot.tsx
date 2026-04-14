import { useRef, useEffect } from 'react'
import { useAnimationFrame } from '../../hooks/useAnimationFrame'
import { useLiveDataStore } from '../../stores/liveDataStore'
import { useDeviceStore } from '../../stores/deviceStore'
import { canvas as C } from '../../lib/theme'

const WINDOW_MS = 5000
const MAX_SAMPLES = 3000
const MS_PER_PIXEL_DEFAULT = 10 // 10ms per pixel = 5s across 500px

interface Sample {
  time: number // backend Unix epoch ms
  fz: number
}

export function ForcePlot() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sizeRef = useRef({ width: 0, height: 0 })
  const samplesRef = useRef<Sample[]>([])
  const lastBufferSizeRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      canvas.width = width * devicePixelRatio
      canvas.height = height * devicePixelRatio
      sizeRef.current = { width, height }
    })
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])

  useAnimationFrame(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const { width, height } = sizeRef.current
    if (width === 0 || height === 0) return

    const dpr = devicePixelRatio
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const store = useLiveDataStore.getState()
    const bufferSize = store.frameBuffer.size
    const selectedId = useDeviceStore.getState().selectedDeviceId
    const samples = samplesRef.current

    // --- Ingest new frames ---
    if (bufferSize !== lastBufferSizeRef.current) {
      lastBufferSizeRef.current = bufferSize
      const allFrames = store.frameBuffer.toArray()
      const lastTime = samples.length > 0 ? samples[samples.length - 1].time : 0

      for (const f of allFrames) {
        if (selectedId && f.id !== selectedId) continue
        // Use backend timestamp (Unix epoch ms)
        const t = f.time
        if (!t || t <= lastTime) continue
        samples.push({ time: t, fz: f.fz })
      }

      // Trim
      if (samples.length > MAX_SAMPLES) {
        samplesRef.current = samples.slice(samples.length - MAX_SAMPLES)
      }
    }

    // --- Draw ---
    ctx.fillStyle = C.bg
    ctx.fillRect(0, 0, width, height)

    if (samples.length === 0) {
      ctx.fillStyle = C.noDataText
      ctx.font = '14px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(selectedId ? 'Waiting for data...' : 'No device selected', width / 2, height / 2)
      return
    }

    const padding = { top: 20, right: 20, bottom: 30, left: 60 }
    const plotW = width - padding.left - padding.right
    const plotH = height - padding.top - padding.bottom

    // Smooth scrolling: right edge = Date.now() minus a display lag.
    // The lag lets data arrive before it would be visible at the right edge,
    // so the line fills to the edge without jitter. Date.now() advances every
    // render frame (60fps) giving perfectly smooth scroll.
    const DISPLAY_LAG_MS = 200
    const now = Date.now() - DISPLAY_LAG_MS
    const msPerPixel = WINDOW_MS / plotW

    // Y auto-scale
    let maxFz = 0
    for (let i = samples.length - 1; i >= 0; i--) {
      const age = now - samples[i].time
      if (age > WINDOW_MS) break
      const abs = Math.abs(samples[i].fz)
      if (abs > maxFz) maxFz = abs
    }
    maxFz = Math.max(maxFz * 1.15, 10)

    // H grid + Y labels
    const monoFont = "'Geist Mono Variable', monospace"
    for (let i = 0; i <= 5; i++) {
      const y = padding.top + (plotH * i) / 5
      const val = maxFz - (maxFz * 2 * i) / 5
      // Zero line gets emphasis
      const isZero = Math.abs(val) < maxFz * 0.05
      ctx.strokeStyle = isZero ? 'rgba(142, 159, 188, 0.3)' : C.gridLine
      ctx.lineWidth = isZero ? 1 : 0.5
      ctx.beginPath()
      ctx.moveTo(padding.left, y)
      ctx.lineTo(width - padding.right, y)
      ctx.stroke()
      ctx.fillStyle = C.axisLabel
      ctx.font = `11px ${monoFont}`
      ctx.textAlign = 'right'
      ctx.fillText(`${val.toFixed(0)}N`, padding.left - 8, y + 4)
    }

    // V grid + X labels
    for (let i = 0; i <= 5; i++) {
      const x = padding.left + (plotW * i) / 5
      ctx.strokeStyle = C.gridLine
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.moveTo(x, padding.top)
      ctx.lineTo(x, padding.top + plotH)
      ctx.stroke()
    }
    ctx.fillStyle = C.axisLabel
    ctx.font = `11px ${monoFont}`
    ctx.textAlign = 'center'
    for (let i = 0; i <= 5; i++) {
      const x = padding.left + (plotW * i) / 5
      const sec = -WINDOW_SEC + (WINDOW_SEC * i) / 5
      ctx.fillText(`${sec.toFixed(1)}s`, x, height - 8)
    }

    // Clip + draw force line
    ctx.save()
    ctx.beginPath()
    ctx.rect(padding.left, padding.top, plotW, plotH)
    ctx.clip()

    // Build path points
    const points: { x: number; y: number }[] = []
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i]
      const age = now - s.time
      if (age > WINDOW_MS) continue
      if (age < 0) break

      const x = padding.left + plotW - (age / msPerPixel)
      const nFz = (s.fz + maxFz) / (2 * maxFz)
      const y = padding.top + plotH * (1 - nFz)
      points.push({ x, y })
    }

    // Zero line Y position
    const zeroY = padding.top + plotH * (1 - maxFz / (2 * maxFz))

    // --- Explicit zero baseline ---
    ctx.strokeStyle = 'rgba(142, 159, 188, 0.35)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(padding.left, zeroY)
    ctx.lineTo(padding.left + plotW, zeroY)
    ctx.stroke()

    if (points.length > 1) {
      // --- Gradient fill from curve toward zero line (clamped at zero) ---
      // For each point, the fill goes from the data point to the zero line, not past it.
      ctx.beginPath()
      ctx.moveTo(points[0].x, points[0].y)
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
      // Close to the zero line, not the bottom of the plot
      ctx.lineTo(points[points.length - 1].x, zeroY)
      ctx.lineTo(points[0].x, zeroY)
      ctx.closePath()

      // Gradient from the data side toward zero, fading out at zero
      // Determine if data is mostly above or below zero to orient the gradient
      const avgY = points.reduce((sum, p) => sum + p.y, 0) / points.length
      const dataAbove = avgY < zeroY // canvas Y is inverted
      const gradStart = dataAbove ? padding.top : padding.top + plotH
      const grad = ctx.createLinearGradient(0, gradStart, 0, zeroY)
      grad.addColorStop(0, 'rgba(0, 81, 186, 0.12)')
      grad.addColorStop(0.6, 'rgba(0, 81, 186, 0.04)')
      grad.addColorStop(1, 'rgba(0, 81, 186, 0.0)')
      ctx.fillStyle = grad
      ctx.fill()

      // --- Data line with glow ---
      ctx.shadowColor = 'rgba(0, 81, 186, 0.35)'
      ctx.shadowBlur = 4
      ctx.strokeStyle = C.dataLine
      ctx.lineWidth = 2
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(points[0].x, points[0].y)
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
      ctx.stroke()

      // Bright core line (no shadow) for that CRT/oscilloscope look
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
      ctx.strokeStyle = '#3B8EFF'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(points[0].x, points[0].y)
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
      ctx.stroke()
    }

    ctx.restore()
  })

  return (
    <div className="w-full h-full relative">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  )
}

const WINDOW_SEC = WINDOW_MS / 1000
