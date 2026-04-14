import { useRef, useEffect } from 'react'
import { useAnimationFrame } from '../../hooks/useAnimationFrame'
import { useLiveDataStore } from '../../stores/liveDataStore'
import { canvas as C } from '../../lib/theme'

// How many seconds of data the plot window shows
const WINDOW_MS = 5000

export function ForcePlot() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sizeRef = useRef({ width: 0, height: 0 })

  // Handle resize
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

  // Render loop
  useAnimationFrame(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const { width, height } = sizeRef.current
    if (width === 0 || height === 0) return

    const dpr = devicePixelRatio
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const frames = useLiveDataStore.getState().frameBuffer.toArray()

    // Clear
    ctx.fillStyle = C.bg
    ctx.fillRect(0, 0, width, height)

    if (frames.length === 0) {
      ctx.fillStyle = C.noDataText
      ctx.font = '14px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('No data', width / 2, height / 2)
      return
    }

    // Layout
    const padding = { top: 20, right: 20, bottom: 30, left: 60 }
    const plotW = width - padding.left - padding.right
    const plotH = height - padding.top - padding.bottom

    // Time window: right edge = now, left edge = now - WINDOW_MS
    const now = performance.now()
    const tMin = now - WINDOW_MS
    const tMax = now

    // Calculate Y scale from visible frames
    let maxFz = 0
    for (const f of frames) {
      if (f._receivedAt < tMin) continue
      const abs = Math.abs(f.fz)
      if (abs > maxFz) maxFz = abs
    }
    maxFz = Math.max(maxFz * 1.2, 50)

    // Draw horizontal grid lines
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

    // Draw vertical grid lines (time)
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

    // X-axis time labels
    ctx.fillStyle = C.axisLabel
    ctx.font = '11px sans-serif'
    ctx.textAlign = 'center'
    for (let i = 0; i <= vGridCount; i++) {
      const x = padding.left + (plotW * i) / vGridCount
      const sec = -WINDOW_MS / 1000 + (WINDOW_MS / 1000 * i) / vGridCount
      ctx.fillText(`${sec.toFixed(1)}s`, x, height - 8)
    }

    // Clip to plot area
    ctx.save()
    ctx.beginPath()
    ctx.rect(padding.left, padding.top, plotW, plotH)
    ctx.clip()

    // Map frames to screen coordinates using real timestamps
    // This makes scrolling perfectly smooth — each frame has a fixed
    // position based on when it arrived, and "now" moves continuously at 60fps
    const points: { x: number; y: number }[] = []
    for (let i = 0; i < frames.length; i++) {
      const t = frames[i]._receivedAt
      if (t < tMin - 100) continue // skip frames well outside window (small margin)
      const x = padding.left + ((t - tMin) / (tMax - tMin)) * plotW
      const normalizedFz = (frames[i].fz + maxFz) / (2 * maxFz)
      const y = padding.top + plotH * (1 - normalizedFz)
      points.push({ x, y })
    }

    // Draw force line with Catmull-Rom bezier interpolation
    if (points.length >= 2) {
      ctx.strokeStyle = C.dataLine
      ctx.lineWidth = 2
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(points[0].x, points[0].y)

      for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(0, i - 1)]
        const p1 = points[i]
        const p2 = points[i + 1]
        const p3 = points[Math.min(points.length - 1, i + 2)]

        const cp1x = p1.x + (p2.x - p0.x) / 6
        const cp1y = p1.y + (p2.y - p0.y) / 6
        const cp2x = p2.x - (p3.x - p1.x) / 6
        const cp2y = p2.y - (p3.y - p1.y) / 6

        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y)
      }

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
