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

  // Track which devices have their "previous models" section expanded.
  const [expandedDevices, setExpandedDevices] = useState<Set<string>>(new Set())
  const toggleExpanded = (deviceId: string) => {
    setExpandedDevices((prev) => {
      const next = new Set(prev)
      if (next.has(deviceId)) next.delete(deviceId)
      else next.add(deviceId)
      return next
    })
  }

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
    <div className="flex-1 h-full flex flex-col p-4 overflow-auto">
     <div className="w-full max-w-3xl mx-auto my-auto flex flex-col gap-3">
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
        const inactiveModels =
          models?.filter((m) => !m.modelActive).sort((a, b) => b.packageDate - a.packageDate) ?? []
        const hasActiveModel = activeModel !== null

        // When no active model exists, we force-show the inactive models so
        // the user has a visible path forward. Otherwise default to collapsed.
        const showInactive = !hasActiveModel || expandedDevices.has(d.axfId)

        return (
          <div
            key={d.axfId}
            className="rounded-md border border-border bg-surface-dark px-4 py-3 flex flex-col gap-2 animate-in fade-in duration-200"
          >
            {/* Card header row — axfId · type  [LED] STATUS */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm text-foreground tracking-tight truncate">{d.axfId}</span>
                <span className="telemetry-label truncate">· {typeName}</span>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: hasActiveModel ? plate3d.edgeCyan : '#333' }}
                />
                <span
                  className="telemetry-label uppercase"
                  style={{ color: hasActiveModel ? plate3d.edgeCyan : undefined }}
                >
                  {hasActiveModel ? 'ACTIVE' : 'NO MODEL'}
                </span>
              </div>
            </div>

            {/* No models loaded yet */}
            {models === null && (
              <p className="text-xs text-muted-foreground/60">Loading…</p>
            )}

            {/* Models loaded but empty */}
            {models !== null && models.length === 0 && (
              <div className="flex items-center justify-between gap-2 py-1">
                <p className="text-xs text-muted-foreground">No models for this device.</p>
                <button
                  onClick={() => setShowModelPackager(true)}
                  className="flex-shrink-0 px-2.5 py-1 text-xs border rounded bg-transparent transition-colors"
                  style={{ borderColor: plate3d.edgeCyan, color: plate3d.edgeCyan }}
                >
                  Package
                </button>
              </div>
            )}

            {/* Active model row — keyed by modelId so it re-fades on swap */}
            {models !== null && hasActiveModel && (
              <div
                key={activeModel!.modelId}
                className="flex items-center justify-between gap-2 py-1 animate-in fade-in duration-200"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-xs text-foreground truncate">{activeModel!.modelId}</span>
                  <span className="telemetry-label text-muted-foreground flex-shrink-0">
                    · {formatRelativeDate(activeModel!.packageDate)} · {locationLabel(activeModel!.location)}
                  </span>
                </div>
                <button
                  onClick={() => handleDeactivate(d.axfId, activeModel!.modelId)}
                  className="flex-shrink-0 px-2.5 py-1 text-xs border border-border text-muted-foreground rounded bg-transparent hover:border-[#7AB8FF] hover:text-[#7AB8FF] transition-colors"
                >
                  Deactivate
                </button>
              </div>
            )}

            {/* Previous-models toggle + list */}
            {inactiveModels.length > 0 && (
              <>
                {hasActiveModel && (
                  <button
                    onClick={() => toggleExpanded(d.axfId)}
                    className="self-start flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-0.5"
                  >
                    <span
                      className="inline-block transition-transform duration-200"
                      style={{ transform: showInactive ? 'rotate(90deg)' : 'rotate(0deg)' }}
                    >
                      ▸
                    </span>
                    <span>
                      {inactiveModels.length} previous model{inactiveModels.length === 1 ? '' : 's'}
                    </span>
                  </button>
                )}
                {/* Smooth height animation via grid-rows 0fr↔1fr trick */}
                <div
                  className="grid transition-[grid-template-rows] duration-250 ease-out"
                  style={{ gridTemplateRows: showInactive ? '1fr' : '0fr' }}
                >
                  <div className="overflow-hidden">
                    <div className={`flex flex-col ${hasActiveModel ? 'border-t border-border/30 pt-1' : ''}`}>
                      {inactiveModels.map((m) => (
                      <div
                        key={m.modelId}
                        className="flex items-center justify-between gap-2 py-1.5 animate-in fade-in duration-200"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-xs text-muted-foreground truncate">{m.modelId}</span>
                          <span className="telemetry-label text-muted-foreground/70 flex-shrink-0">
                            · {formatRelativeDate(m.packageDate)}
                          </span>
                        </div>
                        <button
                          onClick={() => handleActivate(d.axfId, m.modelId)}
                          className="flex-shrink-0 px-2.5 py-1 text-xs border rounded bg-transparent transition-colors"
                          style={{ borderColor: plate3d.edgeCyan, color: plate3d.edgeCyan }}
                        >
                          Activate
                        </button>
                      </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )
      })}
     </div>
    </div>
  )
}
