import { useState, useEffect, useRef } from 'react'
import { useDeviceStore } from '../../stores/deviceStore'
import { useLiveTestStore } from '../../stores/liveTestStore'
import { useLiveDataStore } from '../../stores/liveDataStore'
import { measurementEngine } from '../../lib/measurementEngine'
import { getSocket } from '../../lib/socket'
import {
  WARMUP_DURATION_MS, WARMUP_TRIGGER_N,
  TARE_DURATION_MS, TARE_THRESHOLD_N,
  type SessionMetadata,
} from '../../lib/liveTestTypes'
import { Play, Square, X, RotateCcw, RefreshCw, Scale, ChevronRight, ChevronLeft } from 'lucide-react'

const PHASE_DISPLAY: Record<string, { label: string; color: string; className?: string }> = {
  IDLE:         { label: 'STANDBY',  color: 'bg-muted-foreground' },
  WARMUP:       { label: 'WARMUP',   color: 'bg-warning', className: 'status-live' },
  TARE:         { label: 'TARE',     color: 'bg-warning', className: 'status-live' },
  TESTING:      { label: 'TESTING',  color: 'bg-success' },
  STAGE_SWITCH: { label: 'SWITCH',   color: 'bg-primary', className: 'status-live' },
  SUMMARY:      { label: 'COMPLETE', color: 'bg-primary' },
}

export function ControlPanel() {
  const phase = useLiveTestStore((s) => s.phase)
  const metadata = useLiveTestStore((s) => s.metadata)
  const stages = useLiveTestStore((s) => s.stages)
  const activeStageIndex = useLiveTestStore((s) => s.activeStageIndex)
  const measurementStatus = useLiveTestStore((s) => s.measurementStatus)
  const warmupTriggered = useLiveTestStore((s) => s.warmupTriggered)
  const warmupStartMs = useLiveTestStore((s) => s.warmupStartMs)
  const tareStartMs = useLiveTestStore((s) => s.tareStartMs)

  const connectionState = useDeviceStore((s) => s.connectionState)
  const devices = useDeviceStore((s) => s.devices)
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId)
  const selectDevice = useDeviceStore((s) => s.selectDevice)
  const selectedDevice = devices.find((d) => d.axfId === selectedDeviceId)

  const phaseInfo = PHASE_DISPLAY[phase] ?? PHASE_DISPLAY.IDLE
  const activeStage = stages[activeStageIndex]

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Phase badge */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-3">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${phaseInfo.color} ${phaseInfo.className ?? ''}`} />
        <span className="font-mono text-xs tracking-widest text-foreground">{phaseInfo.label}</span>
      </div>

      {phase === 'IDLE' && (
        <IdlePanel
          connectionState={connectionState}
          devices={devices}
          selectedDeviceId={selectedDeviceId}
          selectedDevice={selectedDevice}
          selectDevice={selectDevice}
        />
      )}

      {phase === 'WARMUP' && (
        <WarmupPanel warmupTriggered={warmupTriggered} warmupStartMs={warmupStartMs} />
      )}

      {phase === 'TARE' && (
        <TarePanel tareStartMs={tareStartMs} />
      )}

      {phase === 'TESTING' && activeStage && (
        <TestingPanel
          stage={activeStage}
          stageIndex={activeStageIndex}
          totalStages={stages.length}
          measurementStatus={measurementStatus}
        />
      )}

      {phase === 'SUMMARY' && (
        <SummaryPanel />
      )}

      {/* Quick actions — always visible */}
      <div className="mt-auto">
        <Section label="Actions">
          <div className="flex flex-col gap-2">
            <button
              onClick={() => { getSocket().emit('tareAll') }}
              disabled={connectionState !== 'READY'}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm bg-transparent border border-border text-muted-foreground rounded-md hover:bg-white/5 hover:text-foreground transition-colors disabled:opacity-40"
            >
              <Scale size={14} />
              Tare All
            </button>
            <button
              onClick={() => getSocket().emit('getConnectedDevices')}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm bg-transparent border border-border text-muted-foreground rounded-md hover:bg-white/5 hover:text-foreground transition-colors"
            >
              <RefreshCw size={14} />
              Refresh Devices
            </button>
          </div>
        </Section>
      </div>
    </div>
  )
}

