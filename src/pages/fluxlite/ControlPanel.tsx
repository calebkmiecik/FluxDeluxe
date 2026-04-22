import { useState, useEffect, useRef } from 'react'
import { useDeviceStore } from '../../stores/deviceStore'
import { useLiveTestStore } from '../../stores/liveTestStore'
import { useLiveDataStore } from '../../stores/liveDataStore'
import { useUiStore } from '../../stores/uiStore'
import { getSocket } from '../../lib/socket'
import {
  WARMUP_DURATION_MS,
  TARE_DURATION_MS, TARE_THRESHOLD_N,
  PERIODIC_TARE_INTERVAL_MS,
  type SessionMetadata,
  type StageDefinition,
  type CellMeasurement,
} from '../../lib/liveTestTypes'
import type { SocketResponse } from '../../lib/types'

const PERIODIC_STEPOFF_MS = 10_000
import { ChevronDown } from 'lucide-react'
import {
  rowForPhase,
  rowStatus,
  formatMetaSummary,
  stageStats,
  stageErrorStats,
  stagesStartedCount,
  type StepperRowId,
  type StepperRowStatus,
} from './controlPanelHelpers'
import { THRESHOLDS_DB_N, THRESHOLDS_BW_PCT } from '../../lib/types'

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
  const modelsByDevice = useDeviceStore((s) => s.modelsByDevice)
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId)
  const selectedDevice = devices.find((d) => d.axfId === selectedDeviceId)

  const setActiveLitePage = useUiStore((s) => s.setActiveLitePage)

  // Fetch model metadata for the selected plate — matches ModelsPage pattern
  useEffect(() => {
    if (selectedDeviceId) {
      getSocket().emit('getModelMetadata', { deviceId: selectedDeviceId })
    }
  }, [selectedDeviceId])

  const plateModels = selectedDeviceId ? (modelsByDevice[selectedDeviceId] ?? []) : []
  const attachedModel = plateModels.find((m) => m.modelActive) ?? plateModels[0] ?? null
  const attachedModelLabel = attachedModel?.modelId ?? null

  // Local metadata form state — only used when Meta Data row is editable (phase === IDLE)
  const [testerName, setTesterName] = useState('')
  const [bodyWeightNInput, setBodyWeightNInput] = useState('')
  const DUMBBELL_TARGET = 206.3
  const defaultDbN = 6.0
  const defaultBwPct = 1.5

  const [dbNInput, setDbNInput] = useState(String(defaultDbN))
  const [dbPctInput, setDbPctInput] = useState(((defaultDbN / DUMBBELL_TARGET) * 100).toFixed(1))
  const [bwNInput, setBwNInput] = useState('')
  const [bwPctInput, setBwPctInput] = useState(String(defaultBwPct))

  // Initialize threshold inputs from device-type defaults when plate is selected
  useEffect(() => {
    if (!selectedDevice) return
    const dt = selectedDevice.deviceTypeId
    const dbN = THRESHOLDS_DB_N[dt] ?? 6.0
    const bwPct = (THRESHOLDS_BW_PCT[dt] ?? 0.015) * 100
    setDbNInput(String(dbN))
    setDbPctInput(((dbN / DUMBBELL_TARGET) * 100).toFixed(1))
    setBwPctInput(String(bwPct))
    setBwNInput('') // can't compute until weight is entered
  }, [selectedDevice?.deviceTypeId])

  useEffect(() => {
    if (metadata) {
      setTesterName(metadata.testerName)
      setBodyWeightNInput(String(Math.round(metadata.bodyWeightN)))
      if (metadata.dbToleranceN != null) {
        setDbNInput(String(metadata.dbToleranceN))
        setDbPctInput(((metadata.dbToleranceN / DUMBBELL_TARGET) * 100).toFixed(1))
      }
      if (metadata.bwTolerancePct != null) {
        setBwPctInput(String(metadata.bwTolerancePct * 100))
        if (metadata.bodyWeightN > 0)
          setBwNInput((metadata.bodyWeightN * metadata.bwTolerancePct).toFixed(1))
      }
    }
  }, [metadata])

  const bodyWeightN = parseFloat(bodyWeightNInput || '0')

  // When bodyweight changes, update BW threshold N from the current % (% is the natural primary)
  useEffect(() => {
    const pct = parseFloat(bwPctInput)
    if (!isNaN(pct) && bodyWeightN > 0) setBwNInput((bodyWeightN * pct / 100).toFixed(1))
    else if (bodyWeightN <= 0) setBwNInput('')
  }, [bodyWeightN])

  // Linked threshold handlers — editing one derives the other
  const handleDbNChange = (val: string) => {
    setDbNInput(val)
    const n = parseFloat(val)
    if (!isNaN(n)) setDbPctInput(((n / DUMBBELL_TARGET) * 100).toFixed(1))
  }
  const handleDbPctChange = (val: string) => {
    setDbPctInput(val)
    const pct = parseFloat(val)
    if (!isNaN(pct)) setDbNInput(((pct / 100) * DUMBBELL_TARGET).toFixed(1))
  }
  const handleBwPctChange = (val: string) => {
    setBwPctInput(val)
    const pct = parseFloat(val)
    if (!isNaN(pct) && bodyWeightN > 0) setBwNInput((bodyWeightN * pct / 100).toFixed(1))
  }
  const handleBwNChange = (val: string) => {
    setBwNInput(val)
    const n = parseFloat(val)
    if (!isNaN(n) && bodyWeightN > 0) setBwPctInput(((n / bodyWeightN) * 100).toFixed(1))
  }

  const dbThresholdN = parseFloat(dbNInput || '0')
  const bwThresholdPct = parseFloat(bwPctInput || '0') / 100
  const metadataValid =
    !!selectedDevice && testerName.trim().length > 0 && bodyWeightN > 0

  // ── Periodic tare during TESTING ──────────────────────────────
  // 90s countdown → 10s step-off → auto-tareAll → restart.
  // Resets on any successful tare (manual or auto) via socket listener.
  const [periodicTareMs, setPeriodicTareMs] = useState(0)     // ms since last tare reset
  const [stepOffActive, setStepOffActive] = useState(false)    // 90s expired, awaiting step-off
  const [stepOffMs, setStepOffMs] = useState(0)                // ms of continuous off-plate
  const periodicTareRef = useRef<number>(0)                    // epoch ms of last reset
  const autoTareStepOffRef = useRef(false)                     // latch so auto-tare fires once

  // Start / stop the 100ms tick that drives the periodic tare timer
  useEffect(() => {
    if (phase !== 'TESTING' && phase !== 'STAGE_SWITCH') {
      setPeriodicTareMs(0)
      setStepOffActive(false)
      setStepOffMs(0)
      return
    }
    periodicTareRef.current = Date.now()
    const id = setInterval(() => {
      const elapsed = Date.now() - periodicTareRef.current
      setPeriodicTareMs(elapsed)

      if (elapsed >= PERIODIC_TARE_INTERVAL_MS && !stepOffActive) {
        setStepOffActive(true)
        setStepOffMs(0)
        autoTareStepOffRef.current = false
      }
    }, 200)
    return () => clearInterval(id)
  }, [phase])

  // During step-off: monitor Fz at 100ms. Once off plate for 10s, auto-tare.
  useEffect(() => {
    if (!stepOffActive) return
    let offSince: number | null = null
    const id = setInterval(() => {
      const frame = useLiveDataStore.getState().currentFrame
      const fz = frame ? Math.abs(frame.fz) : 999
      if (fz < TARE_THRESHOLD_N) {
        if (!offSince) offSince = Date.now()
        const offMs = Date.now() - offSince
        setStepOffMs(offMs)
        if (!autoTareStepOffRef.current && offMs >= PERIODIC_STEPOFF_MS) {
          autoTareStepOffRef.current = true
          getSocket().emit('tareAll')
          // reset happens via the tareAllStatus listener below
        }
      } else {
        offSince = null
        setStepOffMs(0)
      }
    }, 100)
    return () => clearInterval(id)
  }, [stepOffActive])

  // Reset periodic tare on ANY successful tare (manual or automatic)
  useEffect(() => {
    if (phase !== 'TESTING' && phase !== 'STAGE_SWITCH') return
    const socket = getSocket()
    const onTareStatus = (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success') {
        periodicTareRef.current = Date.now()
        setPeriodicTareMs(0)
        setStepOffActive(false)
        setStepOffMs(0)
        autoTareStepOffRef.current = false
      }
    }
    socket.on('tareAllStatus', onTareStatus)
    socket.on('tareStatus', onTareStatus)
    return () => { socket.off('tareAllStatus', onTareStatus); socket.off('tareStatus', onTareStatus) }
  }, [phase])

  // Derived display values
  const periodicTareCountdownSec = Math.max(0, Math.ceil((PERIODIC_TARE_INTERVAL_MS - periodicTareMs) / 1000))
  const stepOffCountdownSec = Math.max(0, Math.ceil((PERIODIC_STEPOFF_MS - stepOffMs) / 1000))
  const showPeriodicTare = phase === 'TESTING' || phase === 'STAGE_SWITCH'

  // Multi-expand state: a set of row IDs that are currently open.
  // Phase changes ADD the new active row (never remove) — users can collapse anything manually.
  const [expandedRows, setExpandedRows] = useState<Set<StepperRowId>>(
    () => new Set([rowForPhase(phase)])
  )
  useEffect(() => {
    setExpandedRows((prev) => {
      const row = rowForPhase(phase)
      if (prev.has(row)) return prev
      const next = new Set(prev)
      next.add(row)
      return next
    })
  }, [phase])

  // Auto-collapse warmup/tare 0.5s after their phase completes (lets the user see the filled bar)
  useEffect(() => {
    if (phase === 'TARE') {
      const id = setTimeout(() => setExpandedRows((prev) => { const n = new Set(prev); n.delete('warmup'); return n }), 500)
      return () => clearTimeout(id)
    }
  }, [phase])
  useEffect(() => {
    if (phase === 'TESTING') {
      const id = setTimeout(() => setExpandedRows((prev) => { const n = new Set(prev); n.delete('tare'); return n }), 500)
      return () => clearTimeout(id)
    }
  }, [phase])
  const toggleRow = (row: StepperRowId) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(row)) next.delete(row)
      else next.add(row)
      return next
    })
  }

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
      dbToleranceN: dbThresholdN > 0 ? dbThresholdN : undefined,
      bwTolerancePct: bwThresholdPct > 0 ? bwThresholdPct : undefined,
    }
    startSession(meta)
  }

  const handleActionBar = () => {
    if (phase === 'IDLE') handleStart()
    else if (phase === 'SUMMARY') setPhase('IDLE')
    else endSession()
  }

  // Collapsed-row summary strings
  const metaSummary = metadata
    ? formatMetaSummary(metadata)
    : (selectedDevice && testerName.trim() && bodyWeightN > 0
        ? `${testerName.trim()} · ${Math.round(bodyWeightN)}N · ${selectedDevice.axfId}`
        : 'Fill out metadata to begin')

  return (
    <div className="flex flex-col h-full">
      {/* Phase badge + periodic tare countdown */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-3">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${phaseInfo.color} ${phaseInfo.className ?? ''}`} />
        <span className="text-xs tracking-widest text-foreground uppercase">{phaseInfo.label}</span>
        {showPeriodicTare && (
          <span className={`ml-auto text-xs font-mono ${stepOffActive ? 'text-warning' : 'text-muted-foreground'}`}>
            {stepOffActive
              ? `Step off · ${stepOffCountdownSec}s`
              : `Tare: ${periodicTareCountdownSec}s`}
          </span>
        )}
      </div>

      {/* Stepper rows */}
      <div className="flex-1 overflow-y-auto">
        <StepperRow
          id="meta"
          label="Meta Data"
          status={rowStatus('meta', phase)}
          summary={metaSummary}
          expanded={expandedRows.has('meta')}
          onToggle={() => toggleRow('meta')}
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
            dbNInput={dbNInput} dbPctInput={dbPctInput}
            onDbNChange={handleDbNChange} onDbPctChange={handleDbPctChange}
            bwNInput={bwNInput} bwPctInput={bwPctInput}
            onBwNChange={handleBwNChange} onBwPctChange={handleBwPctChange}
            onOpenModels={() => setActiveLitePage('models')}
          />
        </StepperRow>

        <StepperRow
          id="warmup"
          label="Warmup"
          status={rowStatus('warmup', phase)}
          summary={warmupSummary(phase, warmupTriggered, warmupStartMs)}
          expanded={expandedRows.has('warmup')}
          onToggle={() => toggleRow('warmup')}
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
          expanded={expandedRows.has('tare')}
          onToggle={() => toggleRow('tare')}
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
          expanded={expandedRows.has('test')}
          onToggle={() => toggleRow('test')}
        >
          <TestBody
            phase={phase}
            stages={stages}
            activeStageIndex={activeStageIndex}
            activeStage={activeStage}
          />
        </StepperRow>

        <StepperRow
          id="summary"
          label="Summary"
          status={rowStatus('summary', phase)}
          summary={phase === 'SUMMARY' ? 'Ready to review' : '—'}
          expanded={expandedRows.has('summary')}
          onToggle={() => toggleRow('summary')}
        >
          <SummaryBody />
        </StepperRow>
      </div>

      {/* Persistent action bar */}
      <div className="border-t border-border px-4 py-3">
        <button
          onClick={handleActionBar}
          disabled={phase === 'IDLE' && (!metadataValid || connectionState !== 'READY')}
          className="w-full py-2.5 px-4 text-sm text-foreground bg-white/[0.04] border border-border rounded-md hover:bg-white/[0.08] hover:border-foreground/40 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-white/[0.04] disabled:hover:border-border"
        >
          {phase === 'IDLE' && 'Start Session'}
          {phase === 'SUMMARY' && 'New Session'}
          {phase !== 'IDLE' && phase !== 'SUMMARY' && 'End Session'}
        </button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────
// StepperRow — the generic accordion wrapper
// ────────────────────────────────────────────────────────────────
function StepperRow({
  id, label, status, summary, expanded, onToggle, children,
}: {
  id: StepperRowId
  label: string
  status: StepperRowStatus
  summary: string
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)

  // Measure content height whenever expanded state or children change
  useEffect(() => {
    if (!contentRef.current) return
    if (expanded) {
      // Use ResizeObserver to track dynamic content height changes
      const ro = new ResizeObserver(() => {
        if (contentRef.current) setHeight(contentRef.current.scrollHeight)
      })
      ro.observe(contentRef.current)
      setHeight(contentRef.current.scrollHeight)
      return () => ro.disconnect()
    } else {
      setHeight(0)
    }
  }, [expanded])

  const dotClass =
    status === 'active' ? 'bg-primary status-live' :
    status === 'complete' ? 'bg-success' :
    'bg-transparent border border-border'

  return (
    <div className="border-b border-border" data-testid={`stepper-row-${id}`}>
      <button
        onClick={onToggle}
        aria-expanded={expanded}
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
      <div
        className="overflow-hidden transition-[max-height] duration-300 ease-in-out"
        style={{ maxHeight: height }}
      >
        <div ref={contentRef} className="px-4 pb-4">
          {children}
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────
// Row bodies
// ────────────────────────────────────────────────────────────────

function MetaDataBody({
  phase, selectedDevice, attachedModelLabel, metadata,
  testerName, setTesterName, bodyWeightNInput, setBodyWeightNInput,
  dbNInput, dbPctInput, onDbNChange, onDbPctChange,
  bwNInput, bwPctInput, onBwNChange, onBwPctChange,
  onOpenModels,
}: {
  phase: string
  selectedDevice: { axfId: string; name: string; deviceTypeId: string } | undefined
  attachedModelLabel: string | null
  metadata: SessionMetadata | null
  testerName: string
  setTesterName: (v: string) => void
  bodyWeightNInput: string
  setBodyWeightNInput: (v: string) => void
  dbNInput: string; dbPctInput: string
  onDbNChange: (v: string) => void; onDbPctChange: (v: string) => void
  bwNInput: string; bwPctInput: string
  onBwNChange: (v: string) => void; onBwPctChange: (v: string) => void
  onOpenModels: () => void
}) {
  const inputClass = "w-full bg-transparent border-b border-border/60 rounded-none px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:border-[#7AB8FF] focus:outline-none transition-colors"
  const numFilter = (v: string) => v.replace(/[^0-9.]/g, '')

  // Read-only view once a session has started
  if (phase !== 'IDLE' && metadata) {
    const dbN = metadata.dbToleranceN
    const bwPct = metadata.bwTolerancePct
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
        <span className="telemetry-label">DB Threshold</span>
        <span className="text-sm text-foreground font-mono px-2 py-1">
          {dbN != null ? `${dbN.toFixed(1)}N` : '—'}
          <span className="text-muted-foreground ml-2">{dbN != null ? `${((dbN / 206.3) * 100).toFixed(1)}%` : ''}</span>
        </span>
        <span className="telemetry-label">BW Threshold</span>
        <span className="text-sm text-foreground font-mono px-2 py-1">
          {bwPct != null && metadata.bodyWeightN > 0 ? `${(metadata.bodyWeightN * bwPct).toFixed(1)}N` : '—'}
          <span className="text-muted-foreground ml-2">{bwPct != null ? `${(bwPct * 100).toFixed(1)}%` : ''}</span>
        </span>
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
      <input type="text" value={testerName} onChange={(e) => setTesterName(e.target.value)} placeholder="Enter name..." className={inputClass} />

      <label className="telemetry-label">Weight (N)</label>
      <input type="text" inputMode="decimal" value={bodyWeightNInput} onChange={(e) => setBodyWeightNInput(numFilter(e.target.value))} placeholder="e.g. 800" className={inputClass} />

      <label className="telemetry-label">DB Threshold</label>
      <div className="flex items-center gap-1.5">
        <input type="text" inputMode="decimal" value={dbNInput} onChange={(e) => onDbNChange(numFilter(e.target.value))} placeholder="N" className={inputClass + ' flex-1'} />
        <span className="text-[10px] text-muted-foreground shrink-0">N</span>
        <input type="text" inputMode="decimal" value={dbPctInput} onChange={(e) => onDbPctChange(numFilter(e.target.value))} placeholder="%" className={inputClass + ' flex-1'} />
        <span className="text-[10px] text-muted-foreground shrink-0">%</span>
      </div>

      <label className="telemetry-label">BW Threshold</label>
      <div className="flex items-center gap-1.5">
        <input type="text" inputMode="decimal" value={bwNInput} onChange={(e) => onBwNChange(numFilter(e.target.value))} placeholder="N" className={inputClass + ' flex-1'} />
        <span className="text-[10px] text-muted-foreground shrink-0">N</span>
        <input type="text" inputMode="decimal" value={bwPctInput} onChange={(e) => onBwPctChange(numFilter(e.target.value))} placeholder="%" className={inputClass + ' flex-1'} />
        <span className="text-[10px] text-muted-foreground shrink-0">%</span>
      </div>
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
  // Latch so auto-advance fires exactly once per warmup cycle — without it, the
  // 100ms interval keeps the condition true after threshold, re-firing the effect.
  const autoAdvancedRef = useRef(false)

  useEffect(() => {
    if (!warmupStartMs) return
    autoAdvancedRef.current = false
    const id = setInterval(() => setElapsed(Date.now() - warmupStartMs), 100)
    return () => clearInterval(id)
  }, [warmupStartMs])

  const remainingSec = Math.max(0, (WARMUP_DURATION_MS - elapsed) / 1000)
  const progress = warmupTriggered ? Math.min(elapsed / WARMUP_DURATION_MS, 1) : 0

  useEffect(() => {
    if (!autoAdvancedRef.current && warmupTriggered && elapsed >= WARMUP_DURATION_MS) {
      autoAdvancedRef.current = true
      setPhaseInStore('TARE')
    }
  }, [warmupTriggered, elapsed, setPhaseInStore])

  if (phase === 'IDLE') return <p className="text-xs text-muted-foreground">Warmup starts after you begin the session.</p>

  const done = phase !== 'WARMUP'
  const displayProgress = done ? 1 : progress

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {done ? '✓ Complete' : !warmupTriggered ? 'Jump on the plate to begin' : 'Keep jumping'}
        </span>
        {!done && <span className="font-mono text-foreground">{remainingSec.toFixed(0)}s</span>}
      </div>
      <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-200 ${done ? 'bg-success' : 'bg-warning'}`} style={{ width: `${displayProgress * 100}%` }} />
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
  // Latch so the auto-tare-and-advance fires exactly once per tare cycle.
  // Without this, the 100ms interval keeps the threshold condition true and
  // spams `tareAll` emits + queued setPhase calls until tareStartMs clears.
  const autoTaredRef = useRef(false)

  useEffect(() => {
    if (tareStartMs) autoTaredRef.current = false
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
    if (!autoTaredRef.current && tareStartMs && elapsed >= TARE_DURATION_MS) {
      autoTaredRef.current = true
      getSocket().emit('tareAll')
      setTimeout(() => setPhaseInStore('TESTING'), 500)
    }
  }, [tareStartMs, elapsed, setPhaseInStore])

  if (phase === 'IDLE' || phase === 'WARMUP') return <p className="text-xs text-muted-foreground">Tare runs after warmup.</p>

  const done = phase !== 'TARE'
  const displayProgress = done ? 1 : progress

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {done ? '✓ Complete' : 'Step off the plate'}
        </span>
        {!done && <span className="font-mono text-foreground">{remainingSec.toFixed(0)}s</span>}
      </div>
      <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-200 ${done ? 'bg-success' : 'bg-warning'}`} style={{ width: `${displayProgress * 100}%` }} />
      </div>
      {phase === 'TARE' && (
        <button onClick={onSkipAndTare} className="self-end text-xs text-muted-foreground hover:text-foreground px-2 py-1 transition-colors">
          Skip & tare now →
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
    <div className="grid grid-cols-[1.25rem_1fr_1fr_1fr] gap-1.5 items-stretch">
      <div />
      <div className="telemetry-label text-center">Dumbbell</div>
      <div className="telemetry-label text-center">Two Leg</div>
      <div className="telemetry-label text-center">One Leg</div>

      <div className="telemetry-label self-center text-center">A</div>
      {locA.map((s) => (
        <StageCell
          key={s.index}
          stage={s}
          active={s.index === activeStageIndex}
          stats={stageStats(measurements, s.index, totalCells)}
          errorStats={stageErrorStats(measurements, s.index, s.targetN)}
          onClick={() => onSelect(s.index)}
        />
      ))}

      <div className="telemetry-label self-center text-center">B</div>
      {locB.map((s) => (
        <StageCell
          key={s.index}
          stage={s}
          active={s.index === activeStageIndex}
          stats={stageStats(measurements, s.index, totalCells)}
          errorStats={stageErrorStats(measurements, s.index, s.targetN)}
          onClick={() => onSelect(s.index)}
        />
      ))}
    </div>
  )
}

/** Format signed percent for UI: sign included, one decimal, e.g. +1.2%, -0.4%, 0.0%. */
function formatSignedPct(pct: number): string {
  if (Math.abs(pct) < 0.05) return '0.0%'
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

function StageCell({
  stage, active, stats, errorStats, onClick,
}: {
  stage: StageDefinition
  active: boolean
  stats: { tested: number; passed: number; total: number }
  errorStats: { tested: number; signedPct: number; maePct: number; stdPct: number }
  onClick: () => void
}) {
  const complete = stats.tested === stats.total && stats.total > 0
  const indicator = complete ? 'bg-success' : active ? 'bg-primary status-live' : null
  const label = stage.type === 'dumbbell' ? 'DB' : stage.type === 'two_leg' ? '2L' : '1L'
  return (
    <button
      onClick={onClick}
      className={`relative border px-3 py-2.5 text-left transition-all flex flex-col gap-1 ${
        active
          ? 'border-foreground/60'
          : complete
          ? 'border-success/40 hover:border-success/70'
          : 'border-border hover:border-foreground/40'
      }`}
    >
      {indicator && (
        <div className={`absolute top-2 right-2 w-1.5 h-1.5 rounded-full ${indicator}`} />
      )}
      <div className="text-sm font-mono text-foreground tracking-wider">{label}·{stage.location}</div>
      <div className="text-xs text-muted-foreground font-mono">
        {stats.tested}/{stats.total} done{stats.tested > 0 ? ` · ${Math.round((stats.passed / stats.tested) * 100)}% pass` : ''}
      </div>
      <div className="text-sm font-mono text-foreground leading-tight">
        {errorStats.tested > 0 ? formatSignedPct(errorStats.signedPct) : '—'}
      </div>
    </button>
  )
}

function TestBody({
  phase, stages, activeStageIndex, activeStage,
}: {
  phase: string
  stages: StageDefinition[]
  activeStageIndex: number
  activeStage: StageDefinition | undefined
}) {
  const setActiveStage = useLiveTestStore((s) => s.setActiveStage)
  const measurements = useLiveTestStore((s) => s.measurements)
  const gridRows = useLiveTestStore((s) => s.gridRows)
  const gridCols = useLiveTestStore((s) => s.gridCols)
  const totalCells = gridRows * gridCols

  if (phase === 'IDLE' || phase === 'WARMUP' || phase === 'TARE' || !activeStage) {
    return <p className="text-xs text-muted-foreground">Testing starts after tare completes.</p>
  }

  return (
    <StageGrid
      stages={stages}
      activeStageIndex={activeStageIndex}
      measurements={measurements}
      totalCells={totalCells}
      onSelect={setActiveStage}
    />
  )
}

function SummaryBody() {
  const phase = useLiveTestStore((s) => s.phase)
  const stages = useLiveTestStore((s) => s.stages)
  const measurements = useLiveTestStore((s) => s.measurements)
  const gridRows = useLiveTestStore((s) => s.gridRows)
  const gridCols = useLiveTestStore((s) => s.gridCols)
  const [resultOverride, setResultOverride] = useState<'pass' | 'fail' | null>(null)

  if (phase !== 'SUMMARY') return <p className="text-xs text-muted-foreground">Summary appears after the session ends.</p>

  const totalCells = gridRows * gridCols
  const PASS_THRESHOLD = 88

  // Aggregate measurements across multiple stage indices
  function aggregateStats(stageIndices: number[]) {
    let tested = 0, passed = 0, total = 0
    const pcts: number[] = []
    let absSum = 0
    for (const idx of stageIndices) {
      const stage = stages[idx]
      if (!stage) continue
      total += totalCells
      measurements.forEach((m) => {
        if (m.stageIndex === idx) {
          tested++
          if (m.pass) passed++
          const pct = (m.signedErrorN / stage.targetN) * 100
          pcts.push(pct)
          absSum += Math.abs(pct)
        }
      })
    }
    const signedPct = pcts.length > 0 ? pcts.reduce((s, p) => s + p, 0) / pcts.length : 0
    const maePct = pcts.length > 0 ? absSum / pcts.length : 0
    const passRate = tested > 0 ? (passed / tested) * 100 : 0
    return { tested, passed, total, signedPct, maePct, passRate }
  }

  // Group by stage type (combine A + B locations)
  const typeGroups = [
    { label: 'Dumbbell', indices: stages.filter((s) => s.type === 'dumbbell').map((s) => s.index) },
    { label: 'Two Leg',  indices: stages.filter((s) => s.type === 'two_leg').map((s) => s.index) },
    { label: 'One Leg',  indices: stages.filter((s) => s.type === 'one_leg').map((s) => s.index) },
  ]
  const groupResults = typeGroups.map((g) => ({ ...g, ...aggregateStats(g.indices) }))
  const overall = aggregateStats(stages.map((s) => s.index))
  const autoResult: 'pass' | 'fail' = overall.passRate >= PASS_THRESHOLD ? 'pass' : 'fail'
  const result = resultOverride ?? autoResult

  const passRateClass = (rate: number) => rate >= PASS_THRESHOLD ? 'text-success' : 'text-danger'

  return (
    <div className="flex flex-col gap-4">
      {/* Per-type aggregated stats */}
      <div className="grid grid-cols-[4.5rem_1fr_1fr_1fr] gap-x-3 gap-y-1.5 text-xs font-mono items-baseline">
        <div className="telemetry-label">Type</div>
        <div className="telemetry-label text-right">Signed</div>
        <div className="telemetry-label text-right">MAE</div>
        <div className="telemetry-label text-right">Pass Rate</div>

        {groupResults.map((g) => (
          <div className="contents" key={g.label}>
            <div className="text-foreground">{g.label}</div>
            <div className="text-right text-foreground">
              {g.tested > 0 ? formatSignedPct(g.signedPct) : '—'}
            </div>
            <div className="text-right text-muted-foreground">
              {g.tested > 0 ? `${g.maePct.toFixed(1)}%` : '—'}
            </div>
            <div className={`text-right ${g.tested > 0 ? passRateClass(g.passRate) : 'text-muted-foreground'}`}>
              {g.tested > 0 ? `${Math.round(g.passRate)}%` : '—'}
            </div>
          </div>
        ))}
      </div>

      {/* Overall stats — large */}
      <div className="border-t border-border pt-4">
        <div className="telemetry-label mb-2">Overall</div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-lg font-mono text-foreground">{formatSignedPct(overall.signedPct)}</div>
            <div className="telemetry-label mt-0.5">Signed</div>
          </div>
          <div>
            <div className="text-lg font-mono text-muted-foreground">{overall.maePct.toFixed(1)}%</div>
            <div className="telemetry-label mt-0.5">MAE</div>
          </div>
          <div>
            <div className={`text-lg font-mono ${passRateClass(overall.passRate)}`}>{Math.round(overall.passRate)}%</div>
            <div className="telemetry-label mt-0.5">Pass Rate</div>
          </div>
        </div>
      </div>

      {/* Result recommendation — editable */}
      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between">
          <span className="telemetry-label">Result Recommendation</span>
          <button
            onClick={() => {
              if (resultOverride === null) setResultOverride(autoResult === 'pass' ? 'fail' : 'pass')
              else if (resultOverride === autoResult) setResultOverride(null)
              else setResultOverride(null)
            }}
            className={`text-lg font-mono font-semibold tracking-wider uppercase px-3 py-1 border rounded transition-colors ${
              result === 'pass'
                ? 'text-success border-success/40 hover:bg-success/10'
                : 'text-danger border-danger/40 hover:bg-danger/10'
            }`}
          >
            {result === 'pass' ? 'PASS' : 'FAIL'}
          </button>
        </div>
        {resultOverride !== null && (
          <div className="text-[10px] text-muted-foreground mt-1">
            Auto: {autoResult.toUpperCase()} — overridden by user
          </div>
        )}
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
