import { useRef, useEffect } from 'react'
import { useAnimationFrame } from '../../hooks/useAnimationFrame'
import { useLiveDataStore } from '../../stores/liveDataStore'
import { useDeviceStore } from '../../stores/deviceStore'
import { canvas as C } from '../../lib/theme'

const WINDOW_MS = 5000
const MAX_SAMPLES = 3000
const MEDIAN_WINDOW = 5

interface Sample {
  time: number
  fx: number
  fy: number
  fz: number
}

type Axis = 'fx' | 'fy' | 'fz'

const AXIS_META: { key: Axis; label: string; line: string; core: string; glow: string; fill: string }[] = [
  { key: 'fz', label: 'FZ', line: '#0051BA', core: '#3B8EFF', glow: 'rgba(0, 81, 186, 0.35)', fill: 'rgba(0, 81, 186, 0.12)' },
  { key: 'fx', label: 'FX', line: '#00897B', core: '#00BFA5', glow: 'rgba(0, 191, 165, 0.25)', fill: 'rgba(0, 191, 165, 0.06)' },
  { key: 'fy', label: 'FY', line: '#E65100', core: '#FF9100', glow: 'rgba(255, 145, 0, 0.25)', fill: 'rgba(255, 145, 0, 0.06)' },
]

function median(arr: number[]): number {
  if (arr.length === 0) return 0
  const sorted = arr.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

interface ForcePlotProps {
  enabledAxes: Set<Axis>
  onToggleAxis: (axis: Axis) => void
}

export function ForcePlot({ enabledAxes, onToggleAxis }: ForcePlotProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sizeRef = useRef({ width: 0, height: 0 })
  const samplesRef = useRef<Sample[]>([])
  const lastBufferSizeRef = useRef(0)
  const lagEstimateRef = useRef(500)
  const enabledRef = useRef<Set<Axis>>(enabledAxes)
  const smoothedRef = useRef<Record<Axis, number[]>>({ fx: [], fy: [], fz: [] })
  // Store HUD hit regions for click handling
  const hudRectsRef = useRef<{ axis: Axis; x: number; y: number; w: number; h: number }[]>([])

  useEffect(() => { enabledRef.current = enabledAxes }, [enabledAxes])

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

  // Click handler for HUD readouts
  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    for (const hr of hudRectsRef.current) {
      if (x >= hr.x && x <= hr.x + hr.w && y >= hr.y && y <= hr.y + hr.h) {
        onToggleAxis(hr.axis)
        return
      }
    }
  }

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
    const enabled = enabledRef.current

    // --- Ingest new frames ---
    if (bufferSize !== lastBufferSizeRef.current) {
      lastBufferSizeRef.current = bufferSize
      const allFrames = store.frameBuffer.toArray()
      const lastTime = samples.length > 0 ? samples[samples.length - 1].time : 0

      for (const f of allFrames) {
        if (selectedId && f.id !== selectedId) continue
        const t = f.time
        if (!t || t <= lastTime) continue
        samples.push({ time: t, fx: f.fx, fy: f.fy, fz: f.fz })
      }

      if (samples.length > MAX_SAMPLES) {
        samplesRef.current = samples.slice(samples.length - MAX_SAMPLES)
      }

      if (samples.length > 0) {
        const newestSampleTime = samples[samples.length - 1].time
        const measuredLag = Date.now() - newestSampleTime
        lagEstimateRef.current = lagEstimateRef.current * 0.9 + (measuredLag + 50) * 0.1
      }

      // Update median smoothing for HUD values
      const smoothed = smoothedRef.current
      if (samples.length > 0) {
        const latest = samples[samples.length - 1]
        for (const axis of AXIS_META) {
          const buf = smoothed[axis.key]
          buf.push(latest[axis.key])
          if (buf.length > MEDIAN_WINDOW) buf.shift()
        }
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

    const now = Date.now() - lagEstimateRef.current
    const msPerPixel = WINDOW_MS / plotW

    // Y auto-scale across all enabled axes
    let maxVal = 0
    for (let i = samples.length - 1; i >= 0; i--) {
      const age = now - samples[i].time
      if (age > WINDOW_MS) break
      const s = samples[i]
      for (const axis of enabled) {
        const abs = Math.abs(s[axis])
        if (abs > maxVal) maxVal = abs
      }
    }
    maxVal = Math.max(maxVal * 1.15, 10)

    // H grid + Y labels
    const monoFont = "'Geist Mono Variable', monospace"
    for (let i = 0; i <= 5; i++) {
      const y = padding.top + (plotH * i) / 5
      const val = maxVal - (maxVal * 2 * i) / 5
      const isZero = Math.abs(val) < maxVal * 0.05
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

    // Clip
    ctx.save()
    ctx.beginPath()
    ctx.rect(padding.left, padding.top, plotW, plotH)
    ctx.clip()

    // Zero line
    const zeroY = padding.top + plotH * (1 - maxVal / (2 * maxVal))
    ctx.strokeStyle = 'rgba(142, 159, 188, 0.35)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(padding.left, zeroY)
    ctx.lineTo(padding.left + plotW, zeroY)
    ctx.stroke()

    // --- Draw each enabled axis ---
    const drawOrder: Axis[] = []
    if (enabled.has('fy')) drawOrder.push('fy')
    if (enabled.has('fx')) drawOrder.push('fx')
    if (enabled.has('fz')) drawOrder.push('fz')

    // Track last point Y for HUD placement
    const lastPointY: Partial<Record<Axis, number>> = {}

    for (const axis of drawOrder) {
      const meta = AXIS_META.find((m) => m.key === axis)!
      const isPrimary = axis === 'fz'

      const points: { x: number; y: number }[] = []
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i]
        const age = now - s.time
        if (age > WINDOW_MS) continue
        if (age < 0) break
        const x = padding.left + plotW - (age / msPerPixel)
        const nVal = (s[axis] + maxVal) / (2 * maxVal)
        const y = padding.top + plotH * (1 - nVal)
        points.push({ x, y })
      }

      if (points.length < 2) continue

      // Remember last point for HUD
      lastPointY[axis] = points[points.length - 1].y

      // Gradient fill
      ctx.beginPath()
      ctx.moveTo(points[0].x, points[0].y)
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
      ctx.lineTo(points[points.length - 1].x, zeroY)
      ctx.lineTo(points[0].x, zeroY)
      ctx.closePath()

      const avgY = points.reduce((sum, p) => sum + p.y, 0) / points.length
      const dataAbove = avgY < zeroY
      const gradStart = dataAbove ? padding.top : padding.top + plotH
      const grad = ctx.createLinearGradient(0, gradStart, 0, zeroY)
      grad.addColorStop(0, meta.fill)
      grad.addColorStop(0.6, meta.fill.replace(/[\d.]+\)$/, '0.03)'))
      grad.addColorStop(1, meta.fill.replace(/[\d.]+\)$/, '0.0)'))
      ctx.fillStyle = grad
      ctx.fill()

      // Line with glow
      ctx.shadowColor = meta.glow
      ctx.shadowBlur = isPrimary ? 4 : 2
      ctx.strokeStyle = meta.line
      ctx.lineWidth = isPrimary ? 2 : 1.5
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(points[0].x, points[0].y)
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
      ctx.stroke()

      // Bright core
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
      ctx.strokeStyle = meta.core
      ctx.lineWidth = isPrimary ? 1.2 : 0.8
      ctx.beginPath()
      ctx.moveTo(points[0].x, points[0].y)
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
      ctx.stroke()
    }

    ctx.restore()

    // --- HUD readouts (outside clip, overlaid on plot) ---
    const hudRects: typeof hudRectsRef.current = []
    const hudX = width - padding.right - 8 // right-aligned
    const smoothed = smoothedRef.current

    // Draw all axes (enabled show value, disabled show dimmed label)
    // Stack them top-right
    let hudIdx = 0
    for (const meta of AXIS_META) {
      const on = enabled.has(meta.key)
      const val = median(smoothed[meta.key])
      const yBase = padding.top + 8 + hudIdx * 32

      // LED dot
      const t = (performance.now() / 4000) * Math.PI * 2
      const glowR = on ? 3 + 4 * (0.5 + 0.5 * Math.sin(t)) : 0

      ctx.textAlign = 'right'

      if (on) {
        // Value text
        ctx.font = `bold 20px ${monoFont}`
        ctx.fillStyle = meta.core
        ctx.shadowColor = meta.glow
        ctx.shadowBlur = 4
        const valText = `${val.toFixed(1)}`
        ctx.fillText(valText, hudX, yBase + 16)
        ctx.shadowColor = 'transparent'
        ctx.shadowBlur = 0

        // Label + unit
        const valWidth = ctx.measureText(valText).width
        ctx.font = `10px ${monoFont}`
        ctx.fillStyle = 'rgba(142, 159, 188, 0.6)'
        ctx.fillText(`${meta.label} N`, hudX - valWidth - 6, yBase + 16)
      } else {
        // Dimmed label only
        ctx.font = `12px ${monoFont}`
        ctx.fillStyle = 'rgba(142, 159, 188, 0.25)'
        ctx.fillText(meta.label, hudX, yBase + 14)
      }

      // LED dot to the right of the text
      const dotX = hudX + 10
      const dotY = yBase + 12
      ctx.beginPath()
      ctx.arc(dotX, dotY, 3, 0, Math.PI * 2)
      ctx.fillStyle = on ? meta.core : '#333'
      ctx.fill()
      if (on && glowR > 0) {
        ctx.shadowColor = `${meta.core}80`
        ctx.shadowBlur = glowR
        ctx.beginPath()
        ctx.arc(dotX, dotY, 3, 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowColor = 'transparent'
        ctx.shadowBlur = 0
      }

      // Hit region (in CSS pixels for click handler)
      hudRects.push({
        axis: meta.key,
        x: (hudX - 100) , // generous click area
        y: yBase - 2,
        w: 120,
        h: 28,
      })

      hudIdx++
    }
    hudRectsRef.current = hudRects
  })

  return (
    <div className="w-full h-full relative">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        className="absolute inset-0 w-full h-full cursor-pointer"
      />
    </div>
  )
}

const WINDOW_SEC = WINDOW_MS / 1000
