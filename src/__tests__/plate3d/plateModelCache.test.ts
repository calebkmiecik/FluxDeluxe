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

  it('returns empty array for invalid base64 (graceful fallback per spec §11)', () => {
    expect(base64ToFloat32Array('!!!invalid!!!').length).toBe(0)
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

  it('decodes populated JSON (geometry is rotated 90° CW at load)', () => {
    const json = {
      edges: encodeFloats([0, 0, 0, 1, 0, 0]),
      floorY: -0.05,
      bounds: { minX: -0.2, maxX: 0.2, minZ: -0.15, maxZ: 0.15 },
    }
    const geom = parsePlateJSON(json)
    expect(geom.bodyEdges.length).toBe(6)
    expect(geom.floorY).toBe(-0.05)
    // Rotation (x,y,z) → (-z, y, x) → bounds:
    //   new minX = -maxZ (-0.15), new maxX = -minZ (0.15)
    //   new minZ =  minX (-0.2),  new maxZ =  maxX (0.2)
    expect(geom.bounds.minX).toBeCloseTo(-0.15)
    expect(geom.bounds.maxX).toBeCloseTo(0.15)
    expect(geom.bounds.minZ).toBeCloseTo(-0.2)
    expect(geom.bounds.maxZ).toBeCloseTo(0.2)
    // Edge vertex rotation: (0,0,0)→(0,0,0), (1,0,0)→(0,0,1)
    expect(geom.bodyEdges[0]).toBeCloseTo(0)   // x0
    expect(geom.bodyEdges[2]).toBeCloseTo(0)   // z0
    expect(geom.bodyEdges[3]).toBeCloseTo(0)   // x1 (was 1, now -0 = 0)
    expect(geom.bodyEdges[5]).toBeCloseTo(1)   // z1 (was 0, now prev x = 1)
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

  it('edge pair at exactly midY goes to upper bucket', () => {
    // minY = 0, maxY = 1 → midY = 0.5. Edge at exactly y=0.5 on both endpoints.
    const edges = new Float32Array([
      0, 0, 0,  1, 0, 0,         // pair #1 — anchors minY=0
      0, 1, 0,  1, 1, 0,         // pair #2 — anchors maxY=1
      0, 0.5, 0,  1, 0.5, 0,     // pair #3 — exactly at midY
    ])
    const { upper, lower } = splitEdgesByY(edges)
    expect(lower).not.toBeNull()
    expect(upper).not.toBeNull()
    expect(lower!.length).toBe(6)  // only pair #1
    expect(upper!.length).toBe(12) // pairs #2 and #3
  })
})
