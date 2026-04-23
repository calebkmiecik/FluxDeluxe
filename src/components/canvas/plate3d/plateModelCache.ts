/**
 * Plate model cache — parses the production plate JSON format and
 * exposes typed Float32Arrays ready to feed into Three.js
 * BufferAttributes. Also splits top-plate edges by Y for the
 * depth-cue wireframe pass.
 *
 * JSON schema (only fields we use):
 *   edges          base64 Float32Array  — body side edges (pairs)
 *   footEdges      base64 Float32Array  — sensor-foot edges (pairs)
 *   topPlateEdges  base64 Float32Array  — top outline edges (pairs)
 *   faces          base64 Float32Array  — top surface triangles
 *   floorY         number               — meters
 *   bounds         { minX, maxX, minZ, maxZ }
 *
 * Coordinate system: right-handed, Y-up, meters.
 * Edges: every 6 floats = one segment (x1,y1,z1)→(x2,y2,z2).
 * Faces: every 9 floats = one triangle.
 */

export type EdgeSegments = Float32Array
export type FaceTriangles = Float32Array

export interface PlateGeometry {
  bodyEdges: EdgeSegments
  footEdges: EdgeSegments
  topPlateEdges: EdgeSegments
  faces: FaceTriangles
  floorY: number
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
}

interface RawPlateJSON {
  edges?: string
  footEdges?: string
  topPlateEdges?: string
  faces?: string
  floorY?: number
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number }
}

export function base64ToFloat32Array(b64: string): Float32Array {
  if (!b64) return new Float32Array(0)
  try {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Float32Array(bytes.buffer)
  } catch {
    return new Float32Array(0)
  }
}

/**
 * Rotate every vertex triple (x, y, z) in-place by 90° CW around the Y
 * axis: (x, y, z) → (-z, y, x). Used so the plate model aligns with the
 * sensor frame directly — downstream code can treat cop.x as the plate's
 * +X direction without per-device axis gymnastics.
 */
function rotatePlateVerticesCW(arr: Float32Array): Float32Array {
  const out = new Float32Array(arr.length)
  for (let i = 0; i + 2 < arr.length; i += 3) {
    out[i]     = -arr[i + 2] // new x = -old z
    out[i + 1] = arr[i + 1]  // y unchanged (vertical)
    out[i + 2] = arr[i]      // new z = old x
  }
  return out
}

export function parsePlateJSON(json: unknown): PlateGeometry {
  const d = (json ?? {}) as RawPlateJSON
  const rawBounds = d.bounds ?? { minX: -0.3, maxX: 0.3, minZ: -0.3, maxZ: 0.3 }
  return {
    bodyEdges: rotatePlateVerticesCW(base64ToFloat32Array(d.edges ?? '')),
    footEdges: rotatePlateVerticesCW(base64ToFloat32Array(d.footEdges ?? '')),
    topPlateEdges: rotatePlateVerticesCW(base64ToFloat32Array(d.topPlateEdges ?? '')),
    faces: rotatePlateVerticesCW(base64ToFloat32Array(d.faces ?? '')),
    floorY: d.floorY ?? 0,
    // Rotate bounds to match: new_x = -old_z, new_z = old_x
    bounds: {
      minX: -rawBounds.maxZ,
      maxX: -rawBounds.minZ,
      minZ: rawBounds.minX,
      maxZ: rawBounds.maxX,
    },
  }
}

/**
 * Split top-plate edges into upper (above midY) and lower halves.
 * Lower edges render behind the plate fill (opaque). Upper edges
 * render in front. Mixed-Y edges default to upper.
 */
export function splitEdgesByY(
  edges: EdgeSegments | null,
): { upper: EdgeSegments | null; lower: EdgeSegments | null } {
  if (!edges || edges.length < 6) return { upper: null, lower: null }
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 1; i < edges.length; i += 3) {
    if (edges[i] < minY) minY = edges[i]
    if (edges[i] > maxY) maxY = edges[i]
  }
  const midY = (minY + maxY) / 2
  const up: number[] = []
  const lo: number[] = []
  for (let i = 0; i < edges.length; i += 6) {
    const y1 = edges[i + 1]
    const y2 = edges[i + 4]
    const target =
      y1 >= midY && y2 >= midY
        ? up
        : y1 <= midY && y2 <= midY
          ? lo
          : up // mixed edges → upper
    for (let j = 0; j < 6; j++) target.push(edges[i + j])
  }
  return {
    upper: up.length ? new Float32Array(up) : null,
    lower: lo.length ? new Float32Array(lo) : null,
  }
}