// ── IDLE: Metadata form + Start ─────────────────────────────────
function IdlePanel({ connectionState, devices, selectedDeviceId, selectedDevice, selectDevice }: {
  connectionState: string
  devices: { axfId: string; name: string; deviceTypeId: string }[]
  selectedDeviceId: string | null
  selectedDevice: { axfId: string; name: string; deviceTypeId: string } | undefined
  selectDevice: (id: string | null) => void
}) {
  const startSession = useLiveTestStore((s) => s.startSession)
  const [testerName, setTesterName] = useState('')
  const [bodyWeightLbs, setBodyWeightLbs] = useState('')

  const bodyWeightN = parseFloat(bodyWeightLbs || '0') * 4.44822
  const canStart = connectionState === 'READY' && selectedDeviceId && testerName.trim() && bodyWeightN > 0

  const handleStart = () => {
    if (!canStart || !selectedDevice) return
    const meta: SessionMetadata = {
      testerName: testerName.trim(),
      bodyWeightN,
      deviceId: selectedDevice.axfId,
      deviceType: selectedDevice.deviceTypeId,
      modelId: selectedDevice.deviceTypeId,
      startedAt: Date.now(),
    }
    startSession(meta)
  }

  return (
    <>
      <Section label="Device">
        {devices.length > 0 ? (
          <>
            <select
              value={selectedDeviceId || ''}
              onChange={(e) => selectDevice(e.target.value || null)}
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono text-foreground focus:border-primary focus:outline-none transition-colors"
            >
              <option value="">Select device...</option>
              {devices.map((d) => (
                <option key={d.axfId} value={d.axfId}>
                  {d.name || d.axfId} (Type {d.deviceTypeId})
                </option>
              ))}
            </select>
            {selectedDevice && (
              <div className="mt-3 panel-inset p-3 grid grid-cols-2 gap-3">
                <div>
                  <div className="telemetry-label">Type</div>
                  <div className="telemetry-value">{selectedDevice.deviceTypeId}</div>
                </div>
                <div>
                  <div className="telemetry-label">Serial</div>
                  <div className="telemetry-value text-sm">{selectedDevice.axfId.slice(-8)}</div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="panel-inset p-3">
            <span className="text-sm text-muted-foreground font-mono">No devices found</span>
          </div>
        )}
      </Section>

      <Section label="Athlete">
        <div className="flex flex-col gap-3">
          <div>
            <label className="telemetry-label mb-1.5 block">Name</label>
            <input
              type="text"
              value={testerName}
              onChange={(e) => setTesterName(e.target.value)}
              placeholder="Enter name..."
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none transition-colors"
            />
          </div>
          <div>
            <label className="telemetry-label mb-1.5 block">Body Weight (lbs)</label>
            <input
              type="number"
              value={bodyWeightLbs}
              onChange={(e) => setBodyWeightLbs(e.target.value)}
              placeholder="e.g. 180"
              min="0"
              max="500"
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none transition-colors"
            />
            {bodyWeightN > 0 && (
              <div className="mt-1 text-xs text-muted-foreground font-mono">{bodyWeightN.toFixed(1)} N</div>
            )}
          </div>
        </div>
      </Section>

      <Section label="Session">
        <button
          onClick={handleStart}
          disabled={!canStart}
          className="w-full flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium tracking-wide bg-primary text-white rounded-md btn-glow transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Play size={16} fill="currentColor" />
          Start Session
        </button>
      </Section>
    </>
  )
}

// ── WARMUP: 20s precompression ──────────────────────────────────
function WarmupPanel({ warmupTriggered, warmupStartMs }: {
  warmupTriggered: boolean
  warmupStartMs: number | null
}) {
  const setPhase = useLiveTestStore((s) => s.setPhase)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!warmupStartMs) return
    const id = setInterval(() => {
      setElapsed(Date.now() - warmupStartMs)
    }, 100)
    return () => clearInterval(id)
  }, [warmupStartMs])

  const remainingSec = Math.max(0, (WARMUP_DURATION_MS - elapsed) / 1000)
  const progress = warmupTriggered ? Math.min(elapsed / WARMUP_DURATION_MS, 1) : 0

  // Auto-advance when warmup complete
  useEffect(() => {
    if (warmupTriggered && elapsed >= WARMUP_DURATION_MS) {
      setPhase('TARE')
    }
  }, [warmupTriggered, elapsed, setPhase])

  return (
    <Section label="Warmup">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {!warmupTriggered
            ? 'Jump on the plate to begin precompression...'
            : `Keep jumping — ${remainingSec.toFixed(0)}s remaining`}
        </p>

        {/* Progress bar */}
        <div className="w-full h-2 bg-background rounded-full overflow-hidden">
          <div
            className="h-full bg-warning rounded-full transition-all duration-200"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        <div className="panel-inset p-3 text-center">
          <div className="telemetry-label">Time Remaining</div>
          <div className="telemetry-value text-2xl">
            {warmupTriggered ? `${remainingSec.toFixed(0)}s` : '20s'}
          </div>
        </div>

        <button
          onClick={() => setPhase('TARE')}
          className="w-full px-4 py-2 text-sm bg-transparent border border-border text-muted-foreground rounded-md hover:bg-white/5 hover:text-foreground transition-colors"
        >
          Skip Warmup
        </button>
      </div>
    </Section>
  )
}

