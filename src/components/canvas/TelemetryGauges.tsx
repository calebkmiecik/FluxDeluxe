import { useRef } from 'react'
import { useAnimationFrame } from '../../hooks/useAnimationFrame'
import { useLiveDataStore } from '../../stores/liveDataStore'
import { useDeviceStore } from '../../stores/deviceStore'

const MEDIAN_WINDOW = 5

function median(arr: number[]): number {
  if (arr.length === 0) return 0
  const sorted = arr.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

interface GaugeDef {
  key: string
  label: string
  unit: string
  color: string
  extract: (frame: { moments: { x: number; y: number; z: number }; avgTemperatureF?: number }) => number
  decimals: number
}

const GAUGES: GaugeDef[] = [
  { key: 'mx', label: 'Mx', unit: 'Nm', color: '#7C4DFF', extract: (f) => f.moments.x, decimals: 1 },
  { key: 'my', label: 'My', unit: 'Nm', color: '#AA00FF', extract: (f) => f.moments.y, decimals: 1 },
  { key: 'mz', label: 'Mz', unit: 'Nm', color: '#D500F9', extract: (f) => f.moments.z, decimals: 1 },
  { key: 'temp', label: 'Temp', unit: '\u00B0F', color: '#FF6E40', extract: (f) => f.avgTemperatureF ?? 0, decimals: 1 },
]

export function TelemetryGauges() {
  const containerRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<Record<string, number[]>>(
    Object.fromEntries(GAUGES.map((g) => [g.key, []]))
  )

  useAnimationFrame(() => {
    const frame = useLiveDataStore.getState().currentFrame
    const selectedId = useDeviceStore.getState().selectedDeviceId
    const container = containerRef.current
    if (!container) return
    if (!frame || (selectedId && frame.id !== selectedId)) return

    const history = historyRef.current

    // LED breathe
    const t = (performance.now() / 4000) * Math.PI * 2
    const glow = 3 + 4 * (0.5 + 0.5 * Math.sin(t))

    for (const gauge of GAUGES) {
      const raw = gauge.extract(frame)
      const buf = history[gauge.key]
      buf.push(raw)
      if (buf.length > MEDIAN_WINDOW) buf.shift()

      const smoothed = median(buf)
      const el = container.querySelector(`[data-gauge="${gauge.key}"]`)
      if (el) el.textContent = smoothed.toFixed(gauge.decimals)

      const led = container.querySelector(`[data-led="${gauge.key}"]`) as HTMLElement | null
      if (led) {
        const hasData = raw !== 0 || buf.some((v) => v !== 0)
        led.style.backgroundColor = hasData ? gauge.color : '#333'
        led.style.boxShadow = hasData
          ? `0 0 ${glow.toFixed(1)}px ${gauge.color}80`
          : 'none'
      }
    }
  })

  return (
    <div ref={containerRef} className="flex flex-col gap-2 h-full px-3 py-3">
      {GAUGES.map((gauge) => (
        <div
          key={gauge.key}
          className="flex-1 rounded-md border border-border bg-surface-dark flex flex-col justify-center px-3 py-2 relative"
          style={{ borderLeftWidth: 3, borderLeftColor: gauge.color }}
        >
          {/* Status LED */}
          <div
            data-led={gauge.key}
            className="absolute top-2 right-2 w-2 h-2 rounded-full"
            style={{ backgroundColor: '#333' }}
          />
          {/* Label */}
          <div className="telemetry-label mb-0.5">{gauge.label}</div>
          {/* Value */}
          <div className="flex items-baseline gap-1">
            <span
              data-gauge={gauge.key}
              className="font-mono text-xl tracking-tight tabular-nums text-foreground"
            >
              0.0
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">{gauge.unit}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
