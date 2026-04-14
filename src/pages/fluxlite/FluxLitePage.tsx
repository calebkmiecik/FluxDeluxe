import { useState, useCallback } from 'react'
import { useUiStore } from '../../stores/uiStore'
import { useDeviceStore } from '../../stores/deviceStore'
import { ForcePlot } from '../../components/canvas/ForcePlot'
import { PlateCanvas } from '../../components/canvas/PlateCanvas'
import { ControlPanel } from './ControlPanel'
import { HistoryPage } from './HistoryPage'
import { ModelsPage } from './ModelsPage'
import { ModelPackager } from './ModelPackager'
import { getSocket } from '../../lib/socket'

const LITE_NAV = [
  { id: 'live' as const, label: 'Live' },
  { id: 'history' as const, label: 'History' },
  { id: 'models' as const, label: 'Models' },
] as const

export function FluxLitePage() {
  const { activeLitePage, setActiveLitePage } = useUiStore()
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId)
  const devices = useDeviceStore((s) => s.devices)

  const [rotation, setRotation] = useState(0)
  const [activeCell, setActiveCell] = useState<{ row: number; col: number } | null>(null)
  const [cellColors] = useState<Map<string, string>>(new Map())
  const [cellTexts] = useState<Map<string, string>>(new Map())

  const selectedDevice = devices.find((d) => d.axfId === selectedDeviceId)
  const deviceType = selectedDevice?.deviceTypeId || '07'

  const handleCellClick = useCallback((row: number, col: number) => {
    setActiveCell({ row, col })
  }, [])

  const handleTare = useCallback(() => {
    getSocket().emit('tareAll')
  }, [])

  const handleRefresh = useCallback(() => {
    getSocket().emit('getConnectedDevices')
  }, [])

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Sub-nav tabs */}
      <div className="flex gap-1 px-4 pt-2 pb-1 border-b border-border">
        {LITE_NAV.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveLitePage(item.id)}
            className={`px-3 py-1.5 text-sm rounded-t transition-colors ${
              activeLitePage === item.id
                ? 'text-foreground bg-card border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Page content */}
      <div className="flex-1 overflow-hidden">
        {activeLitePage === 'live' && (
          <div className="flex h-full">
            {/* Left: Plate + Force Plot stacked */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* PlateCanvas — top ~60% */}
              <div className="flex-[3] min-h-0 p-2">
                <PlateCanvas
                  deviceType={deviceType}
                  rotation={rotation}
                  cellColors={cellColors}
                  cellTexts={cellTexts}
                  activeCell={activeCell}
                  onCellClick={handleCellClick}
                  onRotate={() => setRotation((r) => (r + 1) % 4)}
                  onTare={handleTare}
                  onRefresh={handleRefresh}
                />
              </div>
              {/* ForcePlot — bottom ~40% */}
              <div className="flex-[2] min-h-0 p-2 pt-0">
                <ForcePlot />
              </div>
            </div>

            {/* Right: Control Panel */}
            <div className="w-56 border-l border-border bg-card flex-shrink-0">
              <ControlPanel />
            </div>
          </div>
        )}

        {activeLitePage === 'history' && <HistoryPage />}
        {activeLitePage === 'models' && <ModelsPage />}
      </div>

      <ModelPackager />
    </div>
  )
}
