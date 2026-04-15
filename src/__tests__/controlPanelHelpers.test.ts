import { describe, it, expect } from 'vitest'
import {
  rowForPhase,
  stageStats,
  rowStatus,
  stagesStartedCount,
  formatMetaSummary,
  stageErrorStats,
} from '../pages/fluxlite/controlPanelHelpers'
import type { CellMeasurement } from '../lib/liveTestTypes'

function m(
  row: number, col: number, stageIndex: number, pass: boolean,
  signedErrorN = 0,
): CellMeasurement {
  return {
    row, col, stageIndex, pass,
    meanFzN: 0, stdFzN: 0, errorN: Math.abs(signedErrorN), signedErrorN, errorRatio: 0,
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

describe('stageErrorStats', () => {
  it('returns zeros for an empty measurements map', () => {
    const out = stageErrorStats(new Map(), 0, 800)
    expect(out).toEqual({ tested: 0, signedPct: 0, maePct: 0, stdPct: 0 })
  })

  it('returns zeros when targetN is 0 (defensive)', () => {
    const measurements = new Map<string, CellMeasurement>([
      ['0,0', m(0, 0, 0, true, 10)],
    ])
    const out = stageErrorStats(measurements, 0, 0)
    expect(out).toEqual({ tested: 0, signedPct: 0, maePct: 0, stdPct: 0 })
  })

  it('computes signed and MAE percentages', () => {
    // Target 200N. Signed errors: +10N, -10N → +5%, -5%.
    // signedPct mean = 0; maePct mean = 5.
    const measurements = new Map<string, CellMeasurement>([
      ['0,0', m(0, 0, 0, true, 10)],
      ['0,1', m(0, 1, 0, true, -10)],
    ])
    const out = stageErrorStats(measurements, 0, 200)
    expect(out.tested).toBe(2)
    expect(out.signedPct).toBeCloseTo(0, 5)
    expect(out.maePct).toBeCloseTo(5, 5)
  })

  it('computes population std of signed % error', () => {
    // Target 100N. Signed errors +10, -10, +20, -20 → percentages +10, -10, +20, -20.
    // Mean = 0. Variance (population) = (100+100+400+400)/4 = 250. Std ≈ 15.811.
    const measurements = new Map<string, CellMeasurement>([
      ['0,0', m(0, 0, 0, true, 10)],
      ['0,1', m(0, 1, 0, true, -10)],
      ['1,0', m(1, 0, 0, true, 20)],
      ['1,1', m(1, 1, 0, true, -20)],
    ])
    const out = stageErrorStats(measurements, 0, 100)
    expect(out.signedPct).toBeCloseTo(0, 5)
    expect(out.maePct).toBeCloseTo(15, 5)
    expect(out.stdPct).toBeCloseTo(Math.sqrt(250), 5)
  })

  it('only includes measurements from the requested stage', () => {
    const measurements = new Map<string, CellMeasurement>([
      ['0,0', m(0, 0, 0, true, 10)],  // included
      ['0,1', m(0, 1, 1, true, 100)], // wrong stage — excluded
    ])
    const out = stageErrorStats(measurements, 0, 100)
    expect(out.tested).toBe(1)
    expect(out.signedPct).toBeCloseTo(10, 5)
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
