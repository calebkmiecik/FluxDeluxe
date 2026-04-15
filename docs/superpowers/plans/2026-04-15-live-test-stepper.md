# Live Test Stepper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the full-panel phase-takeover in `ControlPanel.tsx` with an always-visible 5-row accordion stepper, per [`docs/superpowers/specs/2026-04-15-live-test-stepper-design.md`](../specs/2026-04-15-live-test-stepper-design.md).

**Architecture:** Pure presentation refactor of one component (`src/pages/fluxlite/ControlPanel.tsx`). No store, socket, or measurement-engine changes. A small sibling helper module holds pure functions (phase→row mapping, stage stats) so they can be unit-tested. The component itself is rebuilt incrementally — each task leaves the app in a buildable, manually-testable state.

**Tech Stack:** React 19, TypeScript, Tailwind v4, Zustand, Vitest (pure-function tests only — this codebase has no React component test infrastructure and this plan does not introduce any).

## Context for the implementer

You (a future agent) may not know this codebase. Before starting, read:

- [`docs/superpowers/specs/2026-04-15-live-test-stepper-design.md`](../specs/2026-04-15-live-test-stepper-design.md) — the spec this plan implements. Every design decision is there; don't re-derive them.
- [`src/pages/fluxlite/ControlPanel.tsx`](../../src/pages/fluxlite/ControlPanel.tsx) — the one file you'll refactor. Read it end-to-end first.
- [`src/lib/liveTestTypes.ts`](../../src/lib/liveTestTypes.ts) — `LiveTestPhase`, `StageDefinition`, `SessionMetadata`, timing constants.
- [`src/stores/liveTestStore.ts`](../../src/stores/liveTestStore.ts) — confirm the store API: `phase`, `stages`, `activeStageIndex`, `measurements` (a `Map`), `gridRows`, `gridCols`, `metadata`, `measurementStatus`, `warmupTriggered`, `warmupStartMs`, `tareStartMs`, `setActiveStage`, `setPhase`, `startSession`, `endSession`, `getStageProgress`.
- [`src/__tests__/plateGeometry.test.ts`](../../src/__tests__/plateGeometry.test.ts) — the existing test style you must match.

**Do not** introduce `@testing-library/react` tests in this plan even though the dependency exists. The codebase has never used it; adding component tests here is scope creep. Helpers are unit-testable; JSX/presentation gets manually verified via the dev server.

**Testing command (all tasks):** `npm test` → runs `vitest run` → expected `Tests  <N> passed`.

**Dev server command (manual validation):** `npm run dev` — starts `electron-vite dev`. The window should open with the FluxLite UI.

---

### Task 1: Extract pure helpers (TDD)

**Files:**
- Create: `src/pages/fluxlite/controlPanelHelpers.ts`
- Create: `src/__tests__/controlPanelHelpers.test.ts`

These helpers exist so the refactored `ControlPanel.tsx` can stay focused on JSX. All logic in this file is pure and fully unit-tested.

- [ ] **Step 1.1: Write the failing tests**

Create `src/__tests__/controlPanelHelpers.test.ts` with this content:

