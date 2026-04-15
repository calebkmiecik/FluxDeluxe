/**
 * Cell raycaster — maps plate-local XZ hit points to canonical cell
 * coordinates and back. Reuses `plateGeometry.ts` helpers for all
 * rotation/device-mapping logic; this module only handles the
 * XZ ↔ display-cell arithmetic.
 *
 * Coordinate convention (plate-local XZ):
 *   minX, minZ → display cell (0, 0)
 *   Increasing X → increasing displayCol
 *   Increasing Z → increasing displayRow
 *
 * (World and plate-local XZ are identical when the plate mesh has
 * zero rotation. For rotated meshes, callers transform the hit point
 * into plate-local space before calling here.)
 */

import {
  mapCellForDevice,
  mapCellForRotation,
  invertRotation,
  invertDeviceMapping,
} from '../../../lib/plateGeometry'
import { GRID_DIMS } from '../../../lib/types'

export interface Bounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export function hitPointToCanonicalCell(
  x: number,
  z: number,
  deviceType: string,
  rotation: number,
  bounds: Bounds,
): [number, number] | null {
  if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) {
    return null
  }
  const grid = GRID_DIMS[deviceType] ?? { rows: 3, cols: 3 }
  const rotated = rotation % 2 === 1
  const displayRows = rotated ? grid.cols : grid.rows
  const displayCols = rotated ? grid.rows : grid.cols

  const u = (x - bounds.minX) / (bounds.maxX - bounds.minX)
  const v = (z - bounds.minZ) / (bounds.maxZ - bounds.minZ)
  const dispC = Math.min(displayCols - 1, Math.max(0, Math.floor(u * displayCols)))
  const dispR = Math.min(displayRows - 1, Math.max(0, Math.floor(v * displayRows)))

  const [invR, invC] = invertRotation(dispR, dispC, grid.rows, grid.cols, rotation)
  const [canonR, canonC] = invertDeviceMapping(invR, invC, grid.rows, grid.cols, deviceType)
  return [canonR, canonC]
}

/**
 * Forward transform: canonical cell → plate-local world XZ at cell center.
 * Used by cell-overlay rendering to position colored meshes and projected
 * text labels.
 */
export function canonicalCellToWorldXZ(
  canonR: number,
  canonC: number,
  deviceType: string,
  rotation: number,
  bounds: Bounds,
): { x: number; z: number } {
  const grid = GRID_DIMS[deviceType] ?? { rows: 3, cols: 3 }
  const rotated = rotation % 2 === 1
  const displayRows = rotated ? grid.cols : grid.rows
  const displayCols = rotated ? grid.rows : grid.cols

  const [dr, dc] = mapCellForDevice(canonR, canonC, grid.rows, grid.cols, deviceType)
  const [dispR, dispC] = mapCellForRotation(dr, dc, grid.rows, grid.cols, rotation)

  const cellW = (bounds.maxX - bounds.minX) / displayCols
  const cellH = (bounds.maxZ - bounds.minZ) / displayRows
  const x = bounds.minX + (dispC + 0.5) * cellW
  const z = bounds.minZ + (dispR + 0.5) * cellH
  return { x, z }
}

/**
 * Plate-local rect of a canonical cell (used when sizing overlay meshes
 * or outline rings).
 */
export function canonicalCellRect(
  canonR: number,
  canonC: number,
  deviceType: string,
  rotation: number,
  bounds: Bounds,
): { x: number; z: number; w: number; h: number } {
  const grid = GRID_DIMS[deviceType] ?? { rows: 3, cols: 3 }
  const rotated = rotation % 2 === 1
  const displayRows = rotated ? grid.cols : grid.rows
  const displayCols = rotated ? grid.rows : grid.cols

  const [dr, dc] = mapCellForDevice(canonR, canonC, grid.rows, grid.cols, deviceType)
  const [dispR, dispC] = mapCellForRotation(dr, dc, grid.rows, grid.cols, rotation)

  const w = (bounds.maxX - bounds.minX) / displayCols
  const h = (bounds.maxZ - bounds.minZ) / displayRows
  return {
    x: bounds.minX + dispC * w,
    z: bounds.minZ + dispR * h,
    w,
    h,
  }
}
