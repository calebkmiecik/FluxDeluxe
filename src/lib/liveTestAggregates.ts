import type { CellMeasurement, StageDefinition, StageType } from './liveTestTypes'

export interface StageTypeAggregate {
  stage_type: StageType
  n_cells: number
  mae: number | null
  signed_mean_error: number | null
  std_error: number | null
  pass_rate: number | null
}

const ALL_TYPES: StageType[] = ['dumbbell', 'two_leg', 'one_leg']

export function computeStageTypeAggregates(
  cells: CellMeasurement[],
  stagesByIndex: Map<number, StageDefinition>,
): StageTypeAggregate[] {
  return ALL_TYPES.map((stage_type) => {
    const bucket = cells.filter((c) => stagesByIndex.get(c.stageIndex)?.type === stage_type)
    const n_cells = bucket.length
    if (n_cells === 0) {
      return { stage_type, n_cells: 0, mae: null, signed_mean_error: null, std_error: null, pass_rate: null }
    }
    const mae = bucket.reduce((s, c) => s + c.errorN, 0) / n_cells
    const signedMean = bucket.reduce((s, c) => s + c.signedErrorN, 0) / n_cells
    const variance = bucket.reduce((s, c) => s + (c.signedErrorN - signedMean) ** 2, 0) / n_cells
    const std = Math.sqrt(variance)
    const passed = bucket.filter((c) => c.pass).length
    return {
      stage_type,
      n_cells,
      mae,
      signed_mean_error: signedMean,
      std_error: std,
      pass_rate: passed / n_cells,
    }
  })
}

export function computeOverallPassRate(cells: CellMeasurement[]): number | null {
  if (cells.length === 0) return null
  const passed = cells.filter((c) => c.pass).length
  return passed / cells.length
}
