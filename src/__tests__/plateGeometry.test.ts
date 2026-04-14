import { describe, it, expect } from 'vitest'
import { mapCellForDevice, mapCellForRotation, getColorBin } from '../lib/plateGeometry'

describe('mapCellForDevice', () => {
  it('mirrors cells for type 06', () => {
    const [r, c] = mapCellForDevice(0, 0, 3, 3, '06')
    expect(r).toBe(2)
    expect(c).toBe(2)
  })
  it('passes through for type 07', () => {
    const [r, c] = mapCellForDevice(0, 0, 5, 3, '07')
    expect(r).toBe(0)
    expect(c).toBe(0)
  })
})

describe('mapCellForRotation', () => {
  it('rotation 0 is identity', () => {
    expect(mapCellForRotation(1, 2, 3, 3, 0)).toEqual([1, 2])
  })
  it('rotation 1 (90 degrees)', () => {
    expect(mapCellForRotation(0, 0, 3, 3, 1)).toEqual([0, 2])
  })
  it('rotation 2 (180 degrees)', () => {
    expect(mapCellForRotation(0, 0, 3, 3, 2)).toEqual([2, 2])
  })
  it('rotation 3 (270 degrees)', () => {
    expect(mapCellForRotation(0, 0, 3, 3, 3)).toEqual([2, 0])
  })
})

describe('getColorBin', () => {
  it('returns green for low error', () => {
    expect(getColorBin(0.3)).toBe('green')
  })
  it('returns red for high error', () => {
    expect(getColorBin(3.0)).toBe('red')
  })
})
