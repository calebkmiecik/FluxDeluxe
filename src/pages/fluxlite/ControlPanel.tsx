import { useState, useEffect } from 'react'
import { useDeviceStore } from '../../stores/deviceStore'
import { useLiveTestStore } from '../../stores/liveTestStore'
import { useLiveDataStore } from '../../stores/liveDataStore'
import { useUiStore } from '../../stores/uiStore'
import { getSocket } from '../../lib/socket'
import {
  WARMUP_DURATION_MS,
  TARE_DURATION_MS, TARE_THRESHOLD_N,
  type SessionMetadata,
  type StageDefinition,
  type MeasurementStatus,
  type CellMeasurement,
} from '../../lib/liveTestTypes'
import { Play, Square, ChevronRight, ChevronLeft, ChevronDown } from 'lucide-react'
import {
  rowForPhase,
  rowStatus,
  formatMetaSummary,
  stageStats,
  stagesStartedCount,
  type StepperRowId,
  type StepperRowStatus,
} from './controlPanelHelpers'

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
  const measurements = useLiveTestStore((s) => s.measurements)
  const gridRows = useLiveTestStore((s) => s.gridRows)
  const gridCols = useLiveTestStore((s) => s.gridCols)
  const startSession = useLiveTestStore((s) => s.startSession)
  const endSession = useLiveTestStore((s) => s.endSession)
  const setPhase = useLiveTestStore((s) => s.setPhase)

  const connectionState = useDeviceStore((s) => s.connectionState)
  const devices = useDeviceStore((s) => s.devices)
  const models = useDeviceStore((s) => s.models)
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId)
  const selectedDevice = devices.find((d) => d.axfId === selectedDeviceId)

  const setActiveLitePage = useUiStore((s) => s.setActiveLitePage)

  // Fetch model metadata for the selected plate — matches ModelsPage pattern
  useEffect(() => {
    if (selectedDeviceId) {
      getSocket().emit('getModelMetadata', { deviceId: selectedDeviceId })
    }
  }, [selectedDeviceId])

  const plateModels = (models as { deviceId?: string; modelId?: string; name?: string; active?: boolean }[])
    .filter((m) => m.deviceId === selectedDeviceId)
  const attachedModel = plateModels.find((m) => m.active) ?? plateModels[0] ?? null
  const attachedModelLabel = attachedModel?.name ?? attachedModel?.modelId ?? null

  // Local metadata form state — only used when Meta Data row is editable (phase === IDLE)
  const [testerName, setTesterName] = useState('')
  const [bodyWeightNInput, setBodyWeightNInput] = useState('')
  useEffect(() => {
    if (metadata) {
      setTesterName(metadata.testerName)
      setBodyWeightNInput(String(Math.round(metadata.bodyWeightN)))
    }
  }, [metadata])
  const bodyWeightN = parseFloat(bodyWeightNInput || '0')
  const metadataValid =
    !!selectedDevice && testerName.trim().length > 0 && bodyWeightN > 0

  // Accordion state: follows phase, overridable by user click
  const [expandedRow, setExpandedRow] = useState<StepperRowId>(() => rowForPhase(phase))
  useEffect(() => { setExpandedRow(rowForPhase(phase)) }, [phase])

  const phaseInfo = PHASE_DISPLAY[phase] ?? PHASE_DISPLAY.IDLE
  const activeStage = stages[activeStageIndex]

  const handleStart = () => {
    if (!metadataValid || !selectedDevice) return
    const meta: SessionMetadata = {
      testerName: testerName.trim(),
      bodyWeightN,
      deviceId: selectedDevice.axfId,
      deviceType: selectedDevice.deviceTypeId,
      modelId: attachedModel?.modelId ?? selectedDevice.deviceTypeId,
      startedAt: Date.now(),
    }
    startSession(meta)
  }

  const handleActionBar = () => {
    if (phase === 'IDLE') handleStart()
    else if (phase === 'SUMMARY') setPhase('IDLE')
    else endSession()
  }

  // Summary strings per row (temporary terse versions — refined in later tasks)
  const metaSummary = metadata
    ? formatMetaSummary(metadata)
    : (selectedDevice && testerName.trim() && bodyWeightN > 0
        ? `${testerName.trim()} · ${Math.round(bodyWeightN)}N · ${selectedDevice.axfId}`
        : 'Fill out metadata to begin')

  return (
    <div className="flex flex-col h-full">
      {/* Phase badge — unchanged */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-3">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${phaseInfo.color} ${phaseInfo.className ?? ''}`} />
        <span className="text-xs tracking-widest text-foreground uppercase">{phaseInfo.label}</span>
      </div>

      {/* Stepper rows */}
      <div className="flex-1 overflow-y-auto">
        <StepperRow
          id="meta"
          label="Meta Data"
          status={rowStatus('meta', phase)}
          summary={metaSummary}
          expanded={expandedRow === 'meta'}
          onToggle={() => setExpandedRow('meta')}
        >
          <MetaDataBody
            phase={phase}
            selectedDevice={selectedDevice}
            attachedModelLabel={attachedModelLabel}
            metadata={metadata}
            testerName={testerName}
            setTesterName={setTesterName}
            bodyWeightNInput={bodyWeightNInput}
            setBodyWeightNInput={setBodyWeightNInput}
            onOpenModels={() => setActiveLitePage('models')}
          />
        </StepperRow>

        <StepperRow
          id="warmup"
          label="Warmup"
          status={rowStatus('warmup', phase)}
          summary={warmupSummary(phase, warmupTriggered, warmupStartMs)}
          expanded={expandedRow === 'warmup'}
          onToggle={() => setExpandedRow('warmup')}
        >
          <WarmupBody
            phase={phase}
            warmupTriggered={warmupTriggered}
            warmupStartMs={warmupStartMs}
            onSkip={() => setPhase('TARE')}
          />
        </StepperRow>

        <StepperRow
          id="tare"
          label="Tare"
          status={rowStatus('tare', phase)}
          summary={tareSummary(phase, tareStartMs)}
          expanded={expandedRow === 'tare'}
          onToggle={() => setExpandedRow('tare')}
        >
          <TareBody
            phase={phase}
            tareStartMs={tareStartMs}
            onSkipAndTare={() => { getSocket().emit('tareAll'); setTimeout(() => setPhase('TESTING'), 500) }}
          />
        </StepperRow>

        <StepperRow
          id="test"
          label="Test"
          status={rowStatus('test', phase)}
          summary={testSummary(phase, measurements, stages.length, gridRows * gridCols * stages.length)}
          expanded={expandedRow === 'test'}
          onToggle={() => setExpandedRow('test')}
        >
          <TestBody
            phase={phase}
            stages={stages}
            activeStageIndex={activeStageIndex}
            activeStage={activeStage}
            measurementStatus={measurementStatus}
          />
        </StepperRow>

        <StepperRow
          id="summary"
          label="Summary"
          status={rowStatus('summary', phase)}
          summary={phase === 'SUMMARY' ? 'Ready to review' : '—'}
          expanded={expandedRow === 'summary'}
          onToggle={() => setExpandedRow('summary')}
        >
          <SummaryBody />
        </StepperRow>
      </div>

      {/* Persistent action bar */}
      <div className="border-t border-border px-4 py-3">
        <button
          onClick={handleActionBar}
          disabled={phase === 'IDLE' && (!metadataValid || connectionState !== 'READY')}
          className={`w-full flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium tracking-wide rounded-md transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
            phase === 'IDLE' || phase === 'SUMMARY'
              ? 'bg-primary text-white btn-glow'
              : 'bg-transparent border border-border text-muted-foreground hover:bg-white/5 hover:text-foreground'
          }`}
        >
          {phase === 'IDLE' && (<><Play size={16} fill="currentColor" /> Start Session</>)}
          {phase === 'SUMMARY' && 'New Session'}
          {phase !== 'IDLE' && phase !== 'SUMMARY' && (<><Square size={14} /> End Session</>)}
        </button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────
// StepperRow — the generic accordion wrapper
// ────────────────────────────────────────────────────────────────
function StepperRow({
  label, status, summary, expanded, onToggle, children,
}: {
  id: StepperRowId
  label: string
  status: StepperRowStatus
  summary: string
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  const dotClass =
    status === 'active' ? 'bg-primary status-live' :
    status === 'complete' ? 'bg-success' :
    'bg-transparent border border-border'

  return (
    <div className="border-b border-border">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dotClass}`} />
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="flex-1 text-right text-xs text-muted-foreground truncate">{summary}</span>
        <ChevronDown
          size={14}
          className={`flex-shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-0' : '-rotate-90'}`}
        />
      </button>
      {expanded && <div className="px-4 pb-4">{children}</div>}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────
// Row bodies
// ────────────────────────────────────────────────────────────────

function MetaDataBody({
  phase, selectedDevice, attachedModelLabel, metadata,
  testerName, setTesterName, bodyWeightNInput, setBodyWeightNInput, onOpenModels,
}: {
  phase: string
  selectedDevice: { axfId: string; name: string; deviceTypeId: string } | undefined
  attachedModelLabel: string | null
  metadata: SessionMetadata | null
  testerName: string
  setTesterName: (v: string) => void
  bodyWeightNInput: string
  setBodyWeightNInput: (v: string) => void
  onOpenModels: () => void
}) {
  // Read-only view once a session has started
  if (phase !== 'IDLE' && metadata) {
    return (
      <div className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1.5 items-center">
        <span className="telemetry-label">Plate</span>
        <span className="text-sm text-foreground truncate px-2 py-1">{metadata.deviceId}</span>
        <span className="telemetry-label">Model</span>
        <span className="text-sm text-foreground truncate px-2 py-1">{metadata.modelId}</span>
        <span className="telemetry-label">Name</span>
        <span className="text-sm text-foreground truncate px-2 py-1">{metadata.testerName}</span>
        <span className="telemetry-label">Weight (N)</span>
        <span className="text-sm text-foreground truncate px-2 py-1">{Math.round(metadata.bodyWeightN)}</span>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1.5 items-center">
      <span className="telemetry-label">Plate</span>
      <span className="text-sm text-foreground truncate px-2 py-1">
        {selectedDevice ? selectedDevice.axfId : <span className="text-muted-foreground">— no plate selected —</span>}
      </span>

      <span className="telemetry-label">Model</span>
      {attachedModelLabel ? (
        <span className="text-sm text-foreground truncate px-2 py-1">{attachedModelLabel}</span>
      ) : (
        <button onClick={onOpenModels} className="text-sm text-primary hover:underline text-left px-2 py-1">
          No Model attached →
        </button>
      )}

      <label className="telemetry-label">Name</label>
      <input
        type="text"
        value={testerName}
        onChange={(e) => setTesterName(e.target.value)}
        placeholder="Enter name..."
        className="w-full bg-background border border-border rounded-md px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none transition-colors"
      />

      <label className="telemetry-label">Weight (N)</label>
      <input
        type="text"
        inputMode="decimal"
        value={bodyWeightNInput}
        onChange={(e) => setBodyWeightNInput(e.target.value.replace(/[^0-9.]/g, ''))}
        placeholder="e.g. 800"
        className="w-full bg-background border border-border rounded-md px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none transition-colors"
      />
    </div>
  )
}

function WarmupBody({
  phase, warmupTriggered, warmupStartMs, onSkip,
}: {
  phase: string
  warmupTriggered: boolean
  warmupStartMs: number | null
  onSkip: () => void
}) {
  const setPhaseInStore = useLiveTestStore((s) => s.setPhase)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!warmupStartMs) return
    const id = setInterval(() => setElapsed(Date.now() - warmupStartMs), 100)
    return () => clearInterval(id)
  }, [warmupStartMs])

  const remainingSec = Math.max(0, (WARMUP_DURATION_MS - elapsed) / 1000)
  const progress = warmupTriggered ? Math.min(elapsed / WARMUP_DURATION_MS, 1) : 0

  useEffect(() => {
    if (warmupTriggered && elapsed >= WARMUP_DURATION_MS) setPhaseInStore('TARE')
  }, [warmupTriggered, elapsed, setPhaseInStore])

  if (phase === 'IDLE') return <p className="text-xs text-muted-foreground">Warmup starts after you begin the session.</p>

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {!warmupTriggered ? 'Jump on the plate to begin' : 'Keep jumping'}
        </span>
        <span className="font-mono text-foreground">{remainingSec.toFixed(0)}s</span>
      </div>
      <div className="w-full h-1.5 bg-background rounded-full overflow-hidden">
        <div className="h-full bg-warning rounded-full transition-all duration-200" style={{ width: `${progress * 100}%` }} />
      </div>
      {phase === 'WARMUP' && (
        <button onClick={onSkip} className="self-end text-xs text-muted-foreground hover:text-foreground px-2 py-1 transition-colors">
          Skip warmup →
        </button>
      )}
    </div>
  )
}

function TareBody({
  phase, tareStartMs, onSkipAndTare,
}: {
  phase: string
  tareStartMs: number | null
  onSkipAndTare: () => void
}) {
  const setPhaseInStore = useLiveTestStore((s) => s.setPhase)
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

  useEffect(() => {
    if (tareStartMs && elapsed >= TARE_DURATION_MS) {
      getSocket().emit('tareAll')
      setTimeout(() => setPhaseInStore('TESTING'), 500)
    }
  }, [tareStartMs, elapsed, setPhaseInStore])

  if (phase === 'IDLE' || phase === 'WARMUP') return <p className="text-xs text-muted-foreground">Tare runs after warmup.</p>

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {isOffPlate ? 'Hold still — taring' : 'Step off the plate'}
        </span>
        <span className="font-mono text-foreground">{remainingSec.toFixed(0)}s</span>
      </div>
      <div className="w-full h-1.5 bg-background rounded-full overflow-hidden">
        <div className="h-full bg-warning rounded-full transition-all duration-200" style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="text-xs font-mono text-muted-foreground">
        Fz: <span className={isOffPlate ? 'text-success' : 'text-danger'}>{currentFz.toFixed(1)}N</span>
      </div>
      {phase === 'TARE' && (
        <button onClick={onSkipAndTare} className="self-end text-xs text-muted-foreground hover:text-foreground px-2 py-1 transition-colors">
          Skip &amp; tare now →
        </button>
      )}
    </div>
  )
}

