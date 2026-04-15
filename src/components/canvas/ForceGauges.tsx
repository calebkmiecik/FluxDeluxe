import { useRef } from 'react'
import { useAnimationFrame } from '../../hooks/useAnimationFrame'
import { useLiveDataStore } from '../../stores/liveDataStore'
import { useDeviceStore } from '../../stores/deviceStore'

const AXES = [
  { key: 'fz' as const, label: 'Fz', unit: 'N', color: '#3B8EFF' },
  { key: 'fx' as const, label: 'Fx', unit: 'N', color: '#00BFA5' },
  { key: 'fy' as const, label: 'Fy', unit: 'N', color: '#FF9100' },
] as const

export function ForceGauges() {
  const valuesRef = useRef({ fx: 0, fy: 0, fz: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  useAnimationFrame(() => {
    const frame = useLiveDataStore.getState().currentFrame
    const selectedId = useDeviceStore.getState().selectedDeviceId
    if (!frame || (selectedId && frame.id !== selectedId)) return

    valuesRef.current = { fx: frame.fx, fy: frame.fy, fz: frame.fz }

    // Update DOM directly to avoid React re-renders at 60fps
    const container = containerRef.current
    if (!container) return
    for (const axis of AXES) {
      const el = container.querySelector(`[data-gauge="${axis.key}"]`)
      if (el) el.textContent = valuesRef.current[axis.key].toFixed(1)
    }
  })

  return (
    <div ref={containerRef} className="flex flex-col justify-center gap-3 h-full px-3 py-2">
      {AXES.map((axis) => (
        <div key={axis.key} className="panel-inset px-3 py-2.5 flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: axis.color }} />
            <span className="telemetry-label">{axis.label}</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span
              data-gauge={axis.key}
              className="font-mono text-lg tracking-tight text-foreground tabular-nums"
            >
              0.0
            </span>
            <span className="font-mono text-xs text-muted-foreground">{axis.unit}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
