import { useEffect, useState, useMemo } from 'react'
import { useDeviceStore } from '../../stores/deviceStore'
import { useUiStore } from '../../stores/uiStore'
import { getSocket } from '../../lib/socket'
import { getLastSeenForDevice } from '../../stores/liveDataStore'
import { deviceTypeFromAxfId } from '../../lib/deviceIds'
import { plate3d } from '../../lib/theme'
import type { ModelMetadata } from '../../stores/deviceStore'

const STALE_MS = 3000

/** Converts a package_date value to a human-readable relative string.
 *  Handles both unix seconds and unix milliseconds automatically. */
function formatRelativeDate(packageDate: number): string {
  const ms = packageDate < 1e12 ? packageDate * 1000 : packageDate
  const diff = Date.now() - ms
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function locationLabel(location: ModelMetadata['location']): string {
  if (location === 'both') return 'SYNCED'
  if (location === 'local') return 'LOCAL ONLY'
  return 'REMOTE ONLY'
}

export function ModelsPage() {
  const devices = useDeviceStore((s) => s.devices)
  const deviceTypes = useDeviceStore((s) => s.deviceTypes)
  const modelsByDevice = useDeviceStore((s) => s.modelsByDevice)
  const setShowModelPackager = useUiStore((s) => s.setShowModelPackager)

  // Tick to re-evaluate the streaming filter at a reasonable cadence
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 500)
    return () => clearInterval(id)
  }, [])

  // Emit getModelMetadata on mount and whenever connected devices change
  useEffect(() => {
    const socket = getSocket()
    for (const device of devices) {
      socket.emit('getModelMetadata', { deviceId: device.axfId })
    }
  }, [devices])

  const typeNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of deviceTypes) map.set(t.deviceTypeId, t.name)
    return map
  }, [deviceTypes])

  // Filter to devices that are currently streaming (recently seen or still initializing)
  const now = performance.now()
  const streamingDevices = devices.filter((d) => {
    const lastSeen = getLastSeenForDevice(d.axfId)
    if (lastSeen === null) return true // still initializing
    return now - lastSeen < STALE_MS
  })

  const handleActivate = (deviceId: string, modelId: string) => {
    const socket = getSocket()
    socket.emit('activateModel', { deviceId, modelId })
    setTimeout(() => {
      socket.emit('getModelMetadata', { deviceId })
    }, 200)
  }

  const handleDeactivate = (deviceId: string, modelId: string) => {
    const socket = getSocket()
    // Backend only uses device_id for the actual deactivation, but its log
    // line reads model_id unconditionally — pass both to avoid a KeyError.
    socket.emit('deactivateModel', { deviceId, modelId })
    setTimeout(() => {
      socket.emit('getModelMetadata', { deviceId })
    }, 200)
  }

  return (
    <div className="flex-1 flex flex-col p-4 gap-4 overflow-auto">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Models</h2>
        <button
          onClick={() => setShowModelPackager(true)}
          className="px-3 py-1 text-sm border border-border text-foreground rounded-md bg-transparent hover:border-[#7AB8FF] hover:text-[#7AB8FF] transition-colors"
        >
          Package Model
        </button>
      </div>

      {/* Empty state */}
      {streamingDevices.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground text-center">
            No devices connected. Plug in a plate to manage its model.
          </p>
        </div>
      )}

      {/* Per-device cards */}
      {streamingDevices.map((d) => {
        const typeId = d.deviceTypeId || deviceTypeFromAxfId(d.axfId)
        const typeName = typeNameById.get(typeId) || `Type ${typeId}`
        const models = modelsByDevice[d.axfId] ?? null
        const activeModel = models?.find((m) => m.modelActive) ?? null
        const inactiveModels = models?.filter((m) => !m.modelActive) ?? []
        const hasActiveModel = activeModel !== null
        const stripeColor = hasActiveModel ? '#00C853' : 'var(--color-border)'

        return (
          <div
            key={d.axfId}
            className="rounded-md border border-border bg-surface-dark p-4 flex flex-col gap-3"
            style={{ borderLeftWidth: 3, borderLeftColor: stripeColor }}
          >
            {/* Card header row */}
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-foreground tracking-tight">{d.axfId}</span>
                <span className="telemetry-label">{typeName}</span>
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: hasActiveModel ? '#FFC107' : '#333' }}
                />
                <span
                  className="telemetry-label uppercase"
                  style={{ color: hasActiveModel ? plate3d.activeAmber : undefined }}
                >
                  {hasActiveModel ? 'ACTIVE MODEL' : 'NO ACTIVE MODEL'}
                </span>
              </div>
            </div>

            {/* No models loaded yet */}
            {models === null && (
              <p className="text-xs text-muted-foreground">Loading models…</p>
            )}

            {/* Models loaded but empty */}
            {models !== null && models.length === 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-muted-foreground">
                  No models found for this device. Package one to get started.
                </p>
                <button
                  onClick={() => setShowModelPackager(true)}
                  className="self-start px-3 py-1 text-sm border rounded-md bg-transparent transition-colors"
                  style={{ borderColor: plate3d.edgeCyan, color: plate3d.edgeCyan }}
                >
                  Package Model
                </button>
              </div>
            )}

            {/* Active model block */}
            {models !== null && models.length > 0 && (
              <div className="flex flex-col gap-3">
                {hasActiveModel ? (
                  <div className="flex flex-col gap-1.5">
                    <span className="font-mono text-sm text-foreground">{activeModel!.modelId}</span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs text-muted-foreground">
                        Packaged {formatRelativeDate(activeModel!.packageDate)}
                      </span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="telemetry-label uppercase text-muted-foreground">
                        {locationLabel(activeModel!.location)}
                      </span>
                    </div>
                    <button
                      onClick={() => handleDeactivate(d.axfId, activeModel!.modelId)}
                      className="self-start mt-1 px-3 py-1 text-sm border border-border text-muted-foreground rounded-md bg-transparent hover:border-[#7AB8FF] hover:text-[#7AB8FF] transition-colors"
                    >
                      Deactivate
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No model assigned. Pick one below:
                  </p>
                )}

                {/* Inactive models list */}
                {inactiveModels.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {hasActiveModel && (
                      <div className="border-t border-border/40 pt-2">
                        <span className="telemetry-label text-muted-foreground/60">Other models</span>
                      </div>
                    )}
                    {inactiveModels.map((m) => (
                      <div
                        key={m.modelId}
                        className="flex items-center justify-between gap-2 py-0.5"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-xs text-foreground truncate">{m.modelId}</span>
                          <span className="telemetry-label text-muted-foreground flex-shrink-0">
                            · {formatRelativeDate(m.packageDate)}
                          </span>
                        </div>
                        <button
                          onClick={() => handleActivate(d.axfId, m.modelId)}
                          className="flex-shrink-0 px-3 py-1 text-sm border rounded-md bg-transparent transition-colors"
                          style={{ borderColor: plate3d.edgeCyan, color: plate3d.edgeCyan }}
                        >
                          Activate
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