function StageGrid({
  stages, activeStageIndex, measurements, totalCells, onSelect,
}: {
  stages: StageDefinition[]
  activeStageIndex: number
  measurements: ReadonlyMap<string, CellMeasurement>
  totalCells: number
  onSelect: (index: number) => void
}) {
  // Group by location — rely on the order in STAGE_TEMPLATES (A then B)
  const locA = stages.filter((s) => s.location === 'A')
  const locB = stages.filter((s) => s.location === 'B')

  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-[2rem_1fr_1fr_1fr] gap-1 items-stretch text-[10px]">
        <div />
        <div className="telemetry-label text-center">Dumbbell</div>
        <div className="telemetry-label text-center">Two Leg</div>
        <div className="telemetry-label text-center">One Leg</div>

        <div className="telemetry-label self-center text-center">A</div>
        {locA.map((s) => (
          <StageCell key={s.index} stage={s} active={s.index === activeStageIndex} stats={stageStats(measurements, s.index, totalCells)} onClick={() => onSelect(s.index)} />
        ))}

        <div className="telemetry-label self-center text-center">B</div>
        {locB.map((s) => (
          <StageCell key={s.index} stage={s} active={s.index === activeStageIndex} stats={stageStats(measurements, s.index, totalCells)} onClick={() => onSelect(s.index)} />
        ))}
      </div>
    </div>
  )
}

