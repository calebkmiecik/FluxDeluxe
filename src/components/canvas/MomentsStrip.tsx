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

const AXES = [
  { key: 'mx' as const, label: 'Mx', color: '#7C4DFF' },
  { key: 'my' as const, label: 'My', color: '#AA00FF' },
  { key: 'mz' as const, label: 'Mz', color: '#D500F9' },
]

export function MomentsStrip() {
  const containerRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<Record<string, number[]>>({ mx: [], my: [], mz: [] })

  useAnimationFrame(() => {
    const frame = useLiveDataStore.getState().currentFrame
    const selectedId = useDeviceStore.getState().selectedDeviceId
    const container = containerRef.current
    if (!container || !frame || (selectedId && frame.id !== selectedId)) return

    const history = historyRef.current
    const vals = { mx: frame.moments.x, my: frame.moments.y, mz: frame.moments.z }

    for (const axis of AXES) {
      const buf = history[axis.key]
      buf.push(vals[axis.key])
      if (buf.length > MEDIAN_WINDOW) buf.shift()

      const smoothed = median(buf)
      const el = container.querySelector(`[data-moment="${axis.key}"]`)
      if (el) el.textContent = smoothed.toFixed(1)
    }
  })

  return (
    <div ref={containerRef} className="flex items-center gap-5 px-4 h-full">
      {AXES.map((axis) => (
        <div key={axis.key} className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: axis.color }} />
          <span className="text-[11px] text-muted-foreground">{axis.label}</span>
          <span
            data-moment={axis.key}
            className="font-mono text-xs tabular-nums text-foreground"
          >
            0.0
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">Nm</span>
        </div>
      ))}
    </div>
  )
}
