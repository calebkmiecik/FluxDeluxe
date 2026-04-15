import { describe, it, expect } from 'vitest'
import { computeStageTypeAggregates, computeOverallPassRate } from './liveTestAggregates'
import type { CellMeasurement } from './liveTestTypes'

function cell(partial: Partial<CellMeasurement>): CellMeasurement {
  return {
    row: 0, col: 0, stageIndex: 0,
    meanFzN: 100, stdFzN: 1,
    errorN: 0, signedErrorN: 0, errorRatio: 0,
    colorBin: 'green', pass: true, timestamp: 0,
    ...partial,
  }
}

describe('computeStageTypeAggregates', () => {
  it('returns 3 rows — one per stage_type — even when empty', () => {
    const result = computeStageTypeAggregates([], new Map([
      [0, { index: 0, name: 'DB', type: 'dumbbell', location: 'A', targetN: 100, toleranceN: 10 }],
    ]))
    expect(result).toHaveLength(3)
    const types = result.map((r) => r.stage_type).sort()
    expect(types).toEqual(['dumbbell', 'one_leg', 'two_leg'])
    for (const r of result) {
      expect(r.n_cells).toBe(0)
      expect(r.mae).toBeNull()
      expect(r.signed_mean_error).toBeNull()
      expect(r.std_error).toBeNull()
      expect(r.pass_rate).toBeNull()
    }
  })

  it('computes MAE, signed mean, and std across cells of one stage_type', () => {
    const stageMap = new Map([
      [0, { index: 0, name: 'DB-A', type: 'dumbbell' as const, location: 'A' as const, targetN: 100, toleranceN: 10 }],
      [3, { index: 3, name: 'DB-B', type: 'dumbbell' as const, location: 'B' as const, targetN: 100, toleranceN: 10 }],
    ])
    const cells: CellMeasurement[] = [
      cell({ stageIndex: 0, errorN: 4, signedErrorN: -4, pass: true  }),
      cell({ stageIndex: 0, errorN: 6, signedErrorN:  6, pass: true  }),
      cell({ stageIndex: 3, errorN: 8, signedErrorN: -8, pass: false }),
    ]
    const result = computeStageTypeAggregates(cells, stageMap)
    const db = result.find((r) => r.stage_type === 'dumbbell')!
    expect(db.n_cells).toBe(3)
    // MAE = mean(|error|) = (4+6+8)/3 = 6.0
    expect(db.mae).toBeCloseTo(6.0, 5)
    // signed mean = (-4 + 6 + -8) / 3 = -2.0
    expect(db.signed_mean_error).toBeCloseTo(-2.0, 5)
    // std of signed errors (population std)
    // mean -2; deviations -2,8,-6; squares 4,64,36 → var 34.666 → std ≈ 5.888
    expect(db.std_error).toBeCloseTo(5.888, 2)
    expect(db.pass_rate).toBeCloseTo(2 / 3, 5)
  })
})

describe('computeOverallPassRate', () => {
  it('returns null when no captured cells', () => {
    expect(computeOverallPassRate([])).toBeNull()
  })
  it('returns passed / total', () => {
    expect(computeOverallPassRate([
      cell({ pass: true  }),
      cell({ pass: true  }),
      cell({ pass: false }),
    ])).toBeCloseTo(2 / 3, 5)
  })
})
