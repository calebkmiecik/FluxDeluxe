import { useRef, useEffect } from 'react'
import { useAnimationFrame } from '../../hooks/useAnimationFrame'
import { useLiveDataStore } from '../../stores/liveDataStore'
import { useDeviceStore } from '../../stores/deviceStore'

// Expected range for force plate temps (Fahrenheit)
const TEMP_MIN = 60
const TEMP_MAX = 110

const MEDIAN_WINDOW = 10 // Temp changes slowly, smoother filtering

function median(arr: number[]): number {
  if (arr.length === 0) return 0
  const sorted = arr.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Interpolate between colors based on t (0-1) */
function tempColor(t: number): string {
  // Cool blue -> neutral white -> warm orange
  if (t < 0.5) {
    const s = t * 2 // 0-1 within cool half
    const r = Math.round(80 + s * 175)
    const g = Math.round(140 + s * 115)
    const b = Math.round(220 - s * 20)
    return `rgb(${r},${g},${b})`
  } else {
    const s = (t - 0.5) * 2 // 0-1 within warm half
    const r = Math.round(255)
    const g = Math.round(255 - s * 145)
    const b = Math.round(200 - s * 150)
    return `rgb(${r},${g},${b})`
  }
}

export function TempGauge() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sizeRef = useRef({ width: 0, height: 0 })
  const historyRef = useRef<number[]>([])
  const smoothedRef = useRef(0)

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

    const frame = useLiveDataStore.getState().currentFrame
    const selectedId = useDeviceStore.getState().selectedDeviceId

    if (frame && (!selectedId || frame.id === selectedId) && frame.avgTemperatureF != null) {
      const buf = historyRef.current
      buf.push(frame.avgTemperatureF)
      if (buf.length > MEDIAN_WINDOW) buf.shift()
      smoothedRef.current = median(buf)
    }

    const temp = smoothedRef.current
    const monoFont = "'Geist Mono Variable', monospace"

    // Clear
    ctx.fillStyle = '#141414'
    ctx.fillRect(0, 0, width, height)

    const barPad = { top: 28, bottom: 28, left: 4, right: 4 }
    const barW = width - barPad.left - barPad.right
    const barH = height - barPad.top - barPad.bottom
    const barX = barPad.left
    const barY = barPad.top

    // Temp label
    ctx.font = `9px ${monoFont}`
    ctx.fillStyle = 'rgba(142, 159, 188, 0.6)'
    ctx.textAlign = 'center'
    ctx.fillText('TEMP', width / 2, 12)

    // No data
    if (temp === 0 && historyRef.current.length === 0) {
      ctx.font = `10px ${monoFont}`
      ctx.fillStyle = 'rgba(142, 159, 188, 0.3)'
      ctx.fillText('--', width / 2, height / 2 + 4)
      return
    }

    // Bar track (recessed)
    ctx.fillStyle = '#1a1a1a'
    ctx.strokeStyle = '#333'
    ctx.lineWidth = 1
    const trackR = barW / 2
    // Rounded rect track
    ctx.beginPath()
    ctx.roundRect(barX, barY, barW, barH, trackR)
    ctx.fill()
    ctx.stroke()

    // Fill level
    const t = Math.max(0, Math.min(1, (temp - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)))
    const fillH = barH * t
    const fillY = barY + barH - fillH

    // Gradient fill from bottom
    const grad = ctx.createLinearGradient(0, barY + barH, 0, barY)
    grad.addColorStop(0, tempColor(0))
    grad.addColorStop(0.5, tempColor(0.5))
    grad.addColorStop(1, tempColor(1))

    ctx.save()
    ctx.beginPath()
    ctx.roundRect(barX, barY, barW, barH, trackR)
    ctx.clip()

    ctx.fillStyle = grad
    ctx.fillRect(barX, fillY, barW, fillH)

    // Subtle glow at the fill top
    const color = tempColor(t)
    const glowGrad = ctx.createLinearGradient(0, fillY, 0, fillY + 12)
    glowGrad.addColorStop(0, color.replace('rgb', 'rgba').replace(')', ', 0.5)'))
    glowGrad.addColorStop(1, 'transparent')
    ctx.fillStyle = glowGrad
    ctx.fillRect(barX, fillY, barW, 12)

    ctx.restore()

    // Value readout at bottom
    ctx.font = `bold 12px ${monoFont}`
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.fillText(`${temp.toFixed(1)}°`, width / 2, height - 6)
  })

  return (
    <div className="w-full h-full relative">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  )
}