```ts
import { describe, it, expect } from 'vitest'
import {
  rowForPhase,
  stageStats,
  rowStatus,
  stagesStartedCount,
  formatMetaSummary,
} from '../pages/fluxlite/controlPanelHelpers'
import type { CellMeasurement } from '../lib/liveTestTypes'

function m(row: number, col: number, stageIndex: number, pass: boolean): CellMeasurement {
  return {
    row, col, stageIndex, pass,
    meanFzN: 0, stdFzN: 0, errorN: 0, errorRatio: 0,
    colorBin: pass ? 'green' : 'red',
    timestamp: 0,
  }
}

describe('rowForPhase', () => {
  it('maps IDLE to meta', () => { expect(rowForPhase('IDLE')).toBe('meta') })
  it('maps WARMUP to warmup', () => { expect(rowForPhase('WARMUP')).toBe('warmup') })
  it('maps TARE to tare', () => { expect(rowForPhase('TARE')).toBe('tare') })
  it('maps TESTING to test', () => { expect(rowForPhase('TESTING')).toBe('test') })
  it('maps STAGE_SWITCH to test', () => { expect(rowForPhase('STAGE_SWITCH')).toBe('test') })
  it('maps SUMMARY to summary', () => { expect(rowForPhase('SUMMARY')).toBe('summary') })
})

describe('stageStats', () => {
  it('returns zeros for an empty measurements map', () => {
    const out = stageStats(new Map(), 0, 15)
    expect(out).toEqual({ tested: 0, passed: 0, total: 15 })
  })

  it('counts only measurements matching the stage index', () => {
    const measurements = new Map<string, CellMeasurement>([
      ['0,0', m(0, 0, 0, true)],
      ['0,1', m(0, 1, 0, false)],
      ['1,0', m(1, 0, 1, true)], // different stage, must be excluded
    ])
    const out = stageStats(measurements, 0, 15)
    expect(out).toEqual({ tested: 2, passed: 1, total: 15 })
  })

  it('passed never exceeds tested', () => {
    const measurements = new Map<string, CellMeasurement>([
      ['0,0', m(0, 0, 2, true)],
      ['0,1', m(0, 1, 2, true)],
    ])
    const out = stageStats(measurements, 2, 9)
    expect(out.passed).toBeLessThanOrEqual(out.tested)
  })
})

describe('stagesStartedCount', () => {
  it('is 0 when no measurements', () => {
    expect(stagesStartedCount(new Map())).toBe(0)
  })
  it('counts distinct stage indices', () => {
    const measurements = new Map<string, CellMeasurement>([
      ['a', m(0, 0, 0, true)],
      ['b', m(0, 1, 0, true)], // same stage, shouldn't double-count
      ['c', m(0, 0, 3, true)],
    ])
    expect(stagesStartedCount(measurements)).toBe(2)
  })
})

describe('rowStatus', () => {
  // Phase ordering: IDLE < WARMUP < TARE < TESTING/STAGE_SWITCH < SUMMARY
  it('meta is complete when session has started (any non-IDLE phase)', () => {
    expect(rowStatus('meta', 'IDLE')).toBe('pending')
    expect(rowStatus('meta', 'WARMUP')).toBe('complete')
    expect(rowStatus('meta', 'TESTING')).toBe('complete')
  })
  it('active row matches current phase', () => {
    expect(rowStatus('warmup', 'WARMUP')).toBe('active')
    expect(rowStatus('tare', 'TARE')).toBe('active')
    expect(rowStatus('test', 'TESTING')).toBe('active')
    expect(rowStatus('test', 'STAGE_SWITCH')).toBe('active')
    expect(rowStatus('summary', 'SUMMARY')).toBe('active')
  })
  it('past rows are complete', () => {
    expect(rowStatus('warmup', 'TARE')).toBe('complete')
    expect(rowStatus('warmup', 'TESTING')).toBe('complete')
    expect(rowStatus('tare', 'TESTING')).toBe('complete')
    expect(rowStatus('test', 'SUMMARY')).toBe('complete')
  })
  it('future rows are pending', () => {
    expect(rowStatus('warmup', 'IDLE')).toBe('pending')
    expect(rowStatus('tare', 'WARMUP')).toBe('pending')
    expect(rowStatus('test', 'TARE')).toBe('pending')
    expect(rowStatus('summary', 'TESTING')).toBe('pending')
  })
})

describe('formatMetaSummary', () => {
  it('returns placeholder when no metadata', () => {
    expect(formatMetaSummary(null)).toBe('Fill out metadata to begin')
  })
  it('formats name · weight · plateId', () => {
    const meta = {
      testerName: 'John D',
      bodyWeightN: 800,
      deviceId: '07.abc12345',
      deviceType: '07',
      modelId: '07',
      startedAt: 0,
    }
    expect(formatMetaSummary(meta)).toBe('John D · 800N · 07.abc12345')
  })
  it('rounds non-integer weight to whole newtons', () => {
    const meta = {
      testerName: 'A',
      bodyWeightN: 812.6,
      deviceId: 'x',
      deviceType: '07',
      modelId: '07',
      startedAt: 0,
    }
    expect(formatMetaSummary(meta)).toBe('A · 813N · x')
  })
})
```

- [ ] **Step 1.2: Run the tests — expect them to fail**

Run: `npm test`

Expected: all `controlPanelHelpers` tests fail with a module-not-found error.

- [ ] **Step 1.3: Create the helper module**

Create `src/pages/fluxlite/controlPanelHelpers.ts`:

