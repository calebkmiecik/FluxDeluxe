import { useRef, useEffect } from 'react'
import { useAnimationFrame } from '../../hooks/useAnimationFrame'
import { useLiveDataStore } from '../../stores/liveDataStore'
import { useDeviceStore } from '../../stores/deviceStore'
import { PLATE_DIMENSIONS } from '../../lib/types'

// Default plate dimensions (mm) if device type is unknown
const DEFAULT_PLATE = { width: 353.3, height: 607.3 }

function getPlateSize(): { width: number; height: number } {
  const { selectedDeviceId, devices } = useDeviceStore.getState()
  if (selectedDeviceId) {
    const device = devices.find((d) => d.axfId === selectedDeviceId)
    if (device?.deviceTypeId && PLATE_DIMENSIONS[device.deviceTypeId]) {
      return PLATE_DIMENSIONS[device.deviceTypeId]
    }
  }
  return DEFAULT_PLATE
}

export function COPVisualization() {
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

    // Clear
    ctx.fillStyle = '#1a1a1a'
    ctx.fillRect(0, 0, width, height)

    // Get plate dimensions and fit to canvas
    const plate = getPlateSize()
    const plateAspect = plate.width / plate.height
    const canvasAspect = width / height

    const margin = 40
    let plateW: number, plateH: number
    if (plateAspect > canvasAspect) {
      plateW = width - margin * 2
      plateH = plateW / plateAspect
    } else {
      plateH = height - margin * 2
      plateW = plateH * plateAspect
    }

    const plateX = (width - plateW) / 2
    const plateY = (height - plateH) / 2

    // Draw plate outline
    ctx.strokeStyle = '#555'
    ctx.lineWidth = 2
    ctx.strokeRect(plateX, plateY, plateW, plateH)

    // Get current frame
    const frame = useLiveDataStore.getState().currentFrame

    if (!frame) {
      ctx.fillStyle = '#666'
      ctx.font = '14px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('No data', width / 2, height / 2)
      return
    }

    // Map COP from meters to canvas pixels
    // COP origin is plate center; x/y in meters
    const copPxX = plateX + plateW / 2 + (frame.cop.x * 1000 / plate.width) * plateW
    const copPxY = plateY + plateH / 2 - (frame.cop.y * 1000 / plate.height) * plateH

    // Clamp to plate bounds for visual safety
    const cx = Math.max(plateX, Math.min(plateX + plateW, copPxX))
    const cy = Math.max(plateY, Math.min(plateY + plateH, copPxY))

    // Draw cross-hair
    ctx.strokeStyle = 'rgba(74, 158, 255, 0.4)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx, plateY)
    ctx.lineTo(cx, plateY + plateH)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(plateX, cy)
    ctx.lineTo(plateX + plateW, cy)
    ctx.stroke()

    // Draw COP dot
    const dotRadius = 8
    ctx.fillStyle = '#4a9eff'
    ctx.beginPath()
    ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2)
    ctx.fill()

    // Inner highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)'
    ctx.beginPath()
    ctx.arc(cx, cy, dotRadius * 0.4, 0, Math.PI * 2)
    ctx.fill()

    // Force magnitude text
    ctx.fillStyle = '#ccc'
    ctx.font = '13px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(`Fz: ${frame.fz.toFixed(1)} N`, width / 2, height - 10)
  })

  return (
    <div className="w-full h-full relative">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  )
}
