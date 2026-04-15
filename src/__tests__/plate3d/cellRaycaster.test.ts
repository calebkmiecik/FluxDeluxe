import { describe, it, expect } from 'vitest'
import {
  hitPointToCanonicalCell,
  canonicalCellToWorldXZ,
} from '../../components/canvas/plate3d/cellRaycaster'
import { GRID_DIMS } from '../../lib/types'

const BOUNDS = { minX: -0.2, maxX: 0.2, minZ: -0.15, maxZ: 0.15 }

describe('hitPointToCanonicalCell', () => {
  it('type 07 rotation 0 — top-left corner hit returns (0,0)', () => {
    // In plate-local XZ, minX/minZ is display (0,0). Device 07 is
    // pass-through (no device mirroring).
    const cell = hitPointToCanonicalCell(
      BOUNDS.minX + 0.001, BOUNDS.minZ + 0.001,
      '07', 0, BOUNDS,
    )
    expect(cell).toEqual([0, 0])
  })

  it('type 07 rotation 0 — bottom-right corner hit returns (rows-1, cols-1)', () => {
    const { rows, cols } = GRID_DIMS['07']
    const cell = hitPointToCanonicalCell(
      BOUNDS.maxX - 0.001, BOUNDS.maxZ - 0.001,
      '07', 0, BOUNDS,
    )
    expect(cell).toEqual([rows - 1, cols - 1])
  })

  it('miss outside bounds returns null', () => {
    const cell = hitPointToCanonicalCell(
      BOUNDS.maxX + 0.1, 0,
      '07', 0, BOUNDS,
    )
    expect(cell).toBeNull()
  })

  it('round-trips canonical → world XZ → canonical for all device × rotation', () => {
    const cases: Array<{ type: string; r: number; c: number }> = [
      { type: '06', r: 0, c: 0 },
      { type: '06', r: 2, c: 1 },
      { type: '07', r: 3, c: 2 },
      { type: '08', r: 4, c: 4 },
      { type: '11', r: 1, c: 1 },
      { type: '12', r: 0, c: 3 },
    ]
    for (const { type, r, c } of cases) {
      for (let rot = 0; rot < 4; rot++) {
        const { x, z } = canonicalCellToWorldXZ(r, c, type, rot, BOUNDS)
        const back = hitPointToCanonicalCell(x, z, type, rot, BOUNDS)
        expect(back, `${type} rot=${rot} (${r},${c})`).toEqual([r, c])
      }
    }
  })
})
