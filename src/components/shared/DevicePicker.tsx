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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface border border-border rounded-lg p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4">Select Device</h2>
        {filtered.length === 0 ? (
          <p className="text-zinc-400">No devices available.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((device) => (
              <button
                key={device.axfId}
                onClick={() => { selectDevice(device.axfId); onClose() }}
                className="flex items-center justify-between p-3 rounded bg-background border border-border hover:border-primary/50 transition-colors text-left"
              >
                <div>
                  <div className="font-medium">{device.name || device.axfId}</div>
                  <div className="text-sm text-zinc-400">Type {device.deviceTypeId}</div>
                </div>
                <div className={`w-2 h-2 rounded-full ${device.status === 'connected' ? 'bg-success' : 'bg-zinc-500'}`} />
              </button>
            ))}
          </div>
        )}
        <button onClick={onClose} className="mt-4 px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}
