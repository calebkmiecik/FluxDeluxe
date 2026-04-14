import { useDeviceStore } from '../../stores/deviceStore'

interface DevicePickerProps {
  open: boolean
  onClose: () => void
  filterType?: string  // Only show devices of this type
}

export function DevicePicker({ open, onClose, filterType }: DevicePickerProps) {
  const devices = useDeviceStore((s) => s.devices)
  const selectDevice = useDeviceStore((s) => s.selectDevice)

  const filtered = filterType
    ? devices.filter((d) => d.deviceTypeId === filterType)
    : devices

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl shadow-xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold tracking-tight mb-4">Select Device</h2>
        {filtered.length === 0 ? (
          <p className="text-muted-foreground">No devices available.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((device) => (
              <button
                key={device.axfId}
                onClick={() => { selectDevice(device.axfId); onClose() }}
                className="flex items-center justify-between p-3 rounded-lg bg-background border border-border hover:border-primary/30 transition-colors text-left"
              >
                <div>
                  <div className="text-foreground font-medium">{device.name || device.axfId}</div>
                  <div className="text-sm text-muted-foreground">Type {device.deviceTypeId}</div>
                </div>
                <div className={`w-2 h-2 rounded-full ${device.status === 'connected' ? 'bg-success' : 'bg-zinc-500'}`} />
              </button>
            ))}
          </div>
        )}
        <button onClick={onClose} className="mt-4 px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}
