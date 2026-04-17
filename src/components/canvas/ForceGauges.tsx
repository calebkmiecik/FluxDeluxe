import { useRef, useEffect } from 'react'
import { useAnimationFrame } from '../../hooks/useAnimationFrame'
import { useLiveDataStore } from '../../stores/liveDataStore'
import { useDeviceStore } from '../../stores/deviceStore'
import {
  type Axis,
  type DataMode,
  getModeConfig,
  extractAxisValue,
} from '../../lib/dataMode'

const MEDIAN_WINDOW = 5

function median(arr: number[]): number {
  if (arr.length === 0) return 0
  const sorted = arr.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

interface ForceGaugesProps {
  mode: DataMode
  enabledAxes: Set<Axis>
  onToggleAxis: (axis: Axis) => void
}

export function ForceGauges({ mode, enabledAxes, onToggleAxis }: ForceGaugesProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  // Rolling medians keyed by axis (all 6 possible axes)
  const historyRef = useRef<Record<Axis, number[]>>({
    fx: [], fy: [], fz: [], mx: [], my: [], mz: [],
  })
  const enabledRef = useRef(enabledAxes)
  const modeRef = useRef<DataMode>(mode)
  useEffect(() => { enabledRef.current = enabledAxes }, [enabledAxes])
  useEffect(() => { modeRef.current = mode }, [mode])

  // Reset smoothing windows on device change so readings don't carry from the
  // previous device into the new one.
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId)
  useEffect(() => {
    historyRef.current = { fx: [], fy: [], fz: [], mx: [], my: [], mz: [] }
    // Clear displayed values back to the padded zero so the UI doesn't flash
    // stale numbers during the next frame.
    const container = containerRef.current
    if (container) {
      container.querySelectorAll('[data-gauge]').forEach((el) => {
        el.textContent = ' 0.0'
      })
    }
  }, [selectedDeviceId])

  useAnimationFrame(() => {
    const frame = useLiveDataStore.getState().currentFrame
    const selectedId = useDeviceStore.getState().selectedDeviceId
    const container = containerRef.current
    if (!container) return

    const config = getModeConfig(modeRef.current)

    // Update gauge values
    // Only update when we have a selected device and a frame from it
    if (frame && selectedId && frame.id === selectedId) {
      const history = historyRef.current
      for (const axis of config.axes) {
        const raw = extractAxisValue(frame, axis.key)
        const buf = history[axis.key]
        buf.push(raw)
        if (buf.length > MEDIAN_WINDOW) buf.shift()

        const smoothed = median(buf)
        const el = container.querySelector(`[data-gauge="${axis.key}"]`)
        if (el) {
          // Pad positives with a space so the sign column is consistent and
          // decimals align across all rows (mono font = true tabular).
          const formatted = smoothed < 0 ? smoothed.toFixed(1) : ` ${smoothed.toFixed(1)}`
          el.textContent = formatted
        }
      }
    }

    // LED breathe — true sin wave, 4s period
    const t = (performance.now() / 4000) * Math.PI * 2
    const glow = 3 + 4 * (0.5 + 0.5 * Math.sin(t))
    const enabled = enabledRef.current
    for (const axis of config.axes) {
      const led = container.querySelector(`[data-led="${axis.key}"]`) as HTMLElement | null
      if (!led) continue
      led.style.boxShadow = enabled.has(axis.key)
        ? `0 0 ${glow.toFixed(1)}px ${axis.core}80`
        : 'none'
    }
  })

  const config = getModeConfig(mode)

  return (
    <div ref={containerRef} className="flex flex-col gap-2 h-full">
      {config.axes.map((axis) => {
        const on = enabledAxes.has(axis.key)
        return (
          <button
            key={axis.key}
            onClick={() => onToggleAxis(axis.key)}
            className="flex-1 rounded-md border border-border bg-surface-dark text-left transition-all duration-150 flex flex-col justify-center px-4 py-3 relative"
            style={{ borderLeftWidth: 3, borderLeftColor: axis.core }}
          >
            {/* Status LED — top right */}
            <div
              data-led={axis.key}
              className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: on ? axis.core : '#333' }}
            />
            {/* Label */}
            <div className="telemetry-label mb-1">{axis.label}</div>
            {/* Value */}
            <div className="flex items-baseline gap-1.5">
              <span
                data-gauge={axis.key}
                className="font-mono text-4xl tracking-tight tabular-nums text-foreground whitespace-pre"
              >
                {' 0.0'}
              </span>
              <span className="font-mono text-xs text-muted-foreground">{config.unit}</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
