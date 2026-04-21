import { useRef, useMemo, useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { useAnimationFrame } from '../../hooks/useAnimationFrame'
import { useDeviceStore } from '../../stores/deviceStore'
import { getSocket } from '../../lib/socket'
import { deviceTypeFromAxfId } from '../../lib/deviceIds'
import { getLastSeenForDevice } from '../../stores/liveDataStore'

const STALE_MS = 3000

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

  // Tick once a second so the stale-filter below re-evaluates. We don't need
  // 60fps for this — 1Hz is plenty to hide unplugged devices within a second.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])

  // Hide devices that were streaming but have gone silent (unplugged).
  // Devices that have never produced a frame are kept visible — they may be
  // still initializing.
  const now = performance.now()
  const visibleDevices = devices.filter((d) => {
    const lastSeen = getLastSeenForDevice(d.axfId)
    if (lastSeen === null) return true
    return now - lastSeen < STALE_MS
  })

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

      {visibleDevices.length === 0 && (
        <div className="px-2 py-3 text-xs text-muted-foreground/60">
          No devices
        </div>
      )}

      {visibleDevices.map((d) => {
        const active = d.axfId === selectedDeviceId
        const typeId = d.deviceTypeId || deviceTypeFromAxfId(d.axfId)
        const typeName = typeNameById.get(typeId) || `Type ${typeId}`
        return (
          <button
            key={d.axfId}
            onClick={() => selectDevice(d.axfId)}
            className="relative rounded-md border border-border bg-surface-dark text-left px-3 py-2.5 transition-all duration-150 flex flex-col gap-0.5 hover:bg-white/[0.03]"
            style={{
              borderLeftWidth: 3,
              borderLeftColor: active ? '#00C853' : 'var(--color-border)',
            }}
          >
            {/* Status LED — top right */}
            <div
              data-led={active ? 'active' : 'idle'}
              className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: active ? '#00C853' : '#333' }}
            />
            <div className="font-mono text-xs text-foreground truncate pr-5 tracking-tight">
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