// ── TARE: 15s step-off countdown ────────────────────────────────
function TarePanel({ tareStartMs }: { tareStartMs: number | null }) {
  const setPhase = useLiveTestStore((s) => s.setPhase)
  const [elapsed, setElapsed] = useState(0)
  const [currentFz, setCurrentFz] = useState(0)

  useEffect(() => {
    const id = setInterval(() => {
      const frame = useLiveDataStore.getState().currentFrame
      if (frame) setCurrentFz(Math.abs(frame.fz))
      if (tareStartMs) setElapsed(Date.now() - tareStartMs)
    }, 100)
    return () => clearInterval(id)
  }, [tareStartMs])

  const remainingSec = tareStartMs ? Math.max(0, (TARE_DURATION_MS - elapsed) / 1000) : 15
  const progress = tareStartMs ? Math.min(elapsed / TARE_DURATION_MS, 1) : 0
  const isOffPlate = currentFz < TARE_THRESHOLD_N

  // Auto-tare and advance when countdown complete
  useEffect(() => {
    if (tareStartMs && elapsed >= TARE_DURATION_MS) {
      getSocket().emit('tareAll')
      setTimeout(() => setPhase('TESTING'), 500)
    }
  }, [tareStartMs, elapsed, setPhase])

  return (
    <Section label="Tare">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {isOffPlate
            ? `Hold still — taring in ${remainingSec.toFixed(0)}s...`
            : 'Step off the plate to begin tare countdown.'}
        </p>

        {/* Progress bar */}
        <div className="w-full h-2 bg-background rounded-full overflow-hidden">
          <div
            className="h-full bg-warning rounded-full transition-all duration-200"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        <div className="panel-inset p-3 grid grid-cols-2 gap-3">
          <div className="text-center">
            <div className="telemetry-label">Force</div>
            <div className={`telemetry-value ${isOffPlate ? 'text-success' : 'text-danger'}`}>
              {currentFz.toFixed(1)}N
            </div>
          </div>
          <div className="text-center">
            <div className="telemetry-label">Countdown</div>
            <div className="telemetry-value text-xl">{remainingSec.toFixed(0)}s</div>
          </div>
        </div>

        <button
          onClick={() => {
            getSocket().emit('tareAll')
            setTimeout(() => setPhase('TESTING'), 500)
          }}
          className="w-full px-4 py-2 text-sm bg-transparent border border-border text-muted-foreground rounded-md hover:bg-white/5 hover:text-foreground transition-colors"
        >
          Skip & Tare Now
        </button>
      </div>
    </Section>
  )
}

