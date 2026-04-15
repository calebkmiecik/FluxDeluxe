import { describe, it, expect } from 'vitest'
import { computeScreenBracket } from '../../components/canvas/plate3d/cellOverlay'

describe('computeScreenBracket', () => {
  it('produces four L-bracket path segments around a rect', () => {
    const brackets = computeScreenBracket({ x: 100, y: 50, w: 200, h: 100 }, 16)
    expect(brackets).toHaveLength(4)
    // Top-left bracket: starts at (100, 66) → (100, 50) → (116, 50)
    expect(brackets[0]).toEqual([
      { x: 100, y: 66 },
      { x: 100, y: 50 },
      { x: 116, y: 50 },
    ])
  })

  it('respects custom length', () => {
    const brackets = computeScreenBracket({ x: 0, y: 0, w: 100, h: 100 }, 8)
    // Top-right bracket points
    expect(brackets[1]).toEqual([
      { x: 92, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 8 },
    ])
  })
})
