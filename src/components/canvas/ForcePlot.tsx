import { useRef, useEffect } from 'react'
import { useAnimationFrame } from '../../hooks/useAnimationFrame'
import { useLiveDataStore } from '../../stores/liveDataStore'
import { useDeviceStore } from '../../stores/deviceStore'
import { canvas as C } from '../../lib/theme'

// How many seconds of data the plot window shows
const WINDOW_MS = 5000

export function ForcePlot() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sizeRef = useRef({ width: 0, height: 0 })

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

    // Get all frames and filter to selected device
    const allFrames = useLiveDataStore.getState().frameBuffer.toArray()
    const selectedId = useDeviceStore.getState().selectedDeviceId

    // Filter to selected device only (avoids interleaving multiple devices)
    const frames = selectedId
      ? allFrames.filter((f) => f.id === selectedId)
      : allFrames

    // Clear
    ctx.fillStyle = C.bg
    ctx.fillRect(0, 0, width, height)

    if (frames.length === 0) {
      ctx.fillStyle = C.noDataText
      ctx.font = '14px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(selectedId ? 'No data from device' : 'No device selected', width / 2, height / 2)
      return
    }

    // Layout
    const padding = { top: 20, right: 20, bottom: 30, left: 60 }
    const plotW = width - padding.left - padding.right
    const plotH = height - padding.top - padding.bottom

    // Time window based on _receivedAt timestamps
    const now = performance.now()
    const tMin = now - WINDOW_MS
    const tMax = now

    // Filter to visible window
    const visible = frames.filter((f) => f._receivedAt >= tMin)

    // Calculate Y scale from visible frames
    let maxFz = 0
    for (const f of visible) {
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

    // Vertical grid lines
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

    // Draw force line
    ctx.strokeStyle = C.dataLine
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.beginPath()

    let started = false
    for (let i = 0; i < visible.length; i++) {
      const x = padding.left + ((visible[i]._receivedAt - tMin) / (tMax - tMin)) * plotW
      const normalizedFz = (visible[i].fz + maxFz) / (2 * maxFz)
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
