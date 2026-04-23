import { useRef, useEffect } from 'react'
import { useAnimationFrame } from '../../hooks/useAnimationFrame'
import { useLiveDataStore } from '../../stores/liveDataStore'
import { useDeviceStore } from '../../stores/deviceStore'
import { canvas as C } from '../../lib/theme'
import { type Axis, type DataMode, getModeConfig, extractAxisValue } from '../../lib/dataMode'
import { deviceTypeFromAxfId, rotateForDevice } from '../../lib/deviceIds'

const WINDOW_MS = 5000
const MAX_SAMPLES = 3000

interface Sample {
  time: number
  values: Record<Axis, number>
}

interface ForcePlotProps {
  mode: DataMode
  enabledAxes: Set<Axis>
}

export function ForcePlot({ mode, enabledAxes }: ForcePlotProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sizeRef = useRef({ width: 0, height: 0 })
  const samplesRef = useRef<Sample[]>([])
  const lagEstimateRef = useRef(500)
  const enabledRef = useRef<Set<Axis>>(enabledAxes)
  const modeRef = useRef<DataMode>(mode)

  useEffect(() => { modeRef.current = mode }, [mode])
  // Smoothed Y-axis bounds (asymmetric). Each eases toward its own target.
  const renderedMaxRef = useRef(10)
  const renderedMinRef = useRef(-10)
  const lastRenderTimeRef = useRef(performance.now())

  useEffect(() => { enabledRef.current = enabledAxes }, [enabledAxes])

  // Reset the plot buffer when the selected device changes so we don't trail
  // the previous device's data into the new one.
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId)
  useEffect(() => {
    samplesRef.current = []
  }, [selectedDeviceId])

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
    const selectedId = useDeviceStore.getState().selectedDeviceId
    const samples = samplesRef.current
    const enabled = enabledRef.current

    // --- Ingest new frames (store all 6 axis values regardless of mode) ---
    // Note: we must iterate every RAF, not gate on buffer size. Once the ring
    // buffer fills (~5s at 1kHz), size stays constant and size-change checks
    // would silently stop ingesting while data keeps streaming.
    const allFrames = store.frameBuffer.toArray()
    const lastTime = samples.length > 0 ? samples[samples.length - 1].time : 0
    let newSamples = 0
    // Device-specific axis correction (XL plates mounted 90° CCW)
    const deviceType = selectedId ? deviceTypeFromAxfId(selectedId) : ''
    for (const f of allFrames) {
      // Only show data for the currently selected device. No selection = no data.
      if (!selectedId || f.id !== selectedId) continue
      const t = f.time
      if (!t || t <= lastTime) continue
      const [fx, fy] = rotateForDevice(f.fx, f.fy, deviceType)
      const [mx, my] = rotateForDevice(f.moments.x, f.moments.y, deviceType)
      samples.push({
        time: t,
        values: {
          fx, fy, fz: f.fz,
          mx, my, mz: f.moments.z,
        },
      })
      newSamples++
    }

    if (samples.length > MAX_SAMPLES) {
      samplesRef.current = samples.slice(samples.length - MAX_SAMPLES)
    }

    if (newSamples > 0 && samples.length > 0) {
      const newestSampleTime = samples[samples.length - 1].time
      const measuredLag = Date.now() - newestSampleTime
      lagEstimateRef.current = lagEstimateRef.current * 0.9 + (measuredLag + 50) * 0.1
    }

    // --- Draw ---
    // Subtle panel surface so the plot reads as a deliberate panel, not empty space
    ctx.fillStyle = '#1A1A1A'
    ctx.fillRect(0, 0, width, height)

    if (samples.length === 0) {
      ctx.fillStyle = C.noDataText
      ctx.font = "13px 'Geist Variable', system-ui, sans-serif"
      ctx.textAlign = 'center'
      ctx.fillText(selectedId ? 'Waiting for data...' : 'No device selected', width / 2, height / 2)
      return
    }

    const padding = { top: 36, right: 16, bottom: 26, left: 44 }
    const plotW = width - padding.left - padding.right
    const plotH = height - padding.top - padding.bottom

    const now = Date.now() - lagEstimateRef.current
    const msPerPixel = WINDOW_MS / plotW

    // Y auto-scale: track raw min AND max separately (asymmetric).
    let rawMin = 0
    let rawMax = 0
    for (let i = samples.length - 1; i >= 0; i--) {
      const age = now - samples[i].time
      if (age > WINDOW_MS) break
      const s = samples[i]
      for (const axis of enabled) {
        const v = s.values[axis]
        if (v > rawMax) rawMax = v
        if (v < rawMin) rawMin = v
      }
    }
    // Targets with 15% headroom on each side; ensure at least a small minimum span.
    const MIN_HALF_SPAN = 5
    const targetMax = Math.max(rawMax * 1.15, MIN_HALF_SPAN)
    const targetMin = Math.min(rawMin * 1.15, -MIN_HALF_SPAN)

    // Asymmetric time-constant smoothing on both bounds:
    // - Ease OUT fast when data grows (so line stays on screen)
    // - Ease IN slowly when data shrinks
    const UP_TIME_CONSTANT = 0.04
    const DOWN_TIME_CONSTANT = 0.4
    const nowMs = performance.now()
    const dt = Math.min(0.1, (nowMs - lastRenderTimeRef.current) / 1000)
    lastRenderTimeRef.current = nowMs

    const renderedMax = renderedMaxRef.current
    const tcMax = targetMax >= renderedMax ? UP_TIME_CONSTANT : DOWN_TIME_CONSTANT
    const alphaMax = 1 - Math.exp(-dt / tcMax)
    renderedMaxRef.current = renderedMax + (targetMax - renderedMax) * alphaMax
    if (renderedMaxRef.current < rawMax) renderedMaxRef.current = rawMax

    const renderedMin = renderedMinRef.current
    const tcMin = targetMin <= renderedMin ? UP_TIME_CONSTANT : DOWN_TIME_CONSTANT
    const alphaMin = 1 - Math.exp(-dt / tcMin)
    renderedMinRef.current = renderedMin + (targetMin - renderedMin) * alphaMin
    if (renderedMinRef.current > rawMin) renderedMinRef.current = rawMin

    const yMax = renderedMaxRef.current
    const yMin = renderedMinRef.current
    const yRange = yMax - yMin

    // Back-compat for existing code that used `maxVal` for symmetric math.
    // maxVal represents the larger absolute bound so some legacy references still work.
    const maxVal = Math.max(Math.abs(yMax), Math.abs(yMin))

    const sansFont = "'Geist Variable', system-ui, sans-serif"

    // --- Nice-number step for y-axis (lines at round values) ---
    // Target ~4 lines across the full visible range.
    const rawStep = yRange / 4
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)))
    const norm = rawStep / mag
    let niceStep: number
    if (norm < 1.5) niceStep = 1 * mag
    else if (norm < 3) niceStep = 2 * mag
    else if (norm < 7) niceStep = 5 * mag
    else niceStep = 10 * mag

    // Helper: convert data value -> canvas Y (asymmetric bounds)
    const valToY = (v: number) => {
      const n = (v - yMin) / yRange
      return padding.top + plotH * (1 - n)
    }

    // Pixel-snap helper: aligns 1px lines to the device pixel grid so they render crisp.
    const snap = (v: number) => Math.floor(v) + 0.5 / dpr

    // --- Horizontal grid (minimal, crisp) at nice-number values ---
    const firstTick = Math.ceil(yMin / niceStep) * niceStep
    ctx.strokeStyle = 'rgba(206, 206, 206, 0.08)'
    ctx.lineWidth = 1
    for (let v = firstTick; v <= yMax; v += niceStep) {
      const y = snap(valToY(v))
      const isZero = Math.abs(v) < niceStep * 0.5
      if (!isZero) {
        ctx.beginPath()
        ctx.moveTo(padding.left, y)
        ctx.lineTo(width - padding.right, y)
        ctx.stroke()
      }
    }

    // --- Axis frame (just the left edge — minimal) ---
    ctx.strokeStyle = 'rgba(206, 206, 206, 0.25)'
    ctx.lineWidth = 1
    const leftX = snap(padding.left)
    ctx.beginPath()
    ctx.moveTo(leftX, padding.top)
    ctx.lineTo(leftX, padding.top + plotH)
    ctx.stroke()
    // Bottom edge
    const bottomY = snap(padding.top + plotH)
    ctx.beginPath()
    ctx.moveTo(padding.left, bottomY)
    ctx.lineTo(padding.left + plotW, bottomY)
    ctx.stroke()

    // --- Tick marks on the left axis (at nice-number values) ---
    ctx.strokeStyle = 'rgba(206, 206, 206, 0.45)'
    ctx.lineWidth = 1
    for (let v = firstTick; v <= yMax; v += niceStep) {
      const y = snap(valToY(v))
      ctx.beginPath()
      ctx.moveTo(leftX - 4, y)
      ctx.lineTo(leftX, y)
      ctx.stroke()
    }

    // --- Y-axis labels ---
    ctx.fillStyle = 'rgba(206, 206, 206, 0.8)'
    ctx.font = `500 11px ${sansFont}`
    ctx.textAlign = 'right'
    for (let v = firstTick; v <= yMax; v += niceStep) {
      const y = Math.round(valToY(v))
      ctx.fillText(`${v.toFixed(0)}`, padding.left - 8, y + 3)
    }

    // --- Tick marks on the bottom axis + time labels ---
    ctx.fillStyle = 'rgba(206, 206, 206, 0.8)'
    ctx.font = `500 11px ${sansFont}`
    ctx.textAlign = 'center'
    for (let i = 0; i <= 5; i++) {
      const x = snap(padding.left + (plotW * i) / 5)
      const sec = -WINDOW_SEC + (WINDOW_SEC * i) / 5
      ctx.strokeStyle = 'rgba(206, 206, 206, 0.45)'
      ctx.beginPath()
      ctx.moveTo(x, padding.top + plotH)
      ctx.lineTo(x, padding.top + plotH + 4)
      ctx.stroke()
      ctx.fillText(`${sec.toFixed(1)}s`, Math.round(x), height - 8)
    }


    ctx.save()
    ctx.beginPath()
    ctx.rect(padding.left, padding.top, plotW, plotH)
    ctx.clip()

    const zeroY = valToY(0)
    const zeroYSnap = Math.floor(zeroY) + 0.5 / dpr
    ctx.strokeStyle = 'rgba(206, 206, 206, 0.4)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(padding.left, zeroYSnap)
    ctx.lineTo(padding.left + plotW, zeroYSnap)
    ctx.stroke()

    // Iterate the mode's axes — primary (first in list) drawn last so it's on top
    const config = getModeConfig(modeRef.current)
    const axesReversed = [...config.axes].reverse()

    for (const meta of axesReversed) {
      if (!enabled.has(meta.key)) continue
      const isPrimary = meta.key === config.axes[0].key

      const points: { x: number; y: number }[] = []
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i]
        const age = now - s.time
        if (age > WINDOW_MS) continue
        if (age < 0) break
        const x = padding.left + plotW - (age / msPerPixel)
        const y = valToY(s.values[meta.key])
        points.push({ x, y })
      }

      if (points.length < 2) continue

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
  })

  return (
    <div className="w-full h-full relative">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  )
}

const WINDOW_SEC = WINDOW_MS / 1000
