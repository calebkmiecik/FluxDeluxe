import { useRef, useEffect } from 'react'
import { useAnimationFrame } from '../../hooks/useAnimationFrame'
import { useLiveDataStore } from '../../stores/liveDataStore'
import { useDeviceStore } from '../../stores/deviceStore'

type Axis = 'fx' | 'fy' | 'fz'

const AXES: { key: Axis; label: string; unit: string; color: string }[] = [
  { key: 'fz', label: 'Fz', unit: 'N', color: '#3B8EFF' },
  { key: 'fx', label: 'Fx', unit: 'N', color: '#00BFA5' },
  { key: 'fy', label: 'Fy', unit: 'N', color: '#FF9100' },
]

const MEDIAN_WINDOW = 5

function median(arr: number[]): number {
  if (arr.length === 0) return 0
  const sorted = arr.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

interface ForceGaugesProps {
  enabledAxes: Set<Axis>
  onToggleAxis: (axis: Axis) => void
}

export function ForceGauges({ enabledAxes, onToggleAxis }: ForceGaugesProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<Record<Axis, number[]>>({ fx: [], fy: [], fz: [] })
  const enabledRef = useRef(enabledAxes)
  useEffect(() => { enabledRef.current = enabledAxes }, [enabledAxes])

  useAnimationFrame(() => {
    const frame = useLiveDataStore.getState().currentFrame
    const selectedId = useDeviceStore.getState().selectedDeviceId
    const container = containerRef.current
    if (!container) return

    // Update gauge values
    if (frame && (!selectedId || frame.id === selectedId)) {
      const history = historyRef.current
      for (const axis of AXES) {
        const raw = frame[axis.key]
        const buf = history[axis.key]
        buf.push(raw)
        if (buf.length > MEDIAN_WINDOW) buf.shift()

        const smoothed = median(buf)
        const el = container.querySelector(`[data-gauge="${axis.key}"]`)
        if (el) el.textContent = smoothed.toFixed(1)
      }
    }

    // LED breathe — true sin wave, 4s period
    const t = (performance.now() / 4000) * Math.PI * 2
    const glow = 3 + 4 * (0.5 + 0.5 * Math.sin(t)) // 3px to 7px
    const enabled = enabledRef.current
    for (const axis of AXES) {
      const led = container.querySelector(`[data-led="${axis.key}"]`) as HTMLElement | null
      if (!led) continue
      led.style.boxShadow = enabled.has(axis.key)
        ? `0 0 ${glow.toFixed(1)}px ${axis.color}80`
        : 'none'
    }
  })

  return (
    <div ref={containerRef} className="flex flex-col gap-2 h-full px-3 py-3">
      {AXES.map((axis) => {
        const on = enabledAxes.has(axis.key)
        return (
          <button
            key={axis.key}
            onClick={() => onToggleAxis(axis.key)}
            className="flex-1 rounded-md border border-border bg-surface-dark text-left transition-all duration-150 flex flex-col justify-center px-4 py-3 relative"
            style={{ borderLeftWidth: 3, borderLeftColor: axis.color }}
          >
            {/* Status LED — top right */}
            <div
              data-led={axis.key}
              className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: on ? axis.color : '#333' }}
            />
            {/* Label */}
            <div className="telemetry-label mb-1">{axis.label}</div>
            {/* Value */}
            <div className="flex items-baseline gap-1.5">
              <span
                data-gauge={axis.key}
                className="font-mono text-4xl tracking-tight tabular-nums text-foreground"
              >
                0.0
              </span>
              <span className="font-mono text-xs text-muted-foreground">{axis.unit}</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
