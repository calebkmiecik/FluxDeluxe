import { useRef, useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import { useAnimationFrame } from '../../hooks/useAnimationFrame'
import { useDeviceStore } from '../../stores/deviceStore'
import { getSocket } from '../../lib/socket'
import { deviceTypeFromAxfId } from '../../lib/deviceIds'

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

      {devices.length === 0 && (
        <div className="px-2 py-3 text-xs text-muted-foreground/60">
          No devices
        </div>
      )}

      {devices.map((d) => {
        const active = d.axfId === selectedDeviceId
        const typeId = d.deviceTypeId || deviceTypeFromAxfId(d.axfId)
        const typeName = typeNameById.get(typeId) || `Type ${typeId}`
        return (
          <button
            key={d.axfId}
            onClick={() => selectDevice(d.axfId)}
            className={`relative rounded-md border text-left px-3 py-2 transition-all duration-150 flex flex-col gap-0.5 ${
              active
                ? 'border-border bg-surface-dark'
                : 'border-transparent bg-white/[0.02] hover:bg-white/[0.04]'
            }`}
            style={active ? { borderLeftWidth: 3, borderLeftColor: '#00C853' } : { borderLeftWidth: 3 }}
          >
            {/* LED indicator — top right */}
            <div
              data-led={active ? 'active' : 'idle'}
              className="absolute top-2 right-2 w-2 h-2 rounded-full"
              style={{ backgroundColor: active ? '#00C853' : '#333' }}
            />
            <div className="text-xs text-foreground truncate pr-4 tracking-tight">
              {d.axfId}
            </div>
            <div className="text-[11px] text-muted-foreground truncate pr-4">
              {typeName}
            </div>
          </button>
        )
      })}
    </div>
  )
}
