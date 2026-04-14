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

    // Current time = Date.now() (same epoch as backend timestamps)
    const now = Date.now()
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
    ctx.strokeStyle = C.gridLine
    ctx.lineWidth = 0.5
    for (let i = 0; i <= 5; i++) {
      const y = padding.top + (plotH * i) / 5
      ctx.beginPath()
      ctx.moveTo(padding.left, y)
      ctx.lineTo(width - padding.right, y)
      ctx.stroke()
      const val = maxFz - (maxFz * 2 * i) / 5
      ctx.fillStyle = C.axisLabel
      ctx.font = '11px sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText(`${val.toFixed(0)}N`, padding.left - 8, y + 4)
    }

    // V grid + X labels
    ctx.strokeStyle = C.gridLine
    ctx.lineWidth = 0.5
    for (let i = 0; i <= 5; i++) {
      const x = padding.left + (plotW * i) / 5
      ctx.beginPath()
      ctx.moveTo(x, padding.top)
      ctx.lineTo(x, padding.top + plotH)
      ctx.stroke()
    }
    ctx.fillStyle = C.axisLabel
    ctx.font = '11px sans-serif'
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

    ctx.strokeStyle = C.dataLine
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.beginPath()

    let started = false
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i]
      const age = now - s.time
      if (age > WINDOW_MS) continue
      if (age < 0) break // future sample (shouldn't happen)

      // Flux3 formula: x = right edge - (age / msPerPixel)
      const x = padding.left + plotW - (age / msPerPixel)
      const nFz = (s.fz + maxFz) / (2 * maxFz)
      const y = padding.top + plotH * (1 - nFz)

      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else {
        ctx.lineTo(x, y)
      }
    }
    if (started) ctx.stroke()

    ctx.restore()
  })

  return (
    <div className="w-full h-full relative">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  )
}

const WINDOW_SEC = WINDOW_MS / 1000
