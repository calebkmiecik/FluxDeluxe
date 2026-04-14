import { useEffect } from 'react'
import { useDeviceStore } from '../../stores/deviceStore'
import { useUiStore } from '../../stores/uiStore'
import { getSocket } from '../../lib/socket'

export function ModelsPage() {
  const devices = useDeviceStore((s) => s.devices)
  const models = useDeviceStore((s) => s.models)
  const setShowModelPackager = useUiStore((s) => s.setShowModelPackager)

  useEffect(() => {
    // Request model metadata for each connected device
    const socket = getSocket()
    for (const device of devices) {
      socket.emit('getModelMetadata', { deviceId: device.axfId })
    }
  }, [devices])

  const handleActivate = (deviceId: string, modelId: string) => {
    getSocket().emit('activateModel', { deviceId, modelId })
  }

  const handleDeactivate = (deviceId: string, modelId: string) => {
    getSocket().emit('deactivateModel', { deviceId, modelId })
  }

  return (
    <div className="flex-1 flex flex-col p-4 gap-4 overflow-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Models</h2>
        <button
          onClick={() => setShowModelPackager(true)}
          className="px-3 py-1.5 bg-primary text-white text-sm rounded hover:bg-primary/80 transition-colors"
        >
          Package New Model
        </button>
      </div>

      {(models as any[]).length === 0 ? (
        <p className="text-zinc-400">No models loaded.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {(models as any[]).map((model: any, i: number) => (
            <div key={model.modelId || i} className="bg-surface border border-border rounded-lg p-4 flex items-center justify-between">
              <div>
                <div className="font-medium">{model.name || model.modelId || 'Unknown Model'}</div>
                <div className="text-sm text-zinc-400">
                  {model.deviceId && `Device: ${model.deviceId}`}
                  {model.type && ` • Type: ${model.type}`}
                </div>
              </div>
              <div className="flex gap-2">
                {model.active ? (
                  <button
                    onClick={() => handleDeactivate(model.deviceId, model.modelId)}
                    className="px-3 py-1 text-sm border border-border rounded hover:bg-white/5"
                  >
                    Deactivate
                  </button>
                ) : (
                  <button
                    onClick={() => handleActivate(model.deviceId, model.modelId)}
                    className="px-3 py-1 text-sm bg-primary text-white rounded hover:bg-primary/80"
                  >
                    Activate
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