// ── TESTING: Active stage + measurement status ──────────────────
function TestingPanel({ stage, stageIndex, totalStages, measurementStatus }: {
  stage: { index: number; name: string; type: string; location: string; targetN: number; toleranceN: number }
  stageIndex: number
  totalStages: number
  measurementStatus: { state: string; cell: { row: number; col: number } | null; progressMs: number; reason?: string }
}) {
  const setActiveStage = useLiveTestStore((s) => s.setActiveStage)
  const endSession = useLiveTestStore((s) => s.endSession)
  const getStageProgress = useLiveTestStore((s) => s.getStageProgress)

  const progress = getStageProgress(stageIndex)
  const progressPct = progress.total > 0 ? (progress.done / progress.total) * 100 : 0

  return (
    <>
      {/* Stage selector */}
      <Section label={`Stage ${stageIndex + 1} / ${totalStages}`}>
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setActiveStage(Math.max(0, stageIndex - 1))}
            disabled={stageIndex === 0}
            className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="text-center">
            <div className="font-mono text-sm font-medium text-foreground">{stage.name}</div>
            <div className="text-xs text-muted-foreground">Location {stage.location}</div>
          </div>
          <button
            onClick={() => setActiveStage(Math.min(totalStages - 1, stageIndex + 1))}
            disabled={stageIndex === totalStages - 1}
            className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {/* Stage info */}
        <div className="panel-inset p-3 grid grid-cols-2 gap-3 mb-3">
          <div>
            <div className="telemetry-label">Target</div>
            <div className="telemetry-value">{stage.targetN.toFixed(0)}N</div>
          </div>
          <div>
            <div className="telemetry-label">Tolerance</div>
            <div className="telemetry-value">&plusmn;{stage.toleranceN.toFixed(1)}N</div>
          </div>
        </div>

        {/* Cell progress */}
        <div className="mb-2">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Cells</span>
            <span className="font-mono">{progress.done} / {progress.total}</span>
          </div>
          <div className="w-full h-1.5 bg-background rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </Section>

      {/* Measurement status */}
      <Section label="Measurement">
        <div className="panel-inset p-3">
          <div className="flex items-center gap-2 mb-1">
            <div className={`w-2 h-2 rounded-full ${
              measurementStatus.state === 'CAPTURED' ? 'bg-success' :
              measurementStatus.state === 'MEASURING' ? 'bg-warning status-live' :
              measurementStatus.state === 'ARMING' ? 'bg-primary status-live' :
              'bg-muted-foreground'
            }`} />
            <span className="font-mono text-xs tracking-wider text-foreground uppercase">
              {measurementStatus.state === 'IDLE' ? 'Waiting for load...' :
               measurementStatus.state === 'ARMING' ? 'Arming...' :
               measurementStatus.state === 'MEASURING' ? 'Measuring...' :
               'Captured!'}
            </span>
          </div>
          {measurementStatus.cell && (
            <div className="text-xs text-muted-foreground font-mono mt-1">
              Cell [{measurementStatus.cell.row},{measurementStatus.cell.col}]
            </div>
          )}
          {measurementStatus.reason && (
            <div className="text-xs text-muted-foreground mt-1">{measurementStatus.reason}</div>
          )}
          {/* Progress bar for arming/measuring */}
          {(measurementStatus.state === 'ARMING' || measurementStatus.state === 'MEASURING') && (
            <div className="w-full h-1 bg-background rounded-full overflow-hidden mt-2">
              <div
                className={`h-full rounded-full transition-all duration-100 ${
                  measurementStatus.state === 'ARMING' ? 'bg-primary' : 'bg-warning'
                }`}
                style={{ width: `${(measurementStatus.progressMs / 1000) * 100}%` }}
              />
            </div>
          )}
        </div>
      </Section>

      {/* End session */}
      <Section label="">
        <button
          onClick={endSession}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm bg-transparent border border-border text-muted-foreground rounded-md hover:bg-white/5 hover:text-foreground transition-colors"
        >
          <Square size={14} />
          End Session
        </button>
      </Section>
    </>
  )
}

// ── SUMMARY ─────────────────────────────────────────────────────
function SummaryPanel() {
  const stages = useLiveTestStore((s) => s.stages)
  const measurements = useLiveTestStore((s) => s.measurements)
  const metadata = useLiveTestStore((s) => s.metadata)
  const setPhase = useLiveTestStore((s) => s.setPhase)
  const gridRows = useLiveTestStore((s) => s.gridRows)
  const gridCols = useLiveTestStore((s) => s.gridCols)

  const totalCells = gridRows * gridCols
  const stageResults = stages.map((stage) => {
    const cells = Array.from(measurements.values()).filter((m) => m.stageIndex === stage.index)
    const passed = cells.filter((m) => m.pass).length
    return { ...stage, tested: cells.length, passed, total: totalCells }
  })

  const overallTested = stageResults.reduce((s, r) => s + r.tested, 0)
  const overallPassed = stageResults.reduce((s, r) => s + r.passed, 0)
  const overallTotal = stageResults.reduce((s, r) => s + r.total, 0)

  return (
    <>
      <Section label="Results">
        <div className="panel-inset p-3 mb-3">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="telemetry-label">Tested</div>
              <div className="telemetry-value">{overallTested}</div>
            </div>
            <div>
              <div className="telemetry-label">Passed</div>
              <div className="telemetry-value text-success">{overallPassed}</div>
            </div>
            <div>
              <div className="telemetry-label">Total</div>
              <div className="telemetry-value">{overallTotal}</div>
            </div>
          </div>
        </div>

        {/* Per-stage breakdown */}
        <div className="flex flex-col gap-1.5">
          {stageResults.map((r) => (
            <div key={r.index} className="flex items-center justify-between text-xs font-mono px-2 py-1.5 rounded bg-background">
              <span className="text-muted-foreground">{r.name} ({r.location})</span>
              <span className={r.passed === r.tested && r.tested > 0 ? 'text-success' : 'text-foreground'}>
                {r.passed}/{r.tested}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section label="">
        <div className="flex flex-col gap-2">
          <button
            onClick={() => setPhase('IDLE')}
            className="w-full flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium bg-primary text-white rounded-md btn-glow transition-all"
          >
            New Session
          </button>
        </div>
      </Section>
    </>
  )
}

// ── Shared Section component ────────────────────────────────────
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-4 border-b border-border">
      {label && <div className="telemetry-label mb-3">{label}</div>}
      {children}
    </div>
  )
}
