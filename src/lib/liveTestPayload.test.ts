import { describe, it, expect } from 'vitest'
import { buildSessionPayload } from './liveTestPayload'
import type { CellMeasurement, SessionMetadata, StageDefinition } from './liveTestTypes'

function cell(p: Partial<CellMeasurement>): CellMeasurement {
  return {
    row: 0, col: 0, stageIndex: 0,
    meanFzN: 100, stdFzN: 1,
    errorN: 0, signedErrorN: 0, errorRatio: 0,
    colorBin: 'green', pass: true, timestamp: 1700000000000,
    ...p,
  }
}

const meta: SessionMetadata = {
  testerName: 'caleb',
  bodyWeightN: 800,
  deviceId: 'AXF-07-0123',
  deviceType: '07',
  modelId: 'v2.1',
  startedAt: 1700000000000,
}

const stages: StageDefinition[] = [
  { index: 0, name: 'DB A',  type: 'dumbbell', location: 'A', targetN: 206.3, toleranceN: 6 },
  { index: 1, name: '2L A',  type: 'two_leg',  location: 'A', targetN: 800,   toleranceN: 12 },
  { index: 2, name: '1L A',  type: 'one_leg',  location: 'A', targetN: 800,   toleranceN: 12 },
  { index: 3, name: 'DB B',  type: 'dumbbell', location: 'B', targetN: 206.3, toleranceN: 6 },
  { index: 4, name: '2L B',  type: 'two_leg',  location: 'B', targetN: 800,   toleranceN: 12 },
  { index: 5, name: '1L B',  type: 'one_leg',  location: 'B', targetN: 800,   toleranceN: 12 },
]

describe('buildSessionPayload', () => {
  it('produces a valid payload with all required fields', () => {
    const measurements = new Map<string, CellMeasurement>()
    measurements.set('0:0,0', cell({ stageIndex: 0, pass: true,  errorN: 4, signedErrorN: 4 }))
    measurements.set('0:0,1', cell({ stageIndex: 0, pass: false, errorN: 8, signedErrorN: -8 }))

    const payload = buildSessionPayload({
      metadata: meta,
      stages,
      measurements,
      gridRows: 3,
      gridCols: 3,
      appVersion: '2.0.0',
      endedAt: 1700000060000,
    })

    // uuid
    expect(payload.session.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(payload.session.device_id).toBe('AXF-07-0123')
    expect(payload.session.started_at).toBe(new Date(1700000000000).toISOString())
    expect(payload.session.ended_at).toBe(new Date(1700000060000).toISOString())
    expect(payload.session.n_cells_captured).toBe(2)
    expect(payload.session.n_cells_expected).toBe(54)
    expect(payload.session.overall_pass_rate).toBeCloseTo(0.5, 5)

    expect(payload.cells).toHaveLength(2)
    expect(payload.cells[0].stage_type).toBe('dumbbell')
    expect(payload.cells[0].stage_location).toBe('A')
    expect(payload.cells[0].signed_error_n).toBe(4)

    expect(payload.aggregates).toHaveLength(3)
    const db = payload.aggregates.find((a) => a.stage_type === 'dumbbell')!
    expect(db.n_cells).toBe(2)
    expect(db.mae).toBeCloseTo(6, 5)
  })

  it('overall_pass_rate is null when no cells captured', () => {
    const payload = buildSessionPayload({
      metadata: meta,
      stages,
      measurements: new Map(),
      gridRows: 3,
      gridCols: 3,
      appVersion: '2.0.0',
      endedAt: 1700000060000,
    })
    expect(payload.session.overall_pass_rate).toBeNull()
    expect(payload.cells).toHaveLength(0)
    // aggregates still present, all null
    expect(payload.aggregates).toHaveLength(3)
    expect(payload.aggregates.every((a) => a.n_cells === 0 && a.mae === null)).toBe(true)
  })
})