function StageCell({
  stage, active, stats, onClick,
}: {
  stage: StageDefinition
  active: boolean
  stats: { tested: number; passed: number; total: number }
  onClick: () => void
}) {
  const complete = stats.tested === stats.total && stats.total > 0
  const dot = complete ? '✓' : active ? '●' : ''
  return (
    <button
      onClick={onClick}
      className={`relative rounded-md border px-2 py-1.5 text-left transition-all ${
        active ? 'border-primary bg-primary/10' : complete ? 'border-success/50 bg-success/5' : 'border-border bg-background/50 hover:bg-white/[0.03]'
      }`}
    >
      <div className="absolute top-1 right-1.5 text-[10px] text-muted-foreground">{dot}</div>
      <div className="text-[10px] font-mono text-foreground">
        {stage.type === 'dumbbell' ? 'DB' : stage.type === 'two_leg' ? '2L' : '1L'}·{stage.location}
      </div>
      <div className="text-[10px] text-muted-foreground font-mono">{stats.tested}/{stats.total} done</div>
      <div className="text-[10px] text-muted-foreground font-mono">
        {stats.tested > 0 ? `${stats.passed}/${stats.tested} pass` : '—'}
      </div>
    </button>
  )
}

function TestBody({
  phase, stages, activeStageIndex, activeStage, measurementStatus,
}: {
  phase: string
  stages: StageDefinition[]
  activeStageIndex: number
  activeStage: StageDefinition | undefined
  measurementStatus: MeasurementStatus
}) {
  const setActiveStage = useLiveTestStore((s) => s.setActiveStage)
  const measurements = useLiveTestStore((s) => s.measurements)
  const gridRows = useLiveTestStore((s) => s.gridRows)
  const gridCols = useLiveTestStore((s) => s.gridCols)
  const totalCells = gridRows * gridCols

  if (phase === 'IDLE' || phase === 'WARMUP' || phase === 'TARE' || !activeStage) {
    return <p className="text-xs text-muted-foreground">Testing starts after tare completes.</p>
  }

  const activeStats = stageStats(measurements, activeStageIndex, totalCells)

  return (
    <div className="flex flex-col gap-3">
      <StageGrid
        stages={stages}
        activeStageIndex={activeStageIndex}
        measurements={measurements}
        totalCells={totalCells}
        onSelect={setActiveStage}
      />

      <div className="flex items-center justify-between text-xs border-t border-border pt-3">
        <span className="text-muted-foreground">
          Active: <span className="text-foreground font-medium">{activeStage.location} · {activeStage.name}</span>
        </span>
        <span className="font-mono text-muted-foreground">
          {activeStage.targetN.toFixed(0)}N &plusmn;{activeStage.toleranceN.toFixed(1)}N · {activeStats.tested}/{activeStats.total}
        </span>
      </div>

      <div className="panel-inset p-3">
        <div className="flex items-center gap-2 mb-1">
          <div className={`w-2 h-2 rounded-full ${measurementStatus.state === 'CAPTURED' ? 'bg-success' : measurementStatus.state === 'MEASURING' ? 'bg-warning status-live' : measurementStatus.state === 'ARMING' ? 'bg-primary status-live' : 'bg-muted-foreground'}`} />
          <span className="text-xs tracking-wider text-foreground uppercase">
            {measurementStatus.state === 'IDLE' ? 'Waiting for load…' : measurementStatus.state === 'ARMING' ? 'Arming…' : measurementStatus.state === 'MEASURING' ? 'Measuring…' : 'Captured!'}
          </span>
        </div>
        {measurementStatus.cell && (
          <div className="text-xs text-muted-foreground mt-1">Cell [<span className="font-mono">{measurementStatus.cell.row},{measurementStatus.cell.col}</span>]</div>
        )}
        {measurementStatus.reason && (
          <div className="text-xs text-muted-foreground mt-1">{measurementStatus.reason}</div>
        )}
        {(measurementStatus.state === 'ARMING' || measurementStatus.state === 'MEASURING') && (
          <div className="w-full h-1 bg-background rounded-full overflow-hidden mt-2">
            <div className={`h-full rounded-full transition-all duration-100 ${measurementStatus.state === 'ARMING' ? 'bg-primary' : 'bg-warning'}`} style={{ width: `${(measurementStatus.progressMs / 1000) * 100}%` }} />
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryBody() {
  const phase = useLiveTestStore((s) => s.phase)
  const stages = useLiveTestStore((s) => s.stages)
  const measurements = useLiveTestStore((s) => s.measurements)
  const gridRows = useLiveTestStore((s) => s.gridRows)
  const gridCols = useLiveTestStore((s) => s.gridCols)

  if (phase !== 'SUMMARY') return <p className="text-xs text-muted-foreground">Summary appears after the session ends.</p>

  const totalCells = gridRows * gridCols
  const stageResults = stages.map((stage) => {
    const cells = Array.from(measurements.values()).filter((m: CellMeasurement) => m.stageIndex === stage.index)
    const passed = cells.filter((m: CellMeasurement) => m.pass).length
    return { ...stage, tested: cells.length, passed, total: totalCells }
  })
  const overallTested = stageResults.reduce((s, r) => s + r.tested, 0)
  const overallPassed = stageResults.reduce((s, r) => s + r.passed, 0)
  const overallTotal = stageResults.reduce((s, r) => s + r.total, 0)

  return (
    <div className="flex flex-col gap-3">
      <div className="panel-inset p-3">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div><div className="telemetry-label">Tested</div><div className="telemetry-value">{overallTested}</div></div>
          <div><div className="telemetry-label">Passed</div><div className="telemetry-value text-success">{overallPassed}</div></div>
          <div><div className="telemetry-label">Total</div><div className="telemetry-value">{overallTotal}</div></div>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {stageResults.map((r) => (
          <div key={r.index} className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-background">
            <span className="text-muted-foreground">{r.name} ({r.location})</span>
            <span className={`font-mono ${r.passed === r.tested && r.tested > 0 ? 'text-success' : 'text-foreground'}`}>{r.passed}/{r.tested}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function warmupSummary(phase: string, triggered: boolean, startMs: number | null): string {
  if (phase === 'IDLE') return 'Pending'
  if (phase === 'WARMUP') {
    if (!triggered || !startMs) return 'Waiting for load…'
    const remaining = Math.max(0, (WARMUP_DURATION_MS - (Date.now() - startMs)) / 1000)
    return `${remaining.toFixed(0)}s remaining`
  }
  return '✓ Complete'
}
function tareSummary(phase: string, startMs: number | null): string {
  if (phase === 'IDLE' || phase === 'WARMUP') return 'Pending'
  if (phase === 'TARE') {
    if (!startMs) return 'Step off to tare'
    const remaining = Math.max(0, (TARE_DURATION_MS - (Date.now() - startMs)) / 1000)
    return `${remaining.toFixed(0)}s countdown`
  }
  return '✓ Tared'
}
function testSummary(
  phase: string,
  measurements: ReadonlyMap<string, CellMeasurement>,
  totalStages: number,
  totalCellsAll: number,
): string {
  if (phase === 'IDLE' || phase === 'WARMUP' || phase === 'TARE') return 'Pending'
  if (phase === 'SUMMARY') return '✓ All stages complete'
  const started = stagesStartedCount(measurements)
  const totalTested = measurements.size
  return `${started}/${totalStages} stages · ${totalTested}/${totalCellsAll} cells`
}
