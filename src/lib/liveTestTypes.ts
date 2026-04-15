import { THRESHOLDS_DB_N, THRESHOLDS_BW_PCT, GRID_DIMS } from './types'

// ── Session Phases ──────────────────────────────────────────────
export type LiveTestPhase =
  | 'IDLE'         // No session — metadata form visible
  | 'WARMUP'       // 20s precompression (jumping on plate)
  | 'TARE'         // 15s step-off countdown, then auto-tare
  | 'TESTING'      // Active measurement — cells being captured
  | 'STAGE_SWITCH' // Transitioning between stages
  | 'SUMMARY'      // Session complete — results view

// ── Stage Definitions ───────────────────────────────────────────
export type StageType = 'dumbbell' | 'two_leg' | 'one_leg'

export interface StageDefinition {
  index: number
  name: string
  type: StageType
  location: 'A' | 'B'
  targetN: number        // computed from type + body weight
  toleranceN: number     // computed from device type + body weight
}

export const STAGE_TEMPLATES: Omit<StageDefinition, 'targetN' | 'toleranceN'>[] = [
  { index: 0, name: '45 lb Dumbbell', type: 'dumbbell', location: 'A' },
  { index: 1, name: 'Two Leg',        type: 'two_leg',  location: 'A' },
  { index: 2, name: 'One Leg',        type: 'one_leg',  location: 'A' },
  { index: 3, name: '45 lb Dumbbell', type: 'dumbbell', location: 'B' },
  { index: 4, name: 'Two Leg',        type: 'two_leg',  location: 'B' },
  { index: 5, name: 'One Leg',        type: 'one_leg',  location: 'B' },
]

export const DUMBBELL_TARGET_N = 206.3

export function buildStages(deviceType: string, bodyWeightN: number): StageDefinition[] {
  const dbTol = THRESHOLDS_DB_N[deviceType] ?? 6.0
  const bwPct = THRESHOLDS_BW_PCT[deviceType] ?? 0.015
  const bwTol = bodyWeightN > 0 ? bodyWeightN * bwPct : dbTol

  return STAGE_TEMPLATES.map((t) => ({
    ...t,
    targetN: t.type === 'dumbbell' ? DUMBBELL_TARGET_N : bodyWeightN,
    toleranceN: t.type === 'dumbbell' ? dbTol : bwTol,
  }))
}

// ── Cell Measurement ────────────────────────────────────────────
export interface CellMeasurement {
  row: number
  col: number
  stageIndex: number
  meanFzN: number
  stdFzN: number
  errorN: number         // magnitude: |meanFz - target|
  signedErrorN: number   // directional: meanFz - target
  errorRatio: number   // error / tolerance
  colorBin: string     // 'green' | 'light_green' | 'yellow' | 'orange' | 'red'
  pass: boolean
  timestamp: number
}

// ── Measurement Engine State ────────────────────────────────────
export type MeasurementState =
  | 'IDLE'      // Waiting for load on a cell
  | 'ARMING'    // Load detected, counting 1s arming window
  | 'MEASURING' // Armed, collecting stability samples
  | 'CAPTURED'  // Measurement complete for this cell

export interface MeasurementStatus {
  state: MeasurementState
  cell: { row: number; col: number } | null
  progressMs: number    // 0-1000 for arming or stability
  reason?: string       // why not stable yet
}

// ── Session Metadata ────────────────────────────────────────────
export interface SessionMetadata {
  testerName: string
  bodyWeightN: number
  deviceId: string
  deviceType: string
  modelId: string       // active model on the device
  startedAt: number     // epoch ms
}

// ── Thresholds & Constants ──────────────────────────────────────
export const WARMUP_DURATION_MS = 20_000
export const WARMUP_TRIGGER_N = 50
export const TARE_DURATION_MS = 15_000
export const TARE_THRESHOLD_N = 50
export const ARMING_THRESHOLD_N = 50
export const ARMING_DURATION_MS = 1000
export const STABILITY_DURATION_MS = 1000
export const STABILITY_FZ_RANGE_PCT = 0.03  // 3% of mean
export const STABILITY_FZ_MIN_RANGE_N = 10
export const STABILITY_COP_MAX_MM = 100
export const PERIODIC_TARE_INTERVAL_MS = 90_000

export function getGridDims(deviceType: string): { rows: number; cols: number } {
  return GRID_DIMS[deviceType] ?? { rows: 3, cols: 3 }
}
