import { useState, useCallback, useEffect } from 'react'
import { useUiStore } from '../../stores/uiStore'
import { useDeviceStore } from '../../stores/deviceStore'
import { useLiveDataStore } from '../../stores/liveDataStore'
import { useLiveTestStore } from '../../stores/liveTestStore'
import { ForcePlot } from '../../components/canvas/ForcePlot'
import { PlateCanvas } from '../../components/canvas/PlateCanvas'
import { TempGauge } from '../../components/canvas/TempGauge'
import { MomentsStrip } from '../../components/canvas/MomentsStrip'
import { ControlPanel } from './ControlPanel'
import { HistoryPage } from './HistoryPage'
import { ModelsPage } from './ModelsPage'
import { ModelPackager } from './ModelPackager'
import { getSocket } from '../../lib/socket'
import { measurementEngine } from '../../lib/measurementEngine'
import { WARMUP_TRIGGER_N, TARE_THRESHOLD_N } from '../../lib/liveTestTypes'

const LITE_NAV = [
  { id: 'live' as const, label: 'Live' },
  { id: 'history' as const, label: 'History' },
  { id: 'models' as const, label: 'Models' },
] as const

type Axis = 'fx' | 'fy' | 'fz'

export function FluxLitePage() {
  const { activeLitePage, setActiveLitePage } = useUiStore()
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId)
  const devices = useDeviceStore((s) => s.devices)

  const phase = useLiveTestStore((s) => s.phase)
  const stages = useLiveTestStore((s) => s.stages)
  const activeStageIndex = useLiveTestStore((s) => s.activeStageIndex)
  const measurements = useLiveTestStore((s) => s.measurements)
  const metadata = useLiveTestStore((s) => s.metadata)

  const [rotation, setRotation] = useState(0)
  const [activeCell, setActiveCell] = useState<{ row: number; col: number } | null>(null)

  const [enabledAxes, setEnabledAxes] = useState<Set<Axis>>(new Set(['fz']))
  const toggleAxis = useCallback((axis: Axis) => {
    setEnabledAxes((prev) => {
      const next = new Set(prev)
      if (next.has(axis)) next.delete(axis)
      else next.add(axis)
      return next
    })
  }, [])

  const selectedDevice = devices.find((d) => d.axfId === selectedDeviceId)
  const deviceType = metadata?.deviceType || selectedDevice?.deviceTypeId || '07'
  const activeStage = stages[activeStageIndex]

  // Build cell colors/texts from measurements for current stage
  const cellColors = new Map<string, string>()
  const cellTexts = new Map<string, string>()
  measurements.forEach((m) => {
    if (m.stageIndex === activeStageIndex) {
      cellColors.set(`${m.row},${m.col}`, m.colorBin)
      cellTexts.set(`${m.row},${m.col}`, `${m.meanFzN.toFixed(0)}N`)
    }
  })

  // Wire measurement engine callbacks
  useEffect(() => {
    measurementEngine.setCallbacks(
      (status) => useLiveTestStore.getState().setMeasurementStatus(status),
      (m) => useLiveTestStore.getState().recordMeasurement(m),
    )
    return () => measurementEngine.setCallbacks(() => {}, () => {})
  }, [])

  // Update engine device type
  useEffect(() => {
    measurementEngine.setDeviceType(deviceType)
  }, [deviceType])

  // Update engine's done cells set
  useEffect(() => {
    const done = new Set<string>()
    measurements.forEach((_, key) => done.add(key))
    measurementEngine.setDoneCells(done)
  }, [measurements])

  // Process incoming frames: warmup/tare gates + measurement engine
  useEffect(() => {
    if (phase !== 'TESTING' && phase !== 'WARMUP' && phase !== 'TARE') return

    const interval = setInterval(() => {
      const frame = useLiveDataStore.getState().currentFrame
      if (!frame) return
      if (selectedDeviceId && frame.id !== selectedDeviceId) return

      const fz = Math.abs(frame.fz)
      const store = useLiveTestStore.getState()

      // Warmup gate: detect force trigger
      if (store.phase === 'WARMUP' && !store.warmupTriggered && fz >= WARMUP_TRIGGER_N) {
        store.triggerWarmup()
      }

      // Tare gate: detect step-off / step-on
      if (store.phase === 'TARE') {
        if (fz < TARE_THRESHOLD_N && !store.tareStartMs) {
          store.startTareCountdown()
        } else if (fz >= TARE_THRESHOLD_N && store.tareStartMs) {
          store.resetTareCountdown()
        }
      }

      // Measurement engine during active testing
      if (store.phase === 'TESTING' && activeStage) {
        measurementEngine.processFrame(frame, activeStage)
      }
    }, 16) // ~60Hz

    return () => clearInterval(interval)
  }, [phase, selectedDeviceId, activeStage])

  // Reset measurement engine on stage change
  useEffect(() => {
    measurementEngine.reset()
  }, [activeStageIndex])

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
            {/* Main visualization area */}
            <div className="flex-[2] flex flex-col min-w-0">
              {/* PlateCanvas + TempGauge — top ~60% */}
              <div className="flex-[3] min-h-0 flex p-2">
                <div className="flex-1 min-w-0">
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
                {/* Temperature bar — slim vertical strip */}
                <div className="w-10 flex-shrink-0 ml-1">
                  <TempGauge />
                </div>
              </div>
              {/* ForcePlot — bottom ~38% */}
              <div className="flex-[2] min-h-0 p-2 pt-0">
                <ForcePlot enabledAxes={enabledAxes} onToggleAxis={toggleAxis} />
              </div>
              {/* Moments strip — thin footer */}
              <div className="h-7 flex-shrink-0 border-t border-border">
                <MomentsStrip />
              </div>
            </div>

            {/* Right: Control Panel */}
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
