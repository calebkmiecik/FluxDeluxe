import { useState, useCallback, useEffect } from 'react'
import { useUiStore } from '../../stores/uiStore'
import { useDeviceStore } from '../../stores/deviceStore'
import { useLiveDataStore } from '../../stores/liveDataStore'
import { useLiveTestStore } from '../../stores/liveTestStore'
import { ForcePlot } from '../../components/canvas/ForcePlot'
import { ForceGauges } from '../../components/canvas/ForceGauges'
import { PlateCanvas } from '../../components/canvas/plate3d/PlateCanvas'
import { TempGauge } from '../../components/canvas/TempGauge'
import { DeviceList } from '../../components/shared/DeviceList'
import { DataModeToggle } from '../../components/shared/DataModeToggle'
import { ControlPanel } from './ControlPanel'
import { DashboardPage } from './DashboardPage'
import { ModelsPage } from './ModelsPage'
import { ModelPackager } from './ModelPackager'
import { getSocket } from '../../lib/socket'
import { measurementEngine } from '../../lib/measurementEngine'
import { WARMUP_TRIGGER_N, TARE_THRESHOLD_N } from '../../lib/liveTestTypes'
import { type Axis as DataModeAxis, type DataMode, getModeConfig } from '../../lib/dataMode'

const LITE_NAV = [
  { id: 'history' as const, label: 'Dashboard' },
  { id: 'live' as const, label: 'Live Testing' },
  { id: 'models' as const, label: 'Models' },
] as const

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

  const [dataMode, setDataMode] = useState<DataMode>('forces')
  // Separate enabled sets per mode so toggling keeps your selection per view
  const [enabledForceAxes, setEnabledForceAxes] = useState<Set<DataModeAxis>>(new Set(['fz']))
  const [enabledMomentAxes, setEnabledMomentAxes] = useState<Set<DataModeAxis>>(new Set(['mz']))
  const enabledAxes = dataMode === 'forces' ? enabledForceAxes : enabledMomentAxes
  const setEnabledAxes = dataMode === 'forces' ? setEnabledForceAxes : setEnabledMomentAxes
  const toggleAxis = useCallback((axis: DataModeAxis) => {
    setEnabledAxes((prev) => {
      const next = new Set(prev)
      if (next.has(axis)) next.delete(axis)
      else next.add(axis)
      return next
    })
  }, [setEnabledAxes])

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
      {/* Top bar: brand + sub-nav tabs */}
      <div className="flex items-center px-4 pt-2 pb-0 border-b border-border">
        <div className="flex items-center pr-4 pb-2">
          <span className="text-lg font-semibold tracking-tight text-foreground">
            FluxLite
          </span>
        </div>
        <div className="flex gap-0 flex-1">
          {LITE_NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveLitePage(item.id)}
              className={`px-4 py-2 text-sm transition-all duration-150 border-b-2 ${
                activeLitePage === item.id
                  ? 'text-foreground border-primary'
                  : 'text-muted-foreground border-transparent hover:text-foreground hover:border-border'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Page content */}
      <div className="flex-1 overflow-hidden">
        {activeLitePage === 'live' && (
          <div className="flex h-full">
            {/* Main visualization area */}
            <div className="flex-[2] flex flex-col min-w-0">
              {/* Top row: DeviceList + PlateCanvas + TempGauge */}
              <div className="flex-[3] min-h-0 flex p-2">
                {/* Device list — left column */}
                <div className="w-52 flex-shrink-0 mr-2 border-r border-border pr-2">
                  <DeviceList />
                </div>
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
                    liveTesting={phase === 'TESTING'}
                  />
                </div>
                {/* Temperature bar — slim vertical strip, ~1/3 height, top-aligned */}
                <div className="w-10 flex-shrink-0 ml-1 flex items-start justify-center">
                  <div className="w-full h-1/3">
                    <TempGauge />
                  </div>
                </div>
              </div>
              {/* Bottom row: ForcePlot + ForceGauges */}
              <div className="flex-[2] min-h-0 flex p-2 pt-0 gap-2">
                {/* Plot panel: canvas + floating toggle overlay */}
                <div className="flex-1 min-w-0 rounded-md border border-border bg-surface-dark overflow-hidden relative">
                  <ForcePlot mode={dataMode} enabledAxes={enabledAxes} />
                  <div className="absolute top-2 right-2 z-10">
                    <DataModeToggle mode={dataMode} onChange={setDataMode} />
                  </div>
                </div>
                {/* Gauges */}
                <div className="w-40 flex-shrink-0">
                  <ForceGauges mode={dataMode} enabledAxes={enabledAxes} onToggleAxis={toggleAxis} />
                </div>
              </div>
            </div>

            {/* Right: Control Panel */}
            <div className="flex-[1] border-l border-border bg-card min-w-0">
              <ControlPanel />
            </div>
          </div>
        )}

        {activeLitePage === 'history' && <DashboardPage />}
        {activeLitePage === 'models' && <ModelsPage />}
      </div>

      <ModelPackager />
    </div>
  )
}