```ts
import type { CellMeasurement, LiveTestPhase, SessionMetadata } from '../../lib/liveTestTypes'

export type StepperRowId = 'meta' | 'warmup' | 'tare' | 'test' | 'summary'
export type StepperRowStatus = 'pending' | 'active' | 'complete'

/** Mapping defined in the spec — phase → row that should be auto-expanded. */
export function rowForPhase(phase: LiveTestPhase): StepperRowId {
  switch (phase) {
    case 'IDLE': return 'meta'
    case 'WARMUP': return 'warmup'
    case 'TARE': return 'tare'
    case 'TESTING':
    case 'STAGE_SWITCH': return 'test'
    case 'SUMMARY': return 'summary'
  }
}

/** Rank phases so we can compare "past / current / future" for a given row. */
const PHASE_ORDER: Record<LiveTestPhase, number> = {
  IDLE: 0,
  WARMUP: 1,
  TARE: 2,
  TESTING: 3,
  STAGE_SWITCH: 3, // same as TESTING
  SUMMARY: 4,
}

const ROW_PHASE_ORDER: Record<StepperRowId, number> = {
  meta: 0,
  warmup: 1,
  tare: 2,
  test: 3,
  summary: 4,
}

export function rowStatus(row: StepperRowId, phase: LiveTestPhase): StepperRowStatus {
  const rowRank = ROW_PHASE_ORDER[row]
  const phaseRank = PHASE_ORDER[phase]
  if (rowRank === phaseRank) return 'active'
  if (rowRank < phaseRank) return 'complete'
  return 'pending'
}

export interface StageStats {
  tested: number
  passed: number
  total: number
}

export function stageStats(
  measurements: ReadonlyMap<string, CellMeasurement>,
  stageIndex: number,
  total: number,
): StageStats {
  let tested = 0
  let passed = 0
  measurements.forEach((m) => {
    if (m.stageIndex === stageIndex) {
      tested += 1
      if (m.pass) passed += 1
    }
  })
  return { tested, passed, total }
}

export function stagesStartedCount(measurements: ReadonlyMap<string, CellMeasurement>): number {
  const seen = new Set<number>()
  measurements.forEach((m) => seen.add(m.stageIndex))
  return seen.size
}

export function formatMetaSummary(meta: SessionMetadata | null): string {
  if (!meta) return 'Fill out metadata to begin'
  return `${meta.testerName} · ${Math.round(meta.bodyWeightN)}N · ${meta.deviceId}`
}
```

- [ ] **Step 1.4: Run the tests — expect them to pass**

Run: `npm test`

Expected: all tests pass, including the new `controlPanelHelpers` suite. Prior test count + the new ones (~15 new tests).

- [ ] **Step 1.5: Commit**

```bash
git add src/pages/fluxlite/controlPanelHelpers.ts src/__tests__/controlPanelHelpers.test.ts
git commit -m "feat(control-panel): extract pure helpers for stepper redesign"
```

---

### Task 2: Rewrite ControlPanel shell with accordion + action bar (bodies reuse existing logic)

The goal of this task is to put the **structural bones** in place — accordion state, 5 rows, persistent action bar — while keeping each row's expanded body essentially unchanged (just wrapped). Subsequent tasks redesign each body in place.

**Files:**
- Modify: `src/pages/fluxlite/ControlPanel.tsx` (full rewrite)

**Prerequisite reading:** You must have read the current `ControlPanel.tsx` end-to-end (all ~540 lines). The existing sub-components are `IdlePanel`, `WarmupPanel`, `TarePanel`, `TestingPanel`, `SummaryPanel`, `Section`.

- [ ] **Step 2.1: Understand what we keep vs what changes**

