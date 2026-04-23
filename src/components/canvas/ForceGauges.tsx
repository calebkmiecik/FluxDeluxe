import { useRef, useEffect } from 'react'
import { useAnimationFrame } from '../../hooks/useAnimationFrame'
import { getLatestFrameForDevice } from '../../stores/liveDataStore'
import { useDeviceStore } from '../../stores/deviceStore'
import {
  type Axis,
  type DataMode,
  getModeConfig,
  extractAxisValue,
} from '../../lib/dataMode'

// Exponential lerp speed. Higher = more responsive, lower = smoother.
// 18 → ~95% settle in ~165ms.  Tune here if it feels too snappy or too lagged.
const SMOOTH_SPEED = 18

interface ForceGaugesProps {
  mode: DataMode
  enabledAxes: Set<Axis>
  onToggleAxis: (axis: Axis) => void
}

export function ForceGauges({ mode, enabledAxes, onToggleAxis }: ForceGaugesProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  // Smoothed value per axis, continuously EMA'd each frame toward the latest
  // raw reading. Keeps the gauge output fluid instead of stepping between
  // discrete median samples.
  const smoothedRef = useRef<Record<Axis, number>>({
    fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: 0,
  })
  const lastFrameMsRef = useRef<number | null>(null)
  const enabledRef = useRef(enabledAxes)
  const modeRef = useRef<DataMode>(mode)
  useEffect(() => { enabledRef.current = enabledAxes }, [enabledAxes])
  useEffect(() => { modeRef.current = mode }, [mode])

  // Reset smoothing on device change so readings don't carry from the
  // previous device into the new one.
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId)
  useEffect(() => {
    smoothedRef.current = { fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }
    lastFrameMsRef.current = null
    const container = containerRef.current
    if (container) {
      container.querySelectorAll('[data-gauge]').forEach((el) => {
        el.textContent = ' 0.0'
      })
    }
  }, [selectedDeviceId])

  useAnimationFrame(() => {
    const selectedId = useDeviceStore.getState().selectedDeviceId
    const container = containerRef.current
    if (!container) return

    const config = getModeConfig(modeRef.current)

    // Use the per-device latest frame so multi-plate streaming doesn't
    // starve this gauge (matches the COP dot pattern).
    const frame = selectedId ? getLatestFrameForDevice(selectedId) : null

    if (frame) {
      const nowMs = performance.now()
      const dtMs = lastFrameMsRef.current === null ? 16 : nowMs - lastFrameMsRef.current
      lastFrameMsRef.current = nowMs
      const alpha = 1 - Math.exp(-SMOOTH_SPEED * (dtMs / 1000))

      const smoothed = smoothedRef.current
      for (const axis of config.axes) {
        const raw = extractAxisValue(frame, axis.key)
        smoothed[axis.key] += (raw - smoothed[axis.key]) * alpha
        const value = smoothed[axis.key]
        const el = container.querySelector(`[data-gauge="${axis.key}"]`)
        if (el) {
          // Pad positives with a space so the sign column is consistent and
          // decimals align across all rows (mono font = true tabular).
          const formatted = value < 0 ? value.toFixed(1) : ` ${value.toFixed(1)}`
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
