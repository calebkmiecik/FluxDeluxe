import type { CellMeasurement, SessionMetadata, StageDefinition, StageType } from './liveTestTypes'
import { computeStageTypeAggregates, computeOverallPassRate } from './liveTestAggregates'

export interface SessionRow {
  id: string
  started_at: string
  ended_at: string
  device_id: string
  device_type: string
  model_id: string
  tester_name: string
  body_weight_n: number
  grid_rows: number
  grid_cols: number
  n_cells_captured: number
  n_cells_expected: number
  overall_pass_rate: number | null
  session_passed: boolean | null
  app_version: string
}

export interface CellRow {
  stage_index: number
  stage_name: string
  stage_type: StageType
  stage_location: 'A' | 'B'
  target_n: number
  tolerance_n: number
  row: number
  col: number
  mean_fz_n: number
  std_fz_n: number
  error_n: number
  signed_error_n: number
  error_ratio: number
  color_bin: string
  pass: boolean
  captured_at: string
}

export interface AggregateRow {
  stage_type: StageType
  n_cells: number
  mae: number | null
  signed_mean_error: number | null
  std_error: number | null
  pass_rate: number | null
}

export interface SaveSessionPayload {
  session: SessionRow
  cells: CellRow[]
  aggregates: AggregateRow[]
}

export interface BuildPayloadInput {
  metadata: SessionMetadata
  stages: StageDefinition[]
  measurements: Map<string, CellMeasurement>
  gridRows: number
  gridCols: number
  appVersion: string
  endedAt: number
  /** Session-level pass/fail, determined by operator against a threshold. null if not yet determined. */
  sessionPassed?: boolean | null
  // optional, for deterministic tests
  id?: string
}

function uuid(): string {
  // crypto.randomUUID is available in Node 19+ and browsers; Electron renderer supports it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = globalThis
  if (g.crypto?.randomUUID) return g.crypto.randomUUID()
  // Fallback (unlikely path): simple RFC4122 v4
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function buildSessionPayload(input: BuildPayloadInput): SaveSessionPayload {
  const { metadata, stages, measurements, gridRows, gridCols, appVersion, endedAt } = input
  const id = input.id ?? uuid()

  const stageByIndex = new Map(stages.map((s) => [s.index, s]))
  const cellsArr = Array.from(measurements.values())

  const cells: CellRow[] = cellsArr.map((c) => {
    const stage = stageByIndex.get(c.stageIndex)
    if (!stage) {
      throw new Error(`Measurement references unknown stageIndex ${c.stageIndex}`)
    }
    return {
      stage_index: c.stageIndex,
      stage_name: stage.name,
      stage_type: stage.type,
      stage_location: stage.location,
      target_n: stage.targetN,
      tolerance_n: stage.toleranceN,
      row: c.row,
      col: c.col,
      mean_fz_n: c.meanFzN,
      std_fz_n: c.stdFzN,
      error_n: c.errorN,
      signed_error_n: c.signedErrorN,
      error_ratio: c.errorRatio,
      color_bin: c.colorBin,
      pass: c.pass,
      captured_at: new Date(c.timestamp).toISOString(),
    }
  })

  const aggregates = computeStageTypeAggregates(cellsArr, stageByIndex)
  const overallPass = computeOverallPassRate(cellsArr)

  const session: SessionRow = {
    id,
    started_at: new Date(metadata.startedAt).toISOString(),
    ended_at: new Date(endedAt).toISOString(),
    device_id: metadata.deviceId,
    device_type: metadata.deviceType,
    model_id: metadata.modelId,
    tester_name: metadata.testerName,
    body_weight_n: metadata.bodyWeightN,
    grid_rows: gridRows,
    grid_cols: gridCols,
    n_cells_captured: cellsArr.length,
    n_cells_expected: gridRows * gridCols * 6,
    overall_pass_rate: overallPass,
    session_passed: input.sessionPassed ?? null,
    app_version: appVersion,
  }

  return { session, cells, aggregates }
}