Keep verbatim:
- The `PHASE_DISPLAY` map and the phase badge at the top of the panel.
- All the internal logic of `WarmupPanel` (timer, auto-advance, skip button).
- All the internal logic of `TarePanel` (timer, force reading, auto-tare).
- All the internal logic of `TestingPanel` EXCEPT the chevron stage nav (we keep that temporarily in this task — it's replaced in Task 4).
- All the internal logic of `SummaryPanel`.
- `IdlePanel`'s metadata form (inputs, canStart logic, `handleStart` — minus the Start button, which moves to the action bar).

Change / add:
- Remove the phase-switched `{phase === 'IDLE' && ...}` blocks.
- Replace with five `<StepperRow>` components that are ALL rendered regardless of phase.
- Add accordion state: `const [expandedRow, setExpandedRow] = useState<StepperRowId>(() => rowForPhase(phase))`.
- Add `useEffect(() => setExpandedRow(rowForPhase(phase)), [phase])` so auto-advance expands the new active row.
- Remove the in-body Start button from `IdlePanel`, the "End Session" button from `TestingPanel`, and the "New Session" button from `SummaryPanel`.
- Add a persistent `<ActionBar>` at the bottom whose button label + behavior is driven by `phase`.

- [ ] **Step 2.2: Write the new file**

Completely replace the contents of `src/pages/fluxlite/ControlPanel.tsx` with the following. Type signatures of the body components mirror what they currently take; only the presentational wrapper is new.

```tsx
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
  const metaSummary = formatMetaSummary(metadata)

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
          summary={testSummary(phase, stages.length)}
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
// Row bodies — in this task, these mirror the old phase panels
// with two exceptions: no Start/End/New buttons (moved to ActionBar),
// and bodies are rendered regardless of phase (they show empty states
// when their phase hasn't been reached yet).
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

// WarmupBody — initially a thin wrapper around the existing WarmupPanel logic.
// This task keeps the existing panel-inset card; Task 3 replaces it with inline progress.
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
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {!warmupTriggered ? 'Jump on the plate to begin precompression…' : `Keep jumping — ${remainingSec.toFixed(0)}s remaining`}
      </p>
      <div className="w-full h-2 bg-background rounded-full overflow-hidden">
        <div className="h-full bg-warning rounded-full transition-all duration-200" style={{ width: `${progress * 100}%` }} />
      </div>
      {phase === 'WARMUP' && (
        <button onClick={onSkip} className="w-full px-4 py-2 text-sm bg-transparent border border-border text-muted-foreground rounded-md hover:bg-white/5 hover:text-foreground transition-colors">
          Skip Warmup
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
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {isOffPlate ? `Hold still — taring in ${remainingSec.toFixed(0)}s…` : 'Step off the plate to begin tare countdown.'}
      </p>
      <div className="w-full h-2 bg-background rounded-full overflow-hidden">
        <div className="h-full bg-warning rounded-full transition-all duration-200" style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="flex items-center justify-between text-xs font-mono">
        <span>Fz: <span className={isOffPlate ? 'text-success' : 'text-danger'}>{currentFz.toFixed(1)}N</span></span>
        <span>Countdown: {remainingSec.toFixed(0)}s</span>
      </div>
      {phase === 'TARE' && (
        <button onClick={onSkipAndTare} className="w-full px-4 py-2 text-sm bg-transparent border border-border text-muted-foreground rounded-md hover:bg-white/5 hover:text-foreground transition-colors">
          Skip & Tare Now
        </button>
      )}
    </div>
  )
}

// TestBody — this task keeps the chevron stage nav as-is. Task 4 replaces it with the 2×3 grid.
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
  const getStageProgress = useLiveTestStore((s) => s.getStageProgress)

  if (phase === 'IDLE' || phase === 'WARMUP' || phase === 'TARE' || !activeStage) {
    return <p className="text-xs text-muted-foreground">Testing starts after tare completes.</p>
  }

  const progress = getStageProgress(activeStageIndex)
  const progressPct = progress.total > 0 ? (progress.done / progress.total) * 100 : 0

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <button onClick={() => setActiveStage(Math.max(0, activeStageIndex - 1))} disabled={activeStageIndex === 0} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors">
          <ChevronLeft size={18} />
        </button>
        <div className="text-center">
          <div className="text-sm font-medium text-foreground">{activeStage.name}</div>
          <div className="text-xs text-muted-foreground">Location {activeStage.location}</div>
        </div>
        <button onClick={() => setActiveStage(Math.min(stages.length - 1, activeStageIndex + 1))} disabled={activeStageIndex === stages.length - 1} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors">
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="panel-inset p-3 grid grid-cols-2 gap-3">
        <div><div className="telemetry-label">Target</div><div className="telemetry-value">{activeStage.targetN.toFixed(0)}N</div></div>
        <div><div className="telemetry-label">Tolerance</div><div className="telemetry-value">&plusmn;{activeStage.toleranceN.toFixed(1)}N</div></div>
      </div>

      <div>
        <div className="flex justify-between text-xs text-muted-foreground mb-1"><span>Cells</span><span className="font-mono">{progress.done} / {progress.total}</span></div>
        <div className="w-full h-1.5 bg-background rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
        </div>
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

// Temporary collapsed-summary formatters for Warmup/Tare/Test rows.
// Tasks 3-4 will refine these; in this task they just give a reasonable one-liner.
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
function testSummary(phase: string, totalStages: number): string {
  if (phase === 'IDLE' || phase === 'WARMUP' || phase === 'TARE') return 'Pending'
  if (phase === 'SUMMARY') return '✓ All stages complete'
  return `Stage ${totalStages > 0 ? '…' : '—'} active`
}
```

- [ ] **Step 2.3: Run tests**

Run: `npm test`

Expected: all tests still pass (no regressions; helpers from Task 1 keep passing). If a typecheck error blocks vitest, fix it before moving on.

- [ ] **Step 2.4: Manual validation in the dev server**

Run: `npm run dev` (this opens the Electron window).

Manually verify:
1. With no session running: five rows are visible in the right-hand control panel, Meta Data is expanded, the rest collapsed.
2. Fill out Meta Data → Start Session button at the bottom becomes enabled → click it → Warmup row auto-expands.
3. Clicking any other row expands it (peeking) without changing phase.
4. End Session button appears at the bottom during any active phase and returns to IDLE.
5. Phase badge at the top still reflects the current phase.

If any of these fail, fix before committing. If visual issues remain, leave them for Task 3+ to address — only regressions in behavior are blockers here.

- [ ] **Step 2.5: Commit**

```bash
git add src/pages/fluxlite/ControlPanel.tsx
git commit -m "refactor(control-panel): accordion stepper shell + persistent action bar"
```

---

### Task 3: Inline Warmup and Tare progress (remove panel-inset countdown cards)

This task restyles the Warmup and Tare row bodies. It's grouped because both follow the same pattern (inline progress bar + terse copy, no `panel-inset` block).

**Files:**
- Modify: `src/pages/fluxlite/ControlPanel.tsx`

- [ ] **Step 3.1: Slim down `WarmupBody`**

The body already has an inline progress bar from Task 2 — in this step, tighten the rest. Replace the `WarmupBody` return block with:

```tsx
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
```

Skip button shrinks to a subtle text link (matches the "No Model attached →" pattern you already established).

- [ ] **Step 3.2: Slim down `TareBody`**

Replace the `TareBody` return block with:

```tsx
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
```

- [ ] **Step 3.3: Run tests**

Run: `npm test` → expected all pass.

- [ ] **Step 3.4: Manual validation**

In `npm run dev`: run through a session → on the Warmup row, confirm the progress bar is thinner, there's no longer a big inset card, and "Skip warmup →" reads as a link. Same for Tare. Timers count down correctly and auto-advance still works.

- [ ] **Step 3.5: Commit**

```bash
git add src/pages/fluxlite/ControlPanel.tsx
git commit -m "refactor(control-panel): inline warmup and tare progress bars"
```

---

### Task 4: Replace chevron stage nav with 2×3 stage grid

**Files:**
- Modify: `src/pages/fluxlite/ControlPanel.tsx`

- [ ] **Step 4.1: Add a new helper import and the `StageGrid` subcomponent**

At the top of the file, ensure these imports exist:

```tsx
import { stageStats } from './controlPanelHelpers'
```

Add this component to `ControlPanel.tsx` (place it just above `TestBody`):

```tsx
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
```

- [ ] **Step 4.2: Rewrite `TestBody` to use `StageGrid`**

Replace the `TestBody` component entirely with:

```tsx
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
        {(measurementStatus.state === 'ARMING' || measurementStatus.state === 'MEASURING') && (
          <div className="w-full h-1 bg-background rounded-full overflow-hidden mt-2">
            <div className={`h-full rounded-full transition-all duration-100 ${measurementStatus.state === 'ARMING' ? 'bg-primary' : 'bg-warning'}`} style={{ width: `${(measurementStatus.progressMs / 1000) * 100}%` }} />
          </div>
        )}
      </div>
    </div>
  )
}
```

Note the chevron-left/chevron-right nav is gone; `ChevronLeft`/`ChevronRight` lucide imports may now be unused — you'll clean them up in Task 6.

- [ ] **Step 4.3: Refine the `testSummary` helper for collapsed state**

Replace the existing `testSummary` function with:

```tsx
import { stagesStartedCount } from './controlPanelHelpers'
// (merge this with the existing import line from controlPanelHelpers)

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
```

Then update the `<StepperRow id="test">` invocation in `ControlPanel` to pass the richer args:

```tsx
summary={testSummary(phase, useLiveTestStore.getState().measurements, stages.length, (useLiveTestStore.getState().gridRows * useLiveTestStore.getState().gridCols) * stages.length)}
```

Hmm — `useLiveTestStore.getState()` inside render is a known anti-pattern that bypasses reactivity. Prefer using the already-subscribed values at the top of `ControlPanel`:

```tsx
const measurements = useLiveTestStore((s) => s.measurements)
const gridRows = useLiveTestStore((s) => s.gridRows)
const gridCols = useLiveTestStore((s) => s.gridCols)
```

(Add these at the top if they aren't there yet.) Then:

```tsx
summary={testSummary(phase, measurements, stages.length, gridRows * gridCols * stages.length)}
```

- [ ] **Step 4.4: Run tests**

Run: `npm test` → expected all pass.

- [ ] **Step 4.5: Manual validation**

Start a session end-to-end. In the Test row:
- 2×3 grid shows all 6 stages with `DB·A`, `2L·A`, etc.
- Clicking any cell updates the active stage (visible in the bottom "Active:" line and in the main canvas)
- Completed stages get a green tint; the active stage gets a blue border; pending stages are neutral
- As you measure cells, the `tested`/`pass` counts update in real time
- Collapsed Test row summary shows `2/6 stages · 14/90 cells` (example)

- [ ] **Step 4.6: Commit**

```bash
git add src/pages/fluxlite/ControlPanel.tsx
git commit -m "refactor(control-panel): 2x3 stage grid replaces chevron stage nav"
```

---

### Task 5: Meta Data collapsed-vs-expanded polish

**Files:**
- Modify: `src/pages/fluxlite/ControlPanel.tsx`

This task is mostly about making sure the collapsed summary + read-only expanded view look right.

- [ ] **Step 5.1: Populate form inputs from metadata once a session starts**

Find the local state declarations in `ControlPanel`:

```tsx
const [testerName, setTesterName] = useState('')
const [bodyWeightNInput, setBodyWeightNInput] = useState('')
```

Add an effect that syncs them when `metadata` becomes non-null (so if the user re-opens the Meta Data row mid-session, the inputs they would have seen match reality, even though they're now read-only):

```tsx
useEffect(() => {
  if (metadata) {
    setTesterName(metadata.testerName)
    setBodyWeightNInput(String(Math.round(metadata.bodyWeightN)))
  }
}, [metadata])
```

This is belt-and-suspenders — `MetaDataBody` already renders read-only values from `metadata` when `phase !== 'IDLE'`. This just keeps the form state in sync for correctness.

- [ ] **Step 5.2: Verify `formatMetaSummary` handles the no-plate-selected case well**

Your `MetaDataBody` uses `metadata.deviceId` for the plate field. In IDLE with no plate selected, `metadata` is `null`, so the collapsed summary shows "Fill out metadata to begin" — that's correct per spec.

No code change needed here; just manually confirm:
- In IDLE before picking a plate: collapsed Meta Data summary says `Fill out metadata to begin`.
- After picking a plate + typing name + weight: summary still says the same (metadata isn't created until Start is pressed).

Design choice: if you want the summary to update as fields are filled in pre-session (e.g., show `John · 800N · 07.abc…` before pressing Start), change the `summary={metaSummary}` prop on the Meta Data row to:

```tsx
summary={metadata
  ? formatMetaSummary(metadata)
  : (selectedDevice && testerName && bodyWeightN > 0
      ? `${testerName} · ${Math.round(bodyWeightN)}N · ${selectedDevice.axfId}`
      : 'Fill out metadata to begin')}
```

Decide: does the spec want live-updating preview? Re-read the spec's Meta Data row table. It says "IDLE, fields valid → `{name} · {weightN}N · {plateId}`". So **yes**, the summary should update live from the form. Use the second form above.

- [ ] **Step 5.3: Run tests**

Run: `npm test` → all pass.

- [ ] **Step 5.4: Manual validation**

- Type into Name and Weight while on IDLE: collapsed Meta Data summary updates live.
- Start session: summary remains (now sourced from `metadata`).
- Click Meta Data row while session is active: body shows read-only `Plate / Model / Name / Weight`, no inputs. Cannot edit.

- [ ] **Step 5.5: Commit**

```bash
git add src/pages/fluxlite/ControlPanel.tsx
git commit -m "refactor(control-panel): live-updating meta summary + sync form with session metadata"
```

---

### Task 6: Cleanup & final validation

**Files:**
- Modify: `src/pages/fluxlite/ControlPanel.tsx`

- [ ] **Step 6.1: Prune unused imports**

Open the file. Check that every named import from `lucide-react` is used in the current JSX:

- `Play` — used in the action bar
- `Square` — used in the action bar
- `ChevronDown` — used in `StepperRow`
- `ChevronLeft` / `ChevronRight` — should now be unused (removed in Task 4). Delete them.

Remove any other imports (React, store hooks, types) that are no longer referenced. If a utility from `liveTestTypes` isn't used anywhere after your edits, drop it.

- [ ] **Step 6.2: Confirm no dead components**

Grep for `IdlePanel`, `WarmupPanel`, `TarePanel`, `TestingPanel`, `SummaryPanel`, `Section` inside `src/`. These should no longer exist anywhere. If any lingering reference exists in the file (in a comment, unused function, etc.), delete it.

Run: `grep -rn "IdlePanel\|WarmupPanel\|TarePanel\|TestingPanel\|SummaryPanel" src/`

Expected: no matches.

- [ ] **Step 6.3: Run the full test suite**

Run: `npm test`

Expected: `Tests  <N> passed` (should be original 41 plus the ~15 new helper tests = ~56).

- [ ] **Step 6.4: Run typecheck**

Run: `npx tsc --noEmit --ignoreDeprecations 6.0 2>&1 | grep -v "frameParser\|main.tsx\|LiveView" | head -30`

(We filter out three known pre-existing errors: `frameParser.ts` type cast, `main.tsx` index.css types, and an orphaned `LiveView.tsx`. Those are not introduced by this plan — do not fix them here.)

Expected: no output (meaning no new typecheck errors caused by this plan).

- [ ] **Step 6.5: Full end-to-end manual test**

Start `npm run dev`. Run through an entire session:

1. With no plate selected: Meta Data row expanded, summary says `Fill out metadata to begin`, Start button disabled.
2. Select a plate from the left DeviceList: Plate ID populates.
3. Fill Name and Weight: summary updates live, Start button enables.
4. Click Start: session begins, Warmup row auto-expands, phase badge says `WARMUP`.
5. Jump on plate: warmup triggers, progress bar fills over 20s, auto-advances to Tare.
6. Step off plate: Tare counts down 15s, auto-tares, advances to Testing.
7. Test row auto-expands: 2×3 grid visible, one cell has blue border (active).
8. Click a different stage cell: active stage changes in the canvas; grid highlight moves.
9. Measure cells: stats update in each stage cell live.
10. Complete a stage (all cells): cell gets green tint + checkmark.
11. Click End Session at the bottom: session ends.
12. Click New Session: returns to IDLE, form reset.

If any step fails, fix it and re-run. If a visual issue is cosmetic (not behavioral), leave it — ship the behavior, iterate on look separately.

- [ ] **Step 6.6: Final commit**

```bash
git add src/pages/fluxlite/ControlPanel.tsx
git commit -m "chore(control-panel): prune unused imports after stepper refactor"
```

---

## Acceptance criteria

- [ ] All tasks above committed.
- [ ] `npm test` reports all tests passing, including the new helpers suite (~56 tests total).
- [ ] `npx tsc --noEmit --ignoreDeprecations 6.0` introduces no new errors over the pre-existing three.
- [ ] Manual end-to-end session flow passes (Step 6.5).
- [ ] `IdlePanel`, `WarmupPanel`, `TarePanel`, `TestingPanel`, `SummaryPanel`, `Section` symbols are deleted.
- [ ] No `Tare All` / `Refresh Devices` buttons return — they were already moved (Tare All gone entirely; Refresh Devices lives in `DeviceList`).
- [ ] The only buttons inside the Control Panel are: Skip warmup, Skip & tare, stage cells, Start/End/New Session (one at a time in the bottom bar), and the row headers themselves.

## What this plan explicitly does NOT do

- No color-palette or `bg-card` surface-contrast changes. That's a separate design question the user deferred — the hypothesis is that the new row structure fixes the "muddy" feeling without re-tinting anything.
- No changes to `liveTestStore`, `deviceStore`, `liveDataStore`, `uiStore`, `useSocket`, `measurementEngine`, or any socket-event handler.
- No changes to the main visualization area (PlateCanvas, ForcePlot, ForceGauges, etc).
- No React component tests added. Existing test style is pure-function only; matching that deliberately.
