import { useRef, useEffect } from 'react'
import { useAnimationFrame } from '../../hooks/useAnimationFrame'
import { useLiveDataStore } from '../../stores/liveDataStore'
import { useDeviceStore } from '../../stores/deviceStore'

// Fixed temp range (Fahrenheit) — never resizes
const TEMP_MIN = 0
const TEMP_MAX = 150
const ROOM_TEMP = 73 // neutral midpoint
const COLD_COLOR = { r: 60, g: 140, b: 240 }    // cool blue
const NEUTRAL_COLOR = { r: 180, g: 180, b: 185 } // neutral gray
const HOT_COLOR = { r: 255, g: 80, b: 80 }      // warm red

const MEDIAN_WINDOW = 10

function median(arr: number[]): number {
  if (arr.length === 0) return 0
  const sorted = arr.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function lerpColor(a: typeof COLD_COLOR, b: typeof COLD_COLOR, t: number): string {
  const r = Math.round(a.r + (b.r - a.r) * t)
  const g = Math.round(a.g + (b.g - a.g) * t)
  const bl = Math.round(a.b + (b.b - a.b) * t)
  return `rgb(${r},${g},${bl})`
}

/** Temp -> solid color. Neutral at room temp, blue cold, red hot. */
function tempToColor(tempF: number): string {
  if (tempF < ROOM_TEMP) {
    const t = Math.max(0, Math.min(1, (ROOM_TEMP - tempF) / (ROOM_TEMP - TEMP_MIN)))
    return lerpColor(NEUTRAL_COLOR, COLD_COLOR, t)
  } else {
    const t = Math.max(0, Math.min(1, (tempF - ROOM_TEMP) / (TEMP_MAX - ROOM_TEMP)))
    return lerpColor(NEUTRAL_COLOR, HOT_COLOR, t)
  }
}

export function TempGauge() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sizeRef = useRef({ width: 0, height: 0 })
  const historyRef = useRef<number[]>([])
  const smoothedRef = useRef(0)

  // Reset smoothing on device change so temp doesn't carry over.
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId)
  useEffect(() => {
    historyRef.current = []
    smoothedRef.current = 0
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

    const frame = useLiveDataStore.getState().currentFrame
    const selectedId = useDeviceStore.getState().selectedDeviceId

    if (frame && selectedId && frame.id === selectedId && frame.avgTemperatureF != null) {
      const buf = historyRef.current
      buf.push(frame.avgTemperatureF)
      if (buf.length > MEDIAN_WINDOW) buf.shift()
      smoothedRef.current = median(buf)
    }

    const temp = smoothedRef.current
    const monoFont = "'Geist Mono Variable', monospace"

    // Clear — transparent so the gauge floats over whatever's behind
    ctx.clearRect(0, 0, width, height)

    // Slim bar — centered horizontally
    const BAR_WIDTH = 4
    const barPad = { top: 22, bottom: 26 }
    const barW = BAR_WIDTH
    const barH = height - barPad.top - barPad.bottom
    const barX = (width - barW) / 2
    const barY = barPad.top

    // Temp label at top
    ctx.font = `9px ${monoFont}`
    ctx.fillStyle = 'rgba(142, 159, 188, 0.5)'
    ctx.textAlign = 'center'
    ctx.fillText('Temp', width / 2, 12)

    // No data
    if (temp === 0 && historyRef.current.length === 0) {
      ctx.font = `10px ${monoFont}`
      ctx.fillStyle = 'rgba(142, 159, 188, 0.3)'
      ctx.fillText('--', width / 2, height / 2 + 4)
      return
    }

    // Bar track (thin, dark)
    ctx.fillStyle = '#1a1a1a'
    ctx.beginPath()
    ctx.roundRect(barX, barY, barW, barH, barW / 2)
    ctx.fill()

    // Fill level — solid color based on temp
    const t = Math.max(0, Math.min(1, (temp - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)))
    const fillH = barH * t
    const fillY = barY + barH - fillH
    const color = tempToColor(temp)

    ctx.fillStyle = color
    ctx.beginPath()
    ctx.roundRect(barX, fillY, barW, fillH, barW / 2)
    ctx.fill()

    // Room-temp reference tick (subtle horizontal line across the bar)
    const roomT = Math.max(0, Math.min(1, (ROOM_TEMP - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)))
    const roomY = barY + barH * (1 - roomT)
    ctx.strokeStyle = 'rgba(142, 159, 188, 0.3)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(barX - 3, roomY)
    ctx.lineTo(barX + barW + 3, roomY)
    ctx.stroke()

    // Value readout at bottom
    ctx.font = `bold 11px ${monoFont}`
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${temp.toFixed(1)}°`, width / 2, height - 12)
    ctx.textBaseline = 'alphabetic'
  })

  return (
    <div className="w-full h-full relative">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  )
}
