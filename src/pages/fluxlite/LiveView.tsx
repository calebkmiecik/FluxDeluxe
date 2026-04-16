import { useState, useCallback } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useDeviceStore } from '../../stores/deviceStore'
import { useLiveDataStore } from '../../stores/liveDataStore'
import { ForcePlot } from '../../components/canvas/ForcePlot'
import { COPVisualization } from '../../components/canvas/COPVisualization'
import { PlateCanvas } from '../../components/canvas/plate3d/PlateCanvas'
import { getSocket } from '../../lib/socket'
import { deviceTypeFromAxfId } from '../../lib/deviceIds'

export function LiveView() {
  const phase = useSessionStore((s) => s.sessionPhase)
  const setPhase = useSessionStore((s) => s.setSessionPhase)
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId)
  const devices = useDeviceStore((s) => s.devices)

  const [rotation, setRotation] = useState(0)
  const [activeCell, setActiveCell] = useState<{ row: number; col: number } | null>(null)
  const [cellColors, setCellColors] = useState<Map<string, string>>(new Map())
  const [cellTexts, setCellTexts] = useState<Map<string, string>>(new Map())

  const selectedDevice = devices.find((d) => d.axfId === selectedDeviceId)
  const deviceType =
    selectedDevice?.deviceTypeId ||
    (selectedDevice ? deviceTypeFromAxfId(selectedDevice.axfId) : undefined) ||
    '07'

  const handleCellClick = useCallback((row: number, col: number) => {
    setActiveCell({ row, col })
  }, [])

  const handleTare = useCallback(() => {
    getSocket().emit('tareAll')
  }, [])

  const handleRefresh = useCallback(() => {
    getSocket().emit('getConnectedDevices')
  }, [])

  const handleStopCapture = useCallback(() => {
    getSocket().emit('stopCapture', {})
  }, [])

  const handleCancelCapture = useCallback(() => {
    getSocket().emit('cancelCapture', {})
    setPhase('IDLE')
  }, [setPhase])

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Phase indicator */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${
            phase === 'CAPTURING' ? 'bg-danger animate-pulse' : 'bg-success'
          }`} />
          <span className="text-sm">
            {phase === 'ARMED' ? 'Waiting for subject...' :
             phase === 'STABLE' ? 'Stable — ready to capture' :
             phase === 'CAPTURING' ? 'Capturing...' : phase}
          </span>
        </div>
        <div className="flex gap-2">
          {phase === 'CAPTURING' && (
            <button onClick={handleStopCapture} className="px-3 py-1 text-sm bg-destructive text-white rounded-md hover:bg-destructive/80">
              Stop
            </button>
          )}
          <button onClick={handleCancelCapture} className="px-3 py-1 text-sm bg-transparent border border-border text-muted-foreground rounded-md hover:bg-white/5 transition-colors">
            Cancel
          </button>
        </div>
      </div>

      {/* Main layout: PlateCanvas hero + side panels */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: PlateCanvas (hero ~60%) */}
        <div className="flex-[3] min-w-0">
          <PlateCanvas
            deviceType={deviceType}
            rotation={rotation}
            cellColors={cellColors}
            cellTexts={cellTexts}
            activeCell={activeCell}
            onCellClick={handleCellClick}
            onRotate={() => setRotation((r) => (r + 1) % 4)}
            onTare={handleTare}
            liveTesting={phase === 'CAPTURING'}
          />
        </div>

        {/* Right: ForcePlot + COP stacked */}
        <div className="flex-[2] flex flex-col p-2 gap-2 min-w-0">
          <div className="flex-1 min-h-0">
            <ForcePlot />
          </div>
          <div className="flex-1 min-h-0">
            <COPVisualization />
          </div>
        </div>
      </div>
    </div>
  )
}
