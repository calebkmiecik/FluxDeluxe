import { describe, it, expect } from 'vitest'
import { mapCellForDevice, mapCellForRotation, invertRotation, getColorBin } from '../lib/plateGeometry'

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

describe('mapCellForRotation on non-square grids (regression test)', () => {
  // For a 3×2 grid (rows=3, cols=2) rotated 90° CW, cell (0,0) maps to
  // (0, rows-1) = (0, 2) in the resulting 2×3 display grid.
  it('q=1: 3×2 grid, (0,0) -> (0, 2)', () => {
    expect(mapCellForRotation(0, 0, 3, 2, 1)).toEqual([0, 2])
  })

  it('q=3: 3×2 grid, (0,0) -> (1, 0)', () => {
    // Rotate 270° CW: cell (0,0) ends up at (cols-1, 0) = (1, 0) in 2×3
    expect(mapCellForRotation(0, 0, 3, 2, 3)).toEqual([1, 0])
  })

  it('q=1 round-trip: 3×2 grid', () => {
    const [r1, c1] = mapCellForRotation(2, 1, 3, 2, 1)
    // Invert back (note: inverse takes the ROTATED grid's shape)
    const [r0, c0] = invertRotation(r1, c1, 3, 2, 1)
    expect([r0, c0]).toEqual([2, 1])
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
