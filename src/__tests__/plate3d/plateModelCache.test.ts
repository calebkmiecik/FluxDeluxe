import { describe, it, expect } from 'vitest'
import {
  base64ToFloat32Array,
  parsePlateJSON,
  splitEdgesByY,
} from '../../components/canvas/plate3d/plateModelCache'

// Helper: round-trip a Float32Array through base64
function encodeFloats(arr: number[]): string {
  const f = new Float32Array(arr)
  const bytes = new Uint8Array(f.buffer)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

describe('base64ToFloat32Array', () => {
  it('decodes a round-tripped Float32Array', () => {
    const b64 = encodeFloats([1.5, -2.25, 3.0])
    const out = base64ToFloat32Array(b64)
    expect(out.length).toBe(3)
    expect(out[0]).toBeCloseTo(1.5)
    expect(out[1]).toBeCloseTo(-2.25)
    expect(out[2]).toBeCloseTo(3.0)
  })

  it('returns empty array for empty string', () => {
    expect(base64ToFloat32Array('').length).toBe(0)
  })
})

describe('parsePlateJSON', () => {
  it('populates all fields with defaults when missing', () => {
    const geom = parsePlateJSON({})
    expect(geom.bodyEdges.length).toBe(0)
    expect(geom.footEdges.length).toBe(0)
    expect(geom.topPlateEdges.length).toBe(0)
    expect(geom.faces.length).toBe(0)
    expect(geom.floorY).toBe(0)
    expect(geom.bounds).toEqual({ minX: -0.3, maxX: 0.3, minZ: -0.3, maxZ: 0.3 })
  })

  it('decodes populated JSON', () => {
    const json = {
      edges: encodeFloats([0, 0, 0, 1, 0, 0]),
      floorY: -0.05,
      bounds: { minX: -0.2, maxX: 0.2, minZ: -0.15, maxZ: 0.15 },
    }
    const geom = parsePlateJSON(json)
    expect(geom.bodyEdges.length).toBe(6)
    expect(geom.floorY).toBe(-0.05)
    expect(geom.bounds.maxX).toBe(0.2)
  })
})

describe('splitEdgesByY', () => {
  it('returns nulls for null/short input', () => {
    expect(splitEdgesByY(null).upper).toBeNull()
    expect(splitEdgesByY(null).lower).toBeNull()
    expect(splitEdgesByY(new Float32Array([0, 0, 0])).upper).toBeNull()
  })

  it('splits edges by midY — pair below midY → lower, pair above → upper', () => {
    // Two edges: one fully at y=0 (lower), one fully at y=1 (upper)
    const edges = new Float32Array([
      0, 0, 0,  1, 0, 0,   // lower edge
      0, 1, 0,  1, 1, 0,   // upper edge
    ])
    const { upper, lower } = splitEdgesByY(edges)
    expect(lower).not.toBeNull()
    expect(upper).not.toBeNull()
    expect(lower!.length).toBe(6)
    expect(upper!.length).toBe(6)
    expect(lower![1]).toBe(0) // lower edge's first Y
    expect(upper![1]).toBe(1) // upper edge's first Y
  })

  it('mixed-Y edges fall into upper bucket', () => {
    const edges = new Float32Array([
      0, 0, 0,  1, 1, 0,   // crosses midY
    ])
    const { upper, lower } = splitEdgesByY(edges)
    expect(upper).not.toBeNull()
    expect(lower).toBeNull()
  })
})
