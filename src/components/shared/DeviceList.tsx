import { useRef, useMemo, useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { useAnimationFrame } from '../../hooks/useAnimationFrame'
import { useDeviceStore } from '../../stores/deviceStore'
import { getSocket } from '../../lib/socket'
import { deviceTypeFromAxfId } from '../../lib/deviceIds'
import { getLastSeenForDevice } from '../../stores/liveDataStore'

const STALE_MS = 3000
const EXIT_ANIM_MS = 200
const TICK_MS = 150

export function DeviceList() {
  const devices = useDeviceStore((s) => s.devices)
  const deviceTypes = useDeviceStore((s) => s.deviceTypes)
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId)
  const selectDevice = useDeviceStore((s) => s.selectDevice)

  const typeNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of deviceTypes) map.set(t.deviceTypeId, t.name)
    return map
  }, [deviceTypes])

  // Tick for stale-filter re-evaluation. 200ms is frequent enough to trigger
  // the exit animation promptly when a device goes silent, without burning CPU.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), TICK_MS)
    return () => clearInterval(id)
  }, [])

  // Build a rendering list with per-device fade state. Devices that have
  // never produced a frame are kept visible (still initializing). Once a
  // device is silent past STALE_MS, it enters "fading" (opacity → 0 over
  // EXIT_ANIM_MS), then is fully removed.
  const now = performance.now()
  const renderedDevices: Array<{ d: typeof devices[number]; fading: boolean }> = []
  for (const d of devices) {
    const lastSeen = getLastSeenForDevice(d.axfId)
    if (lastSeen === null) {
      renderedDevices.push({ d, fading: false })
      continue
    }
    const age = now - lastSeen
    if (age < STALE_MS) renderedDevices.push({ d, fading: false })
    else if (age < STALE_MS + EXIT_ANIM_MS) renderedDevices.push({ d, fading: true })
    // else: omitted entirely
  }

  const containerRef = useRef<HTMLDivElement>(null)

  // Breathe the green LED on the active device; ensure inactive LEDs have no glow
  useAnimationFrame(() => {
    const container = containerRef.current
    if (!container) return
    const t = (performance.now() / 4000) * Math.PI * 2
    const glow = 3 + 4 * (0.5 + 0.5 * Math.sin(t))
    const leds = container.querySelectorAll('[data-led]') as NodeListOf<HTMLElement>
    leds.forEach((led) => {
      if (led.dataset.led === 'active') {
        led.style.boxShadow = `0 0 ${glow.toFixed(1)}px #00C85380`
      } else {
        led.style.boxShadow = 'none'
      }
    })
  })

  return (
    <div ref={containerRef} className="h-full flex flex-col py-3 px-2 gap-1.5 overflow-y-auto">
      <div className="flex items-center justify-between px-2 mb-1">
        <span className="telemetry-label">Devices</span>
        <button
          onClick={() => getSocket().emit('getConnectedDevices')}
          aria-label="Refresh devices"
          title="Refresh devices"
          className="p-1 -mr-1 text-muted-foreground hover:text-foreground rounded transition-colors"
        >
          <RefreshCw size={12} strokeWidth={1.75} />
        </button>
      </div>

      {renderedDevices.length === 0 && (
        <div className="px-2 py-3 text-xs text-muted-foreground/60">
          No devices
        </div>
      )}

      {renderedDevices.map(({ d, fading }) => {
        const active = d.axfId === selectedDeviceId
        const typeId = d.deviceTypeId || deviceTypeFromAxfId(d.axfId)
        const typeName = typeNameById.get(typeId) || `Type ${typeId}`
        return (
          <button
            key={d.axfId}
            onClick={() => selectDevice(d.axfId)}
            className={`relative rounded-md border border-border bg-surface-dark text-left px-3 py-2.5 flex flex-col gap-0.5 hover:bg-white/[0.03] animate-in fade-in duration-200 transition-opacity ${fading ? 'opacity-0' : 'opacity-100'}`}
            style={{
              borderLeftWidth: 3,
              borderLeftColor: active ? '#00C853' : 'var(--color-border)',
              transitionDuration: `${EXIT_ANIM_MS}ms`,
              pointerEvents: fading ? 'none' : 'auto',
            }}
          >
            {/* Status LED — top right */}
            <div
              data-led={active ? 'active' : 'idle'}
              className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: active ? '#00C853' : '#333' }}
            />
            <div className="text-xs text-foreground truncate pr-5 tracking-tight">
              {d.axfId}
            </div>
            <div className="telemetry-label truncate pr-5">
              {typeName}
            </div>
          </button>
        )
      })}
    </div>
  )
}
