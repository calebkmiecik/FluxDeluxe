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
  // meta is special: it's pending until the session starts, then complete.
  // It has no "active" state in the stepper — rowForPhase expands it during IDLE
  // but the row itself is displayed as pending (form awaiting submission).
  if (row === 'meta') {
    return phase === 'IDLE' ? 'pending' : 'complete'
  }
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
