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
      <div className="flex gap-0 px-4 pt-2 pb-0 border-b border-border">
        {LITE_NAV.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveLitePage(item.id)}
            className={`px-4 py-2 text-xs font-mono tracking-widest uppercase transition-all duration-150 border-b-2 ${
              activeLitePage === item.id
                ? 'text-foreground border-primary'
                : 'text-muted-foreground border-transparent hover:text-foreground hover:border-border'
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
            {/* Left: Plate + Force Plot stacked (~66% width) */}
            <div className="flex-[2] flex flex-col min-w-0">
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

            {/* Right: Control Panel (~33% width) */}
            <div className="flex-[1] border-l border-border bg-card min-w-0">
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
