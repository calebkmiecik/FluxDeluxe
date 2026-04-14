import { useRef, useEffect } from 'react'
import { useAnimationFrame } from '../../hooks/useAnimationFrame'
import { useLiveDataStore } from '../../stores/liveDataStore'
import { useDeviceStore } from '../../stores/deviceStore'
import { canvas as C } from '../../lib/theme'

// How many seconds of trailing data to show
const WINDOW_SEC = 5
// Max samples to keep (bounded memory)
const MAX_SAMPLES = 600

/** Lightweight sample stored in the plot's own buffer */
interface Sample {
  t: number // backend timestamp (ms)
  fz: number
}

export function ForcePlot() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sizeRef = useRef({ width: 0, height: 0 })
  // Plot's own sample buffer — decoupled from the store's ring buffer
  const samplesRef = useRef<Sample[]>([])
  // Track the last frame count we processed to detect new data
  const lastProcessedRef = useRef(0)

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

    // --- Ingest new frames from the store ---
    const store = useLiveDataStore.getState()
    const currentFrame = store.currentFrame
    const selectedId = useDeviceStore.getState().selectedDeviceId
    const samples = samplesRef.current

    // Check if there's a new frame to process
    if (currentFrame && currentFrame._receivedAt !== lastProcessedRef.current) {
      lastProcessedRef.current = currentFrame._receivedAt

      // Get recent frames from buffer, filter to selected device
      const allFrames = store.frameBuffer.toArray()
      // Find frames we haven't processed yet (newer than our last sample)
      const lastT = samples.length > 0 ? samples[samples.length - 1].t : -Infinity

      for (const f of allFrames) {
        // Filter to selected device
        if (selectedId && f.id !== selectedId) continue
        // Use backend timestamp; fall back to _receivedAt if missing
        const t = f.time ?? f._receivedAt
        if (t <= lastT) continue
        samples.push({ t, fz: f.fz })
      }

      // Trim to max samples
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

    // Time window: right edge = latest sample time, left edge = latest - WINDOW_SEC
    const tMax = samples[samples.length - 1].t
    const tMin = tMax - WINDOW_SEC * 1000

    // Y-axis auto-scale from visible samples
    let maxFz = 0
    for (let i = samples.length - 1; i >= 0; i--) {
      if (samples[i].t < tMin) break
      const abs = Math.abs(samples[i].fz)
      if (abs > maxFz) maxFz = abs
    }
    maxFz = Math.max(maxFz * 1.15, 10) // 15% headroom, minimum ±10N

    // Horizontal grid lines + Y labels
    ctx.strokeStyle = C.gridLine
    ctx.lineWidth = 0.5
    const gridLines = 5
    for (let i = 0; i <= gridLines; i++) {
      const y = padding.top + (plotH * i) / gridLines
      ctx.beginPath()
      ctx.moveTo(padding.left, y)
      ctx.lineTo(width - padding.right, y)
      ctx.stroke()

      const forceVal = maxFz - (maxFz * 2 * i) / gridLines
      ctx.fillStyle = C.axisLabel
      ctx.font = '11px sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText(`${forceVal.toFixed(0)}N`, padding.left - 8, y + 4)
    }

    // Vertical grid lines + X labels
    const vGridCount = 5
    ctx.strokeStyle = C.gridLine
    ctx.lineWidth = 0.5
    for (let i = 0; i <= vGridCount; i++) {
      const x = padding.left + (plotW * i) / vGridCount
      ctx.beginPath()
      ctx.moveTo(x, padding.top)
      ctx.lineTo(x, padding.top + plotH)
      ctx.stroke()
    }
    ctx.fillStyle = C.axisLabel
    ctx.font = '11px sans-serif'
    ctx.textAlign = 'center'
    for (let i = 0; i <= vGridCount; i++) {
      const x = padding.left + (plotW * i) / vGridCount
      const sec = -WINDOW_SEC + (WINDOW_SEC * i) / vGridCount
      ctx.fillText(`${sec.toFixed(1)}s`, x, height - 8)
    }

    // Clip to plot area
    ctx.save()
    ctx.beginPath()
    ctx.rect(padding.left, padding.top, plotW, plotH)
    ctx.clip()

    // Draw force line using backend timestamps for X
    ctx.strokeStyle = C.dataLine
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.beginPath()

    let started = false
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i]
      if (s.t < tMin) continue

      const x = padding.left + ((s.t - tMin) / (tMax - tMin)) * plotW
      const normalizedFz = (s.fz + maxFz) / (2 * maxFz)
      const y = padding.top + plotH * (1 - normalizedFz)

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
