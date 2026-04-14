import { useRef, useEffect } from 'react'
import { useAnimationFrame } from '../../hooks/useAnimationFrame'
import { useLiveDataStore } from '../../stores/liveDataStore'

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

    // Get data from store (no React re-render)
    const frames = useLiveDataStore.getState().frameBuffer.toArray()

    // Clear
    ctx.fillStyle = '#232323'
    ctx.fillRect(0, 0, width, height)

    if (frames.length === 0) {
      ctx.fillStyle = '#8E9FBC'
      ctx.font = '14px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('No data', width / 2, height / 2)
      return
    }

    // Layout
    const padding = { top: 20, right: 20, bottom: 30, left: 60 }
    const plotW = width - padding.left - padding.right
    const plotH = height - padding.top - padding.bottom

    // Calculate Y scale from data
    let maxFz = 0
    for (const f of frames) {
      const abs = Math.abs(f.fz)
      if (abs > maxFz) maxFz = abs
    }
    maxFz = Math.max(maxFz * 1.2, 50) // At least 50N range, 20% padding

    // Draw grid lines
    ctx.strokeStyle = '#3A3A3A'
    ctx.lineWidth = 0.5
    const gridLines = 5
    for (let i = 0; i <= gridLines; i++) {
      const y = padding.top + (plotH * i) / gridLines
      ctx.beginPath()
      ctx.moveTo(padding.left, y)
      ctx.lineTo(width - padding.right, y)
      ctx.stroke()

      // Y-axis labels
      const forceVal = maxFz - (maxFz * 2 * i) / gridLines
      ctx.fillStyle = '#8E9FBC'
      ctx.font = '11px sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText(`${forceVal.toFixed(0)}N`, padding.left - 8, y + 4)
    }

    // Draw vertical grid lines (time)
    const vGridCount = 6
    for (let i = 0; i <= vGridCount; i++) {
      const x = padding.left + (plotW * i) / vGridCount
      ctx.beginPath()
      ctx.moveTo(x, padding.top)
      ctx.lineTo(x, padding.top + plotH)
      ctx.stroke()
    }

    // X-axis time labels
    const totalSec = frames.length / 60
    ctx.fillStyle = '#8E9FBC'
    ctx.font = '11px sans-serif'
    ctx.textAlign = 'center'
    for (let i = 0; i <= vGridCount; i++) {
      const x = padding.left + (plotW * i) / vGridCount
      const t = -totalSec + (totalSec * i) / vGridCount
      ctx.fillText(`${t.toFixed(1)}s`, x, height - 8)
    }

    // Draw force line
    ctx.strokeStyle = '#0051BA'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    const len = frames.length
    for (let i = 0; i < len; i++) {
      const x = padding.left + (plotW * i) / (len - 1 || 1)
      const normalizedFz = (frames[i].fz + maxFz) / (2 * maxFz) // -maxFz..+maxFz -> 0..1
      const y = padding.top + plotH * (1 - normalizedFz)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  })

  return (
    <div className="w-full h-full relative">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  )
}
