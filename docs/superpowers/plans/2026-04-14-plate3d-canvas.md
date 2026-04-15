# Plate 3D Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 2D `PlateCanvas` component with a 3D Three.js drop-in: ortho top-down default, first-mount intro swoop, drag-to-peek orbit with snap-back, animated rotate, Tesla-leaning hybrid aesthetic.

**Architecture:** Port the production renderer's three-canvas compositing pattern (2D-below / WebGL / 2D-above) into a new `src/components/canvas/plate3d/` module. Extend it with a camera state machine, cell-level overlays (colors + labels + amber active ring), and click raycasting. Reuse the existing `plateGeometry.ts` helpers verbatim so coordinate transforms stay single-sourced.

**Tech Stack:** React 19, TypeScript, Three.js (new dep), Vitest + jsdom, existing `lib/theme.ts` + `lib/plateGeometry.ts`.

**Spec:** `docs/superpowers/specs/2026-04-14-plate3d-canvas-design.md`

**Branch:** `electron` (user explicitly chose this; no worktree).

---

## Pre-task prerequisite: obtain plate JSON assets

Before Task 9 (PlateCanvas shell integration), the three plate JSON files must exist at:

- `src/components/canvas/plate3d/assets/plate-lite.json`
- `src/components/canvas/plate3d/assets/plate-launchpad.json`
- `src/components/canvas/plate3d/assets/plate-xl.json`

Source (as noted by user): `C:\Users\Caleb\Documents\Axioforce\AxioforceFlux3\src\renderer\assets\models\extracted\*.json`. Confirm the user has copied them before Task 9. Tasks 1-8 do not require the real JSONs — they use a synthetic fixture defined in Task 4.

If the files exist but are malformed, the component's error handling (§11 in spec) will catch it. If they're missing entirely, the component falls back to a "3D view unavailable" panel but nothing else breaks.

---

## File structure

```
src/
  components/canvas/
    PlateCanvas.tsx                    ← DELETE (task 10)
    plate3d/
      PlateCanvas.tsx                  ← NEW (task 9)
      PlateScene.ts                    ← NEW (task 7)
      plateModelCache.ts               ← NEW (task 4)
      cameraController.ts              ← NEW (task 6)
      cellOverlay.ts                   ← NEW (task 8)
      cellRaycaster.ts                 ← NEW (task 5)
      constants.ts                     ← NEW (task 3)
      assets/
        plate-lite.json                ← user-provided (pre-task)
        plate-launchpad.json           ← user-provided
        plate-xl.json                  ← user-provided
  lib/
    theme.ts                           ← MODIFY (task 2, add plate3d block)
  pages/fluxlite/
    LiveView.tsx                       ← MODIFY (task 10, import path + liveTesting)
    FluxLitePage.tsx                   ← MODIFY (task 10, same)
  __tests__/
    plate3d/
      plateModelCache.test.ts          ← NEW (task 4)
      cellRaycaster.test.ts            ← NEW (task 5)
      cameraController.test.ts         ← NEW (task 6)
      cellOverlay.test.ts              ← NEW (task 8)
```

Each source file has a single responsibility; no file should grow past ~300 lines (split if it does).

---

## Task 1: Add three.js dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install three + types**

Run:

```bash
cd c:/Users/Caleb/Documents/Axioforce/FluxDeluxe
npm install three@^0.167.0
npm install -D @types/three
```

Expected: both packages appear in `package.json` (`three` in `dependencies`, `@types/three` in `devDependencies`), `package-lock.json` updates.

- [ ] **Step 2: Verify TypeScript accepts the import**

Create a scratch file to confirm types resolve, then delete it:

```bash
echo "import * as THREE from 'three'; console.log(THREE.REVISION);" > /tmp/scratch.ts
npx tsc --noEmit /tmp/scratch.ts
rm /tmp/scratch.ts
```

Expected: no errors. If errors appear, `@types/three` version mismatch — pin to a compatible version.

- [ ] **Step 3: Verify existing tests still pass**

Run: `npm test`
Expected: all existing tests pass (three.js should not affect them).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add three.js dependency for 3D plate canvas"
```

---

## Task 2: Extend theme with plate3d tokens

**Files:**
- Modify: `src/lib/theme.ts` (append new `plate3d` block after existing `canvas` block, line ~89)

- [ ] **Step 1: Add plate3d color block**

Append to `src/lib/theme.ts` at the end of the `colors` const (before the closing `} as const`), ONE new key:

```ts
  // 3D plate canvas
  plate3dFloorGrid: '#3A4556',
  plate3dPlateFill: '#1C2638',
  plate3dEdgeCyan: '#7AB8FF',
  plate3dActiveAmber: '#FFC107', // alias for warning, used only for active cell
```

Then append a new exported `plate3d` const after the `canvas` const (~line 89):

```ts
// ── Plate 3D Canvas Drawing Helpers ─────────────────────────────────
export const plate3d = {
  bg: colors.canvasBg,
  floorGrid: colors.plate3dFloorGrid,
  plateFill: colors.plate3dPlateFill,
  plateFillOpacity: 0.92,
  edgeCyan: colors.plate3dEdgeCyan,
  activeAmber: colors.plate3dActiveAmber,
  cellFillOpacity: 0.55, // multiplier applied to COLOR_BIN_RGBA alpha
  hudTextColor: colors.textMuted,
  hudMonoFont: fonts.mono,
} as const
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `npm test`
Expected: all pass. This is an additive change, no existing imports affected.

- [ ] **Step 3: Commit**

```bash
git add src/lib/theme.ts
git commit -m "feat(theme): add plate3d color tokens and canvas helpers"
```

---

## Task 3: Create plate3d/constants.ts

**Files:**
- Create: `src/components/canvas/plate3d/constants.ts`

- [ ] **Step 1: Create directory and file**

```bash
mkdir -p src/components/canvas/plate3d/assets
```

Create `src/components/canvas/plate3d/constants.ts`:

```ts
/**
 * Plate 3D canvas constants — device→JSON routing, animation timings,
 * and easing curves. All timings in milliseconds.
 */

// ── Device type → plate JSON file key ──────────────────────────────
// Note: JSON files are imported lazily in PlateCanvas.tsx to keep
// this module tree-shakable for unit tests that don't need WebGL.
export type PlateModelKey = 'lite' | 'launchpad' | 'xl'

export const DEVICE_TO_PLATE_MODEL: Record<string, PlateModelKey> = {
  '06': 'lite',
  '10': 'lite',
  '07': 'launchpad',
  '11': 'launchpad',
  '08': 'xl',
  '12': 'xl',
}

export const DEFAULT_PLATE_MODEL: PlateModelKey = 'launchpad'

// ── Animation timings ──────────────────────────────────────────────
export const INTRO_SWOOP_MS = 1200
export const ROTATE_ANIMATE_MS = 500
export const PEEK_RETURN_MS = 400
export const HUD_FADE_MS = 200
export const ACTIVE_PULSE_MS = 1600 // full sine period

// ── Camera pose constants ──────────────────────────────────────────
export const INTRO_START_AZIMUTH = 1.110
export const INTRO_START_ELEVATION = 0.510
export const INTRO_DISTANCE_MULT = 1.25
export const FIT_DISTANCE_MULT = 1.15
export const MIN_PEEK_ELEVATION = 0.15
export const MAX_ELEVATION = Math.PI / 2
export const WHEEL_ZOOM_CLAMP = 0.15 // ±15% of fit distance

// ── Click/drag disambiguation ──────────────────────────────────────
export const CLICK_MAX_PX = 3
export const CLICK_MAX_MS = 200

// ── Easing helpers (duration in [0..1]) ────────────────────────────
export const easing = {
  linear: (t: number) => t,
  cubicInOut: (t: number) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  cubicOut: (t: number) => 1 - Math.pow(1 - t, 3),
  quadOut: (t: number) => 1 - (1 - t) * (1 - t),
}

// ── HUD chrome sizing ──────────────────────────────────────────────
export const HUD_READOUT_HEIGHT = 28
export const HUD_BRACKET_LENGTH = 16
export const HUD_BRACKET_STROKE = 1
export const HUD_FONT_PX = 12
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/canvas/plate3d/constants.ts
git commit -m "feat(plate3d): add constants module (timings, easings, device routing)"
```

---

## Task 4: plateModelCache.ts with TDD

**Files:**
- Create: `src/components/canvas/plate3d/plateModelCache.ts`
- Test: `src/__tests__/plate3d/plateModelCache.test.ts`

- [ ] **Step 1: Write failing tests first**

Create `src/__tests__/plate3d/plateModelCache.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/plate3d/plateModelCache.test.ts`
Expected: FAIL — "Cannot find module".

- [ ] **Step 3: Implement plateModelCache.ts**

Create `src/components/canvas/plate3d/plateModelCache.ts`:

```ts
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
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Float32Array(bytes.buffer)
}

export function parsePlateJSON(json: unknown): PlateGeometry {
  const d = (json ?? {}) as RawPlateJSON
  return {
    bodyEdges: base64ToFloat32Array(d.edges ?? ''),
    footEdges: base64ToFloat32Array(d.footEdges ?? ''),
    topPlateEdges: base64ToFloat32Array(d.topPlateEdges ?? ''),
    faces: base64ToFloat32Array(d.faces ?? ''),
    floorY: d.floorY ?? 0,
    bounds: d.bounds ?? { minX: -0.3, maxX: 0.3, minZ: -0.3, maxZ: 0.3 },
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/plate3d/plateModelCache.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/canvas/plate3d/plateModelCache.ts src/__tests__/plate3d/plateModelCache.test.ts
git commit -m "feat(plate3d): add plateModelCache with base64 + edge-split (TDD)"
```

---

## Task 5: cellRaycaster.ts with TDD

**Files:**
- Create: `src/components/canvas/plate3d/cellRaycaster.ts`
- Test: `src/__tests__/plate3d/cellRaycaster.test.ts`

Spec reference: §7 (click resolution pipeline). Reuses `mapCellForDevice`, `mapCellForRotation`, `invertRotation`, `invertDeviceMapping` from `src/lib/plateGeometry.ts`.

- [ ] **Step 1: Write failing tests first**

Create `src/__tests__/plate3d/cellRaycaster.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/plate3d/cellRaycaster.test.ts`
Expected: FAIL — "Cannot find module".

- [ ] **Step 3: Implement cellRaycaster.ts**

Create `src/components/canvas/plate3d/cellRaycaster.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/plate3d/cellRaycaster.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/canvas/plate3d/cellRaycaster.ts src/__tests__/plate3d/cellRaycaster.test.ts
git commit -m "feat(plate3d): add cellRaycaster with canonical↔XZ round-trip (TDD)"
```

---

## Task 6: cameraController.ts with TDD

**Files:**
- Create: `src/components/canvas/plate3d/cameraController.ts`
- Test: `src/__tests__/plate3d/cameraController.test.ts`

Spec reference: §6 (camera state machine) and §6.5 (live-testing hard lock).

- [ ] **Step 1: Write failing tests first**

Create `src/__tests__/plate3d/cameraController.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { CameraController, resetIntroSwoopForTesting } from '../../components/canvas/plate3d/cameraController'

function makeController() {
  return new CameraController({ fitDistance: 1.0 })
}

describe('CameraController — intro swoop', () => {
  beforeEach(() => resetIntroSwoopForTesting())

  it('first instance enters INTRO_SWOOP state', () => {
    const c = makeController()
    expect(c.state).toBe('INTRO_SWOOP')
  })

  it('second instance in same session skips swoop → ORTHO_LOCKED', () => {
    makeController().update(10000) // first instance completes swoop
    const c2 = makeController()
    expect(c2.state).toBe('ORTHO_LOCKED')
  })

  it('completes after INTRO_SWOOP_MS', () => {
    const c = makeController()
    c.update(1200) // INTRO_SWOOP_MS
    expect(c.state).toBe('ORTHO_LOCKED')
  })

  it('pose at t=0 is perspective intro pose', () => {
    const c = makeController()
    const p = c.getPose()
    expect(p.ortho).toBe(false)
    expect(p.elevation).toBeCloseTo(0.510, 2)
  })

  it('pose at t=INTRO_SWOOP_MS is ortho top', () => {
    const c = makeController()
    c.update(1200)
    const p = c.getPose()
    expect(p.ortho).toBe(true)
    expect(p.elevation).toBeCloseTo(Math.PI / 2, 2)
  })
})

describe('CameraController — drag engagement', () => {
  beforeEach(() => resetIntroSwoopForTesting())

  it('drag engages PEEK_ORBIT from ORTHO_LOCKED', () => {
    const c = makeController()
    c.update(1200) // finish swoop
    c.beginDrag()
    expect(c.state).toBe('PEEK_ORBIT')
  })

  it('drag during liveTesting=true is ignored', () => {
    const c = makeController()
    c.update(1200)
    c.setLiveTesting(true)
    c.beginDrag()
    expect(c.state).toBe('ORTHO_LOCKED')
  })

  it('liveTesting transition false→true during PEEK triggers snap-back', () => {
    const c = makeController()
    c.update(1200)
    c.beginDrag()
    expect(c.state).toBe('PEEK_ORBIT')
    c.setLiveTesting(true)
    expect(c.state).toBe('PEEK_RETURN')
    c.update(400) // PEEK_RETURN_MS
    expect(c.state).toBe('ORTHO_LOCKED')
  })

  it('dismissPeek from PEEK_ORBIT transitions to PEEK_RETURN', () => {
    const c = makeController()
    c.update(1200)
    c.beginDrag()
    c.dismissPeek()
    expect(c.state).toBe('PEEK_RETURN')
  })
})

describe('CameraController — rotation', () => {
  beforeEach(() => resetIntroSwoopForTesting())

  it('meshRotation starts at rotation * π/2 (no animation on initial set)', () => {
    const c = makeController()
    c.update(1200)
    c.setRotation(2) // 180°
    expect(c.getMeshRotation()).toBeCloseTo(Math.PI, 3)
  })

  it('rotation change triggers ROTATE_ANIMATE', () => {
    const c = makeController()
    c.update(1200)
    c.setRotation(0) // initial
    c.setRotation(1) // change
    expect(c.state).toBe('ROTATE_ANIMATE')
  })

  it('ROTATE_ANIMATE completes after ROTATE_ANIMATE_MS', () => {
    const c = makeController()
    c.update(1200)
    c.setRotation(0)
    c.setRotation(1)
    c.update(500) // ROTATE_ANIMATE_MS
    expect(c.state).toBe('ORTHO_LOCKED')
    expect(c.getMeshRotation()).toBeCloseTo(Math.PI / 2, 3)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/plate3d/cameraController.test.ts`
Expected: FAIL — "Cannot find module".

- [ ] **Step 3: Implement cameraController.ts**

Create `src/components/canvas/plate3d/cameraController.ts`:

```ts
/**
 * Camera state machine for the 3D plate canvas.
 *
 * States:
 *   INTRO_SWOOP    — 1.2s perspective→ortho landing on first mount per session
 *   ORTHO_LOCKED   — resting top-down ortho (default interactive state)
 *   PEEK_ORBIT    — user-dragged perspective (clamped elevation)
 *   PEEK_RETURN    — 0.4s eased return to ortho top
 *   ROTATE_ANIMATE — 0.5s plate mesh spin (camera stays put)
 *
 * This module is pure state + time — it does NOT touch three.js.
 * The React component feeds it deltaTime each frame and reads the
 * resulting pose + meshRotation to drive the scene.
 */

import {
  INTRO_SWOOP_MS,
  ROTATE_ANIMATE_MS,
  PEEK_RETURN_MS,
  INTRO_START_AZIMUTH,
  INTRO_START_ELEVATION,
  INTRO_DISTANCE_MULT,
  MIN_PEEK_ELEVATION,
  MAX_ELEVATION,
  easing,
} from './constants'

export type CameraState =
  | 'INTRO_SWOOP'
  | 'ORTHO_LOCKED'
  | 'PEEK_ORBIT'
  | 'PEEK_RETURN'
  | 'ROTATE_ANIMATE'

export interface CameraPose {
  azimuth: number
  elevation: number
  distance: number
  ortho: boolean
}

export interface CameraControllerOptions {
  fitDistance: number // world-space distance to keep plate comfortably framed
}

// Module-level flag — INTRO_SWOOP plays at most once per process lifetime.
let _introPlayedThisSession = false

export function resetIntroSwoopForTesting() {
  _introPlayedThisSession = false
}

const CLAMP = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

export class CameraController {
  state: CameraState
  private fitDistance: number
  private pose: CameraPose
  private meshRotation = 0 // radians, around Y
  private rotationQuadrant: number | null = null // last-known rotation prop
  private liveTesting = false

  // Animation state (valid only when state is a *_ANIMATE / *_SWOOP / *_RETURN)
  private animStart = 0
  private animDuration = 0
  private animFromPose: CameraPose | null = null
  private animToPose: CameraPose | null = null
  private animFromRotation = 0
  private animToRotation = 0

  private elapsedMs = 0

  constructor(opts: CameraControllerOptions) {
    this.fitDistance = opts.fitDistance
    if (_introPlayedThisSession) {
      this.state = 'ORTHO_LOCKED'
      this.pose = this.orthoTop()
    } else {
      this.state = 'INTRO_SWOOP'
      this.pose = this.introStartPose()
      this.animStart = 0
      this.animDuration = INTRO_SWOOP_MS
      this.animFromPose = { ...this.pose }
      this.animToPose = this.orthoTop()
      _introPlayedThisSession = true
    }
  }

  private introStartPose(): CameraPose {
    return {
      azimuth: INTRO_START_AZIMUTH,
      elevation: INTRO_START_ELEVATION,
      distance: this.fitDistance * INTRO_DISTANCE_MULT,
      ortho: false,
    }
  }

  private orthoTop(): CameraPose {
    return {
      azimuth: 0,
      elevation: MAX_ELEVATION,
      distance: this.fitDistance,
      ortho: true,
    }
  }

  /** Feed elapsed ms since last call. Advances animations. */
  update(deltaMs: number) {
    this.elapsedMs += deltaMs

    if (this.state === 'INTRO_SWOOP') {
      this.progressAnim((t) => {
        const e = easing.cubicInOut(t)
        this.pose = this.lerpPose(this.animFromPose!, this.animToPose!, e)
        // Cross from perspective to ortho near end (binary switch at t=0.85)
        this.pose.ortho = t >= 0.85
      }, () => {
        this.state = 'ORTHO_LOCKED'
        this.pose = this.orthoTop()
      })
    } else if (this.state === 'PEEK_RETURN') {
      this.progressAnim((t) => {
        const e = easing.cubicOut(t)
        this.pose = this.lerpPose(this.animFromPose!, this.animToPose!, e)
        this.pose.ortho = t >= 0.9
      }, () => {
        this.state = 'ORTHO_LOCKED'
        this.pose = this.orthoTop()
      })
    } else if (this.state === 'ROTATE_ANIMATE') {
      this.progressAnim((t) => {
        const e = easing.cubicOut(t)
        this.meshRotation = this.animFromRotation + (this.animToRotation - this.animFromRotation) * e
      }, () => {
        this.state = 'ORTHO_LOCKED'
        this.meshRotation = this.animToRotation
      })
    }
  }

  private progressAnim(onTick: (t: number) => void, onComplete: () => void) {
    const t = CLAMP((this.elapsedMs - this.animStart) / this.animDuration, 0, 1)
    onTick(t)
    if (t >= 1) onComplete()
  }

  private lerpPose(a: CameraPose, b: CameraPose, t: number): CameraPose {
    return {
      azimuth: a.azimuth + (b.azimuth - a.azimuth) * t,
      elevation: a.elevation + (b.elevation - a.elevation) * t,
      distance: a.distance + (b.distance - a.distance) * t,
      ortho: a.ortho, // overridden per-state
    }
  }

  beginDrag() {
    if (this.liveTesting) return
    if (this.state !== 'ORTHO_LOCKED' && this.state !== 'PEEK_ORBIT') return
    this.state = 'PEEK_ORBIT'
    this.pose.ortho = false
  }

  /** Called while dragging. dx/dy are raw pixel deltas. */
  applyDrag(dx: number, dy: number) {
    if (this.state !== 'PEEK_ORBIT') return
    this.pose.azimuth -= dx * 0.005
    this.pose.elevation = CLAMP(this.pose.elevation + dy * 0.005, MIN_PEEK_ELEVATION, MAX_ELEVATION)
  }

  dismissPeek() {
    if (this.state !== 'PEEK_ORBIT') return
    this.beginReturnToOrtho()
  }

  private beginReturnToOrtho() {
    this.animStart = this.elapsedMs
    this.animDuration = PEEK_RETURN_MS
    this.animFromPose = { ...this.pose }
    this.animToPose = this.orthoTop()
    this.state = 'PEEK_RETURN'
  }

  setLiveTesting(v: boolean) {
    const wasOff = !this.liveTesting
    this.liveTesting = v
    if (wasOff && v && this.state === 'PEEK_ORBIT') {
      this.beginReturnToOrtho()
    }
  }

  /** Set rotation quadrant (0-3). First call is initial, no animation. */
  setRotation(quadrant: number) {
    const targetRad = quadrant * (Math.PI / 2)
    if (this.rotationQuadrant === null) {
      this.rotationQuadrant = quadrant
      this.meshRotation = targetRad
      return
    }
    if (this.rotationQuadrant === quadrant) return
    this.rotationQuadrant = quadrant
    this.animStart = this.elapsedMs
    this.animDuration = ROTATE_ANIMATE_MS
    this.animFromRotation = this.meshRotation
    this.animToRotation = targetRad
    this.state = 'ROTATE_ANIMATE'
  }

  getPose(): CameraPose {
    return { ...this.pose }
  }

  getMeshRotation(): number {
    return this.meshRotation
  }

  isInteractive(): boolean {
    return this.state === 'ORTHO_LOCKED' || this.state === 'PEEK_ORBIT'
  }

  applyWheelZoom(deltaY: number) {
    // Clamp is applied by the caller against fit distance limits
    this.pose.distance += deltaY * 0.001
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/plate3d/cameraController.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/canvas/plate3d/cameraController.ts src/__tests__/plate3d/cameraController.test.ts
git commit -m "feat(plate3d): add cameraController state machine (TDD)"
```

---

## Task 7: PlateScene.ts (ported with extensions)

**Files:**
- Create: `src/components/canvas/plate3d/PlateScene.ts`

This is a port of the production renderer with new methods for cell-fill meshes and the active-cell ring. WebGL code isn't unit-testable in jsdom; correctness is verified by manual/visual acceptance in Task 11.

Spec reference: §5 (rendering composition), §11 (renderer lifecycle gotcha).

- [ ] **Step 1: Create PlateScene.ts**

Create `src/components/canvas/plate3d/PlateScene.ts`:

```ts
/**
 * WebGL scene wrapper for the 3D plate canvas.
 *
 * Owns: renderer, scene, camera, plate fill mesh, cell fill meshes,
 * active-cell ring, raycast hit plane.
 *
 * Critical lifecycle note (production gotcha):
 *   We never call renderer.dispose(). It invokes WEBGL_lose_context
 *   .loseContext() which Chromium counts toward a ~3-loss limit per
 *   page; after that, new WebGL contexts are permanently blocked.
 *   Instead we cache renderers in a WeakMap keyed by canvas element
 *   so the GL context is reclaimed naturally on GC.
 */

import * as THREE from 'three'
import { plate3d } from '../../../lib/theme'

const _rendererCache = new WeakMap<HTMLCanvasElement, THREE.WebGLRenderer>()
function getOrCreateRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  let r = _rendererCache.get(canvas)
  if (r) return r
  r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
  r.setClearColor(0x000000, 0)
  _rendererCache.set(canvas, r)
  return r
}

// ── Shared WebGL readiness probe ──────────────────────────────────
// Electron sometimes needs a beat before getContext succeeds.
let _webglReady: Promise<void> | null = null
export function waitForWebGL(): Promise<void> {
  if (_webglReady) return _webglReady
  _webglReady = new Promise<void>((resolve) => {
    const probe = document.createElement('canvas')
    probe.width = probe.height = 1
    let attempt = 0
    const check = () => {
      const gl = probe.getContext('webgl2') || probe.getContext('webgl')
      if (gl) { resolve(); return }
      const delay = attempt < 4 ? 250 * 2 ** attempt : 5000
      setTimeout(check, delay)
      attempt++
    }
    check()
  })
  return _webglReady
}

export interface PlateSceneOptions {
  canvas: HTMLCanvasElement
}

const _tgt = new THREE.Vector3()
const _eye = new THREE.Vector3()

export class PlateScene {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera =
    new THREE.PerspectiveCamera(45, 1, 0.001, 20)

  /** Group everything plate-local under a pivot so mesh rotation drives the whole plate. */
  private platePivot = new THREE.Group()
  private fillMesh: THREE.Mesh | null = null
  private cellMeshes = new Map<string, THREE.Mesh>() // "canonR,canonC" -> mesh
  private activeRing: THREE.LineLoop | null = null

  constructor(opts: PlateSceneOptions) {
    this.renderer = getOrCreateRenderer(opts.canvas)
    this.scene.add(this.platePivot)
  }

  setSize(w: number, h: number, dpr: number) {
    this.renderer.setSize(w, h, false)
    this.renderer.setPixelRatio(dpr)
  }

  /** Rotate the whole plate group around Y. Driven by cameraController.meshRotation. */
  setMeshRotation(radians: number) {
    this.platePivot.rotation.y = radians
  }

  syncCamera(
    azimuth: number, elevation: number, distance: number,
    target: { x: number; y: number; z: number },
    fov: number, aspect: number, ortho: boolean,
  ) {
    _tgt.set(target.x, target.y, target.z)
    _eye.set(
      distance * Math.cos(elevation) * Math.sin(azimuth),
      distance * Math.sin(elevation),
      distance * Math.cos(elevation) * Math.cos(azimuth),
    ).add(_tgt)

    if (ortho) {
      const halfH = distance * 0.55
      const halfW = halfH * aspect
      if (!(this.camera instanceof THREE.OrthographicCamera)) {
        this.camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.01, 20)
      } else {
        this.camera.left = -halfW; this.camera.right = halfW
        this.camera.top = halfH; this.camera.bottom = -halfH
        this.camera.updateProjectionMatrix()
      }
    } else {
      if (!(this.camera instanceof THREE.PerspectiveCamera)) {
        this.camera = new THREE.PerspectiveCamera(fov, aspect, 0.001, 20)
      } else {
        this.camera.fov = fov; this.camera.aspect = aspect
        this.camera.updateProjectionMatrix()
      }
    }
    this.camera.position.copy(_eye)
    this.camera.lookAt(_tgt)
    this.camera.updateMatrixWorld()
  }

  getCamera(): THREE.Camera {
    return this.camera
  }

  /** Rebuild plate fill mesh from decoded faces. Called when plate JSON changes. */
  buildPlateFill(faces: Float32Array | null) {
    this.clearPlateFill()
    if (!faces || faces.length < 9) return
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(faces), 3))
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(plate3d.plateFill),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: plate3d.plateFillOpacity,
      depthTest: true,
      depthWrite: true,
    })
    const mesh = new THREE.Mesh(geo, mat)
    this.platePivot.add(mesh)
    this.fillMesh = mesh
  }

  /**
   * Create / update a flat colored quad for one canonical cell.
   * `rect` is in plate-local XZ; `topY` places the quad just above the plate top.
   */
  setCellFill(
    key: string,
    rect: { x: number; z: number; w: number; h: number },
    topY: number,
    colorRgba: [number, number, number, number],
  ) {
    let mesh = this.cellMeshes.get(key)
    if (!mesh) {
      const geo = new THREE.PlaneGeometry(1, 1)
      const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })
      mesh = new THREE.Mesh(geo, mat)
      mesh.rotation.x = -Math.PI / 2 // flat, facing up
      this.platePivot.add(mesh)
      this.cellMeshes.set(key, mesh)
    }
    mesh.position.set(rect.x + rect.w / 2, topY + 0.0005, rect.z + rect.h / 2)
    mesh.scale.set(rect.w, rect.h, 1)
    const mat = mesh.material as THREE.MeshBasicMaterial
    mat.color.setRGB(colorRgba[0] / 255, colorRgba[1] / 255, colorRgba[2] / 255)
    mat.opacity = (colorRgba[3] / 255) * plate3d.cellFillOpacity
  }

  removeCellFill(key: string) {
    const mesh = this.cellMeshes.get(key)
    if (!mesh) return
    this.platePivot.remove(mesh)
    mesh.geometry.dispose()
    ;(mesh.material as THREE.Material).dispose()
    this.cellMeshes.delete(key)
  }

  clearAllCellFills() {
    for (const key of Array.from(this.cellMeshes.keys())) this.removeCellFill(key)
  }

  /** Active cell amber outline ring, co-planar with plate top (slight offset). */
  setActiveRing(
    rect: { x: number; z: number; w: number; h: number } | null,
    topY: number,
    opacity = 1,
  ) {
    if (!rect) {
      if (this.activeRing) {
        this.platePivot.remove(this.activeRing)
        this.activeRing.geometry.dispose()
        ;(this.activeRing.material as THREE.Material).dispose()
        this.activeRing = null
      }
      return
    }
    if (!this.activeRing) {
      const geo = new THREE.BufferGeometry()
      const mat = new THREE.LineBasicMaterial({
        color: new THREE.Color(plate3d.activeAmber),
        transparent: true,
        depthTest: false,
      })
      this.activeRing = new THREE.LineLoop(geo, mat)
      this.platePivot.add(this.activeRing)
    }
    const inset = 0.003
    const x1 = rect.x + inset
    const x2 = rect.x + rect.w - inset
    const z1 = rect.z + inset
    const z2 = rect.z + rect.h - inset
    const y = topY + 0.0008
    const verts = new Float32Array([
      x1, y, z1,
      x2, y, z1,
      x2, y, z2,
      x1, y, z2,
    ])
    const geo = this.activeRing.geometry
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
    geo.attributes.position.needsUpdate = true
    ;(this.activeRing.material as THREE.LineBasicMaterial).opacity = opacity
  }

  render() {
    this.renderer.render(this.scene, this.camera)
  }

  /** Renderer intentionally NOT disposed — see file header. */
  dispose() {
    this.clearPlateFill()
    this.clearAllCellFills()
    this.setActiveRing(null, 0)
  }

  private clearPlateFill() {
    if (this.fillMesh) {
      this.platePivot.remove(this.fillMesh)
      this.fillMesh.geometry.dispose()
      ;(this.fillMesh.material as THREE.Material).dispose()
      this.fillMesh = null
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify existing tests still pass**

Run: `npm test`
Expected: all pass (PlateScene has no tests yet; we rely on manual acceptance in Task 11).

- [ ] **Step 4: Commit**

```bash
git add src/components/canvas/plate3d/PlateScene.ts
git commit -m "feat(plate3d): add PlateScene with cell fills and active ring"
```

---

## Task 8: cellOverlay.ts — HUD chrome + projected text

**Files:**
- Create: `src/components/canvas/plate3d/cellOverlay.ts`
- Test: `src/__tests__/plate3d/cellOverlay.test.ts`

Spec reference: §5 (z=0 and z=2 composition), §8.3 (HUD chrome).

- [ ] **Step 1: Write failing tests for projection math**

Create `src/__tests__/plate3d/cellOverlay.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/plate3d/cellOverlay.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement cellOverlay.ts**

Create `src/components/canvas/plate3d/cellOverlay.ts`:

```ts
/**
 * 2D HUD overlay drawing for the plate canvas.
 *
 * Two draw surfaces:
 *   z=0 canvas — background, floor grid, below-fill wireframes
 *   z=2 canvas — above-fill wireframes, projected cell text labels,
 *                HUD chrome (corner brackets, bottom readout, reticle)
 *
 * This module contains only the HUD chrome + projected text drawing.
 * Wireframe passes remain inline in PlateCanvas (they share projection
 * state with the scene).
 */

import * as THREE from 'three'
import {
  plate3d,
} from '../../../lib/theme'
import {
  HUD_BRACKET_LENGTH,
  HUD_BRACKET_STROKE,
  HUD_FONT_PX,
  HUD_READOUT_HEIGHT,
} from './constants'

export interface ScreenRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Compute the four L-bracket line-paths for a given screen-space rect.
 * Returned order: top-left, top-right, bottom-right, bottom-left.
 * Each bracket is three points forming an L.
 */
export function computeScreenBracket(
  rect: ScreenRect,
  length = HUD_BRACKET_LENGTH,
): Array<Array<{ x: number; y: number }>> {
  const { x, y, w, h } = rect
  return [
    // top-left
    [{ x, y: y + length }, { x, y }, { x: x + length, y }],
    // top-right
    [{ x: x + w - length, y }, { x: x + w, y }, { x: x + w, y: y + length }],
    // bottom-right
    [{ x: x + w, y: y + h - length }, { x: x + w, y: y + h }, { x: x + w - length, y: y + h }],
    // bottom-left
    [{ x: x + length, y: y + h }, { x, y: y + h }, { x, y: y + h - length }],
  ]
}

export function drawBrackets(
  ctx: CanvasRenderingContext2D,
  rect: ScreenRect,
  opacity: number,
) {
  if (opacity <= 0) return
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.strokeStyle = plate3d.edgeCyan
  ctx.lineWidth = HUD_BRACKET_STROKE
  for (const path of computeScreenBracket(rect)) {
    ctx.beginPath()
    ctx.moveTo(path[0].x, path[0].y)
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y)
    ctx.stroke()
  }
  ctx.restore()
}

export interface ReadoutContent {
  deviceType: string
  widthMm: number
  heightMm: number
  rows: number
  cols: number
  cameraStateLabel: string // e.g. "▲ TOP", "⤴ PEEK", "◌ SWOOP"
  activeCell: { row: number; col: number } | null
}

export function drawBottomReadout(
  ctx: CanvasRenderingContext2D,
  viewportW: number,
  viewportH: number,
  content: ReadoutContent,
) {
  const y = viewportH - HUD_READOUT_HEIGHT
  ctx.save()
  ctx.font = `${HUD_FONT_PX}px ${plate3d.hudMonoFont}`
  ctx.textBaseline = 'middle'
  ctx.fillStyle = plate3d.hudTextColor
  const left = `${content.deviceType} · ${content.widthMm.toFixed(0)}×${content.heightMm.toFixed(0)} mm · ${content.rows}×${content.cols} · ${content.cameraStateLabel}`
  ctx.textAlign = 'left'
  ctx.fillText(left, 12, y + HUD_READOUT_HEIGHT / 2)
  if (content.activeCell) {
    ctx.fillStyle = plate3d.activeAmber
    ctx.textAlign = 'right'
    ctx.fillText(
      `R${content.activeCell.row},C${content.activeCell.col}`,
      viewportW - 12,
      y + HUD_READOUT_HEIGHT / 2,
    )
  }
  ctx.restore()
}

export function drawHoverReticle(
  ctx: CanvasRenderingContext2D,
  center: { x: number; y: number },
  label: string,
) {
  ctx.save()
  ctx.strokeStyle = plate3d.edgeCyan
  ctx.globalAlpha = 0.7
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(center.x - 12, center.y)
  ctx.lineTo(center.x + 12, center.y)
  ctx.moveTo(center.x, center.y - 12)
  ctx.lineTo(center.x, center.y + 12)
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.font = `${HUD_FONT_PX}px ${plate3d.hudMonoFont}`
  ctx.fillStyle = plate3d.hudTextColor
  ctx.textBaseline = 'bottom'
  ctx.textAlign = 'left'
  ctx.fillText(label, center.x + 8, center.y - 8)
  ctx.restore()
}

export function drawCellText(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  text: string,
) {
  ctx.save()
  ctx.font = `bold ${HUD_FONT_PX}px ${plate3d.hudMonoFont}`
  ctx.fillStyle = '#FFFFFF'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, screenX, screenY)
  ctx.restore()
}

/** Project a world-space point to screen coordinates via a three camera. */
export function projectToScreen(
  world: THREE.Vector3,
  camera: THREE.Camera,
  viewportW: number,
  viewportH: number,
): { x: number; y: number; visible: boolean } {
  const p = world.clone().project(camera)
  return {
    x: (p.x * 0.5 + 0.5) * viewportW,
    y: (-p.y * 0.5 + 0.5) * viewportH,
    visible: p.z >= -1 && p.z <= 1,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/plate3d/cellOverlay.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify overall build**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/canvas/plate3d/cellOverlay.ts src/__tests__/plate3d/cellOverlay.test.ts
git commit -m "feat(plate3d): add cellOverlay for HUD chrome + projected text (TDD)"
```

---

## Task 9: PlateCanvas.tsx — the drop-in React shell

**Files:**
- Create: `src/components/canvas/plate3d/PlateCanvas.tsx`

**BEFORE STARTING:** verify the three JSON files exist:

```bash
ls src/components/canvas/plate3d/assets/
```

Expected: `plate-lite.json  plate-launchpad.json  plate-xl.json`. If missing, block and ask the user to copy them from `AxioforceFlux3/src/renderer/assets/models/extracted/`.

Spec reference: §3 (public contract), §3.1 (HUD buttons), §5 (three-canvas layering), §6 (camera state machine integration), §7 (click vs drag), §11 (error handling).

- [ ] **Step 1: Create PlateCanvas.tsx**

Create `src/components/canvas/plate3d/PlateCanvas.tsx`:

```tsx
/**
 * PlateCanvas — drop-in 3D replacement for the 2D plate canvas.
 *
 * Prop contract is identical to the old 2D PlateCanvas, plus one
 * optional `liveTesting` prop (see spec §3, §6.5).
 *
 * This shell file wires together:
 *   - three stacked canvases (z=0 2D / z=1 WebGL / z=2 2D)
 *   - PlateScene (WebGL meshes)
 *   - CameraController (camera state machine)
 *   - cellRaycaster (click → canonical cell)
 *   - cellOverlay (HUD chrome + projected text)
 */

import { useEffect, useRef, useCallback } from 'react'
import * as THREE from 'three'
import { plate3d, colors } from '../../../lib/theme'
import {
  PLATE_DIMENSIONS,
  GRID_DIMS,
  COLOR_BIN_RGBA,
} from '../../../lib/types'
import {
  mapCellForDevice,
  mapCellForRotation,
} from '../../../lib/plateGeometry'
import { PlateScene, waitForWebGL } from './PlateScene'
import {
  parsePlateJSON,
  splitEdgesByY,
  PlateGeometry,
  EdgeSegments,
} from './plateModelCache'
import { CameraController } from './cameraController'
import {
  hitPointToCanonicalCell,
  canonicalCellRect,
  Bounds,
} from './cellRaycaster'
import {
  drawBrackets,
  drawBottomReadout,
  drawCellText,
  drawHoverReticle,
  projectToScreen,
} from './cellOverlay'
import {
  DEVICE_TO_PLATE_MODEL,
  DEFAULT_PLATE_MODEL,
  PlateModelKey,
  CLICK_MAX_MS,
  CLICK_MAX_PX,
  easing,
  ACTIVE_PULSE_MS,
  HUD_FADE_MS,
  WHEEL_ZOOM_CLAMP,
  FIT_DISTANCE_MULT,
} from './constants'

// Static JSON imports — Vite bundles all three into the renderer chunk.
import plateLiteJson from './assets/plate-lite.json'
import plateLaunchpadJson from './assets/plate-launchpad.json'
import plateXlJson from './assets/plate-xl.json'

const PLATE_JSON_BY_KEY: Record<PlateModelKey, unknown> = {
  lite: plateLiteJson,
  launchpad: plateLaunchpadJson,
  xl: plateXlJson,
}

export interface PlateCanvasProps {
  deviceType: string
  rotation: number
  cellColors: Map<string, string>
  cellTexts: Map<string, string>
  activeCell: { row: number; col: number } | null
  onCellClick: (row: number, col: number) => void
  onRotate: () => void
  onTare: () => void
  onRefresh: () => void
  liveTesting?: boolean
}

function resolvePlateJson(deviceType: string): unknown {
  const key = DEVICE_TO_PLATE_MODEL[deviceType]
  if (!key) {
    console.warn(`[plate3d] unknown deviceType "${deviceType}", falling back to ${DEFAULT_PLATE_MODEL}`)
    return PLATE_JSON_BY_KEY[DEFAULT_PLATE_MODEL]
  }
  return PLATE_JSON_BY_KEY[key]
}

function cameraStateLabel(state: string): string {
  if (state === 'INTRO_SWOOP') return '◌ SWOOP'
  if (state === 'PEEK_ORBIT') return '⤴ PEEK'
  if (state === 'PEEK_RETURN') return '↺ RETURN'
  if (state === 'ROTATE_ANIMATE') return '⟳ ROTATE'
  return '▲ TOP'
}

export function PlateCanvas({
  deviceType,
  rotation,
  cellColors,
  cellTexts,
  activeCell,
  onCellClick,
  onRotate,
  onTare,
  onRefresh,
  liveTesting = false,
}: PlateCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const edgeCanvasRef = useRef<HTMLCanvasElement>(null)   // z=0
  const webglCanvasRef = useRef<HTMLCanvasElement>(null)  // z=1
  const canvasRef = useRef<HTMLCanvasElement>(null)       // z=2

  const sceneRef = useRef<PlateScene | null>(null)
  const cameraRef = useRef<CameraController | null>(null)
  const geomRef = useRef<PlateGeometry | null>(null)
  const splitRef = useRef<{ upper: EdgeSegments | null; lower: EdgeSegments | null }>({ upper: null, lower: null })
  const fatalRef = useRef(false)

  const lastFrameRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)

  // Pointer state
  const pointerDownRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const isDraggingRef = useRef(false)
  const hoverCellRef = useRef<{ row: number; col: number; x: number; y: number } | null>(null)

  // HUD fade state
  const bracketOpacityRef = useRef(0)
  const hoverInsideRef = useRef(false)

  // ── Parse plate JSON when deviceType changes ─────────────────────
  useEffect(() => {
    const json = resolvePlateJson(deviceType)
    geomRef.current = parsePlateJSON(json)
    splitRef.current = splitEdgesByY(geomRef.current.topPlateEdges)
    sceneRef.current?.buildPlateFill(geomRef.current.faces)
  }, [deviceType])

  // ── Feed rotation into camera controller ─────────────────────────
  useEffect(() => {
    cameraRef.current?.setRotation(rotation)
  }, [rotation])

  // ── Feed liveTesting into camera controller ──────────────────────
  useEffect(() => {
    cameraRef.current?.setLiveTesting(liveTesting)
  }, [liveTesting])

  // ── Init scene + camera controller ───────────────────────────────
  useEffect(() => {
    const wgl = webglCanvasRef.current
    if (!wgl) return
    let cancelled = false

    waitForWebGL().then(() => {
      if (cancelled) return
      try {
        sceneRef.current = new PlateScene({ canvas: wgl })
        if (geomRef.current) sceneRef.current.buildPlateFill(geomRef.current.faces)
        cameraRef.current = new CameraController({ fitDistance: 1.0 })
        cameraRef.current.setRotation(rotation)
        cameraRef.current.setLiveTesting(liveTesting)
      } catch (err) {
        console.error('[plate3d] scene init failed', err)
        fatalRef.current = true
      }
    }).catch(() => { fatalRef.current = true })

    return () => {
      cancelled = true
      sceneRef.current?.dispose()
      sceneRef.current = null
      cameraRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Resize handling ──────────────────────────────────────────────
  useEffect(() => {
    const c = containerRef.current
    const main = canvasRef.current
    const edge = edgeCanvasRef.current
    if (!c || !main || !edge) return

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = c.getBoundingClientRect()
      for (const cv of [main, edge]) {
        cv.width = rect.width * dpr
        cv.height = rect.height * dpr
        cv.style.width = `${rect.width}px`
        cv.style.height = `${rect.height}px`
        cv.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0)
      }
      sceneRef.current?.setSize(rect.width, rect.height, dpr)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(c)
    return () => ro.disconnect()
  }, [])

  // ── Pointer handling (click vs drag disambiguation) ──────────────
  const getPointerXY = (e: PointerEvent | React.PointerEvent, container: HTMLElement) => {
    const rect = container.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  useEffect(() => {
    const c = containerRef.current
    if (!c) return

    const onDown = (e: PointerEvent) => {
      if (fatalRef.current) return
      const p = getPointerXY(e, c)
      pointerDownRef.current = { x: p.x, y: p.y, t: performance.now() }
      isDraggingRef.current = false
    }
    const onMove = (e: PointerEvent) => {
      if (fatalRef.current) return
      const p = getPointerXY(e, c)
      // Hover tracking (for reticle)
      hoverInsideRef.current = true
      updateHoverCell(p.x, p.y)

      const dp = pointerDownRef.current
      if (!dp) return
      const dx = p.x - dp.x
      const dy = p.y - dp.y
      if (!isDraggingRef.current) {
        if (Math.abs(dx) > CLICK_MAX_PX || Math.abs(dy) > CLICK_MAX_PX) {
          // Engage drag (or reject if liveTesting locked)
          if (!liveTesting) {
            isDraggingRef.current = true
            cameraRef.current?.beginDrag()
          }
        }
      }
      if (isDraggingRef.current) {
        cameraRef.current?.applyDrag(dx, dy)
        pointerDownRef.current = { x: p.x, y: p.y, t: dp.t }
      }
    }
    const onUp = (e: PointerEvent) => {
      if (fatalRef.current) return
      const dp = pointerDownRef.current
      pointerDownRef.current = null
      if (!dp) return
      const p = getPointerXY(e, c)
      const dx = p.x - dp.x
      const dy = p.y - dp.y
      const elapsed = performance.now() - dp.t
      if (
        !isDraggingRef.current &&
        Math.abs(dx) <= CLICK_MAX_PX &&
        Math.abs(dy) <= CLICK_MAX_PX &&
        elapsed <= CLICK_MAX_MS
      ) {
        tryCellClick(p.x, p.y)
      }
      isDraggingRef.current = false
    }
    const onDblClick = () => {
      cameraRef.current?.dismissPeek()
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      cameraRef.current?.applyWheelZoom(e.deltaY)
    }
    const onEnter = () => { hoverInsideRef.current = true }
    const onLeave = () => {
      hoverInsideRef.current = false
      hoverCellRef.current = null
    }

    c.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    c.addEventListener('dblclick', onDblClick)
    c.addEventListener('wheel', onWheel, { passive: false })
    c.addEventListener('pointerenter', onEnter)
    c.addEventListener('pointerleave', onLeave)
    return () => {
      c.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      c.removeEventListener('dblclick', onDblClick)
      c.removeEventListener('wheel', onWheel)
      c.removeEventListener('pointerenter', onEnter)
      c.removeEventListener('pointerleave', onLeave)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveTesting, deviceType, rotation])

  // ── Click → canonical cell ───────────────────────────────────────
  const tryCellClick = useCallback((px: number, py: number) => {
    const scene = sceneRef.current
    const camera = cameraRef.current
    const geom = geomRef.current
    const container = containerRef.current
    if (!scene || !camera || !geom || !container || !camera.isInteractive()) return
    const rect = container.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      (px / rect.width) * 2 - 1,
      -(py / rect.height) * 2 + 1,
    )
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(ndc, scene.getCamera())

    // Build a plane at plate top y, rotated by meshRotation.
    const topY = geom.floorY + 0.05 // approximate plate top; cell-level accuracy is sufficient for raycast
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -topY)
    const hit = new THREE.Vector3()
    if (!raycaster.ray.intersectPlane(plane, hit)) return

    // Rotate hit back into plate-local space
    const rad = -camera.getMeshRotation()
    const cosR = Math.cos(rad), sinR = Math.sin(rad)
    const lx = hit.x * cosR - hit.z * sinR
    const lz = hit.x * sinR + hit.z * cosR

    const cell = hitPointToCanonicalCell(lx, lz, deviceType, rotation, geom.bounds)
    if (cell) onCellClick(cell[0], cell[1])
  }, [deviceType, rotation, onCellClick])

  const updateHoverCell = useCallback((px: number, py: number) => {
    const scene = sceneRef.current
    const camera = cameraRef.current
    const geom = geomRef.current
    const container = containerRef.current
    if (!scene || !camera || !geom || !container) return
    const rect = container.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      (px / rect.width) * 2 - 1,
      -(py / rect.height) * 2 + 1,
    )
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(ndc, scene.getCamera())
    const topY = geom.floorY + 0.05
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -topY)
    const hit = new THREE.Vector3()
    if (!raycaster.ray.intersectPlane(plane, hit)) { hoverCellRef.current = null; return }
    const rad = -camera.getMeshRotation()
    const cosR = Math.cos(rad), sinR = Math.sin(rad)
    const lx = hit.x * cosR - hit.z * sinR
    const lz = hit.x * sinR + hit.z * cosR
    const cell = hitPointToCanonicalCell(lx, lz, deviceType, rotation, geom.bounds)
    if (cell) hoverCellRef.current = { row: cell[0], col: cell[1], x: px, y: py }
    else hoverCellRef.current = null
  }, [deviceType, rotation])

  // ── Render loop ──────────────────────────────────────────────────
  useEffect(() => {
    const v3 = new THREE.Vector3()
    const draw = (now: number) => {
      rafRef.current = requestAnimationFrame(draw)
      if (fatalRef.current) return

      const delta = lastFrameRef.current === null ? 0 : now - lastFrameRef.current
      lastFrameRef.current = now

      const main = canvasRef.current
      const edge = edgeCanvasRef.current
      const scene = sceneRef.current
      const cam = cameraRef.current
      const geom = geomRef.current
      if (!main || !edge || !scene || !cam || !geom) return
      const ctx = main.getContext('2d')
      const eCtx = edge.getContext('2d')
      if (!ctx || !eCtx) return

      cam.update(delta)
      scene.setMeshRotation(cam.getMeshRotation())

      const dpr = window.devicePixelRatio || 1
      const W = main.width / dpr
      const H = main.height / dpr
      const aspect = W / H

      // Background + clear
      ctx.clearRect(0, 0, W, H)
      eCtx.setTransform(1, 0, 0, 1, 0, 0)
      eCtx.fillStyle = plate3d.bg
      eCtx.fillRect(0, 0, edge.width, edge.height)
      eCtx.setTransform(dpr, 0, 0, dpr, 0, 0)

      // Sync camera
      const pose = cam.getPose()
      scene.syncCamera(pose.azimuth, pose.elevation, pose.distance, { x: 0, y: 0, z: 0 }, 45, aspect, pose.ortho)

      // Update cell fills
      scene.clearAllCellFills() // simple rebuild; cell count is small
      const grid = GRID_DIMS[deviceType] ?? { rows: 3, cols: 3 }
      for (const [key, bin] of cellColors.entries()) {
        const [rStr, cStr] = key.split(',')
        const canonR = Number(rStr), canonC = Number(cStr)
        if (isNaN(canonR) || isNaN(canonC)) continue
        const rgba = COLOR_BIN_RGBA[bin]
        if (!rgba) continue
        const rect = canonicalCellRect(canonR, canonC, deviceType, rotation, geom.bounds)
        scene.setCellFill(key, rect, geom.floorY + 0.05, rgba)
      }

      // Active cell ring + pulse
      if (activeCell) {
        const rect = canonicalCellRect(activeCell.row, activeCell.col, deviceType, rotation, geom.bounds)
        const pulse = 0.8 + 0.2 * (0.5 + 0.5 * Math.sin((now / ACTIVE_PULSE_MS) * Math.PI * 2))
        scene.setActiveRing(rect, geom.floorY + 0.05, pulse)
      } else {
        scene.setActiveRing(null, 0)
      }

      scene.render()

      // 2D passes
      const camObj = scene.getCamera()

      // Floor grid on edge canvas
      drawFloorGrid(eCtx, camObj, W, H, geom.floorY, geom.bounds)

      // Wireframes (below + above fill)
      drawEdges(eCtx, camObj, geom.footEdges, 0.3, W, H, cam.getMeshRotation())
      drawEdges(eCtx, camObj, geom.bodyEdges, 0.3, W, H, cam.getMeshRotation())
      drawEdges(eCtx, camObj, splitRef.current.lower, 0.9, W, H, cam.getMeshRotation())
      drawEdges(ctx, camObj, splitRef.current.upper, 0.8, W, H, cam.getMeshRotation())

      // Cell text labels (projected)
      for (const [key, text] of cellTexts.entries()) {
        const [rStr, cStr] = key.split(',')
        const canonR = Number(rStr), canonC = Number(cStr)
        if (isNaN(canonR) || isNaN(canonC)) continue
        const rect = canonicalCellRect(canonR, canonC, deviceType, rotation, geom.bounds)
        const cx = rect.x + rect.w / 2
        const cz = rect.z + rect.h / 2
        const rad = cam.getMeshRotation()
        const cosR = Math.cos(rad), sinR = Math.sin(rad)
        v3.set(cx * cosR + cz * sinR, geom.floorY + 0.051, -cx * sinR + cz * cosR)
        const p = projectToScreen(v3, camObj, W, H)
        if (p.visible) drawCellText(ctx, p.x, p.y, text)
      }

      // HUD chrome
      // Fade brackets based on hover
      const fadeStep = delta / HUD_FADE_MS
      if (hoverInsideRef.current) bracketOpacityRef.current = Math.min(1, bracketOpacityRef.current + fadeStep)
      else bracketOpacityRef.current = Math.max(0, bracketOpacityRef.current - fadeStep)

      if (bracketOpacityRef.current > 0 && cam.state !== 'PEEK_ORBIT') {
        // Rough plate screen-space bounds from bounds corners
        const cornersXZ = [
          { x: geom.bounds.minX, z: geom.bounds.minZ },
          { x: geom.bounds.maxX, z: geom.bounds.minZ },
          { x: geom.bounds.maxX, z: geom.bounds.maxZ },
          { x: geom.bounds.minX, z: geom.bounds.maxZ },
        ]
        let sx1 = Infinity, sy1 = Infinity, sx2 = -Infinity, sy2 = -Infinity
        const rad = cam.getMeshRotation()
        const cosR = Math.cos(rad), sinR = Math.sin(rad)
        for (const c of cornersXZ) {
          v3.set(c.x * cosR + c.z * sinR, geom.floorY + 0.05, -c.x * sinR + c.z * cosR)
          const p = projectToScreen(v3, camObj, W, H)
          sx1 = Math.min(sx1, p.x); sy1 = Math.min(sy1, p.y)
          sx2 = Math.max(sx2, p.x); sy2 = Math.max(sy2, p.y)
        }
        drawBrackets(ctx, { x: sx1, y: sy1, w: sx2 - sx1, h: sy2 - sy1 }, bracketOpacityRef.current * 0.7)
      }

      // Hover reticle (only when not peeking)
      if (hoverCellRef.current && cam.state !== 'PEEK_ORBIT') {
        const h = hoverCellRef.current
        drawHoverReticle(ctx, { x: h.x, y: h.y }, `R${h.row},C${h.col}`)
      }

      // Bottom readout
      const dims = PLATE_DIMENSIONS[deviceType] ?? { width: 400, height: 400 }
      const rotated = rotation % 2 === 1
      drawBottomReadout(ctx, W, H, {
        deviceType,
        widthMm: rotated ? dims.height : dims.width,
        heightMm: rotated ? dims.width : dims.height,
        rows: rotated ? grid.cols : grid.rows,
        cols: rotated ? grid.rows : grid.cols,
        cameraStateLabel: cameraStateLabel(cam.state),
        activeCell,
      })
    }
    rafRef.current = requestAnimationFrame(draw)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [deviceType, rotation, cellColors, cellTexts, activeCell])

  // ── Render tree ──────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      className="relative w-full h-full min-h-[200px] select-none"
      style={{ cursor: 'grab' }}
    >
      <canvas ref={edgeCanvasRef}  style={{ position: 'absolute', inset: 0, zIndex: 0 }} />
      <canvas ref={webglCanvasRef} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
      <canvas ref={canvasRef}      style={{ position: 'absolute', inset: 0, zIndex: 2 }} />

      {/* HUD action buttons (spec §3.1) — HTML overlays, restyled palette */}
      <div className="absolute bottom-3 right-3 flex gap-1.5" style={{ zIndex: 3 }}>
        <HudButton onClick={onRefresh} title="Refresh devices">&#x21bb;</HudButton>
        <HudButton onClick={onTare} title="Tare (zero)" small>0.0</HudButton>
        <HudButton onClick={onRotate} title="Rotate plate 90°">&#x27F3;</HudButton>
      </div>
    </div>
  )
}

function HudButton({
  children, onClick, title, small,
}: {
  children: React.ReactNode; onClick: () => void; title: string; small?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-8 h-8 rounded flex items-center justify-center transition-colors ${small ? 'text-xs' : 'text-base'} font-bold`}
      style={{
        background: 'transparent',
        border: `1px solid ${plate3d.edgeCyan}40`,
        color: colors.textMuted,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = `${plate3d.edgeCyan}1F`
        ;(e.currentTarget as HTMLButtonElement).style.borderColor = `${plate3d.edgeCyan}99`
        ;(e.currentTarget as HTMLButtonElement).style.color = plate3d.edgeCyan
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
        ;(e.currentTarget as HTMLButtonElement).style.borderColor = `${plate3d.edgeCyan}40`
        ;(e.currentTarget as HTMLButtonElement).style.color = colors.textMuted
      }}
    >
      {children}
    </button>
  )
}

// ── 2D helpers kept inline (share projection state with scene) ─────

function drawFloorGrid(
  ctx: CanvasRenderingContext2D,
  camera: THREE.Camera,
  W: number, H: number,
  floorY: number,
  bounds: Bounds,
) {
  const extent = 3
  const step = 0.1
  const fade = 3
  const v = new THREE.Vector3()
  ctx.save()
  ctx.strokeStyle = plate3d.floorGrid
  ctx.lineWidth = 0.5
  const segment = (x1: number, z1: number, x2: number, z2: number) => {
    v.set(x1, floorY, z1)
    const p1 = projectToScreen(v, camera, W, H)
    v.set(x2, floorY, z2)
    const p2 = projectToScreen(v, camera, W, H)
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2
    const dist = Math.hypot(cx, cz)
    const alpha = 0.5 * Math.max(0, 1 - dist / fade) ** 2
    if (alpha < 0.01) return
    ctx.globalAlpha = alpha
    ctx.beginPath()
    ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y)
    ctx.stroke()
  }
  for (let x = -extent; x <= extent; x += step)
    for (let z = -extent; z < extent; z += step) segment(x, z, x, z + step)
  for (let z = -extent; z <= extent; z += step)
    for (let x = -extent; x < extent; x += step) segment(x, z, x + step, z)
  ctx.restore()
}

function drawEdges(
  ctx: CanvasRenderingContext2D,
  camera: THREE.Camera,
  es: Float32Array | null,
  opacity: number,
  W: number, H: number,
  meshRotation: number,
) {
  if (!es || es.length < 6) return
  const v = new THREE.Vector3()
  const cosR = Math.cos(meshRotation), sinR = Math.sin(meshRotation)
  ctx.save()
  ctx.strokeStyle = plate3d.edgeCyan
  ctx.globalAlpha = opacity
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i < es.length; i += 6) {
    // apply mesh rotation around Y to each endpoint
    const ax = es[i],      ay = es[i + 1], az = es[i + 2]
    const bx = es[i + 3],  by = es[i + 4], bz = es[i + 5]
    v.set(ax * cosR + az * sinR, ay, -ax * sinR + az * cosR)
    const p1 = projectToScreen(v, camera, W, H)
    v.set(bx * cosR + bz * sinR, by, -bx * sinR + bz * cosR)
    const p2 = projectToScreen(v, camera, W, H)
    if (!p1.visible || !p2.visible) continue
    ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y)
  }
  ctx.stroke()
  ctx.restore()
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors. If JSON import errors appear, add `"resolveJsonModule": true` to `tsconfig.json` compilerOptions (check first — likely already set).

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/canvas/plate3d/PlateCanvas.tsx src/components/canvas/plate3d/assets/
git commit -m "feat(plate3d): add drop-in 3D PlateCanvas with cell overlays + HUD"
```

---

## Task 10: Delete old PlateCanvas + update import sites

**Files:**
- Delete: `src/components/canvas/PlateCanvas.tsx`
- Modify: `src/pages/fluxlite/LiveView.tsx`
- Modify: `src/pages/fluxlite/FluxLitePage.tsx`

Spec reference: §3 (`liveTesting` prop), §13 item 2 (phase predicates).

- [ ] **Step 1: Update LiveView.tsx import path + add liveTesting prop**

In `src/pages/fluxlite/LiveView.tsx`:

1. Change the import:
   ```ts
   import { PlateCanvas } from '../../components/canvas/PlateCanvas'
   ```
   to:
   ```ts
   import { PlateCanvas } from '../../components/canvas/plate3d/PlateCanvas'
   ```

2. In the `<PlateCanvas ... />` JSX element (around line 75), add one new prop:
   ```tsx
   liveTesting={phase === 'CAPTURING'}
   ```

Place this prop alongside the existing ones; order doesn't matter.

- [ ] **Step 2: Update FluxLitePage.tsx import path + liveTesting prop**

In `src/pages/fluxlite/FluxLitePage.tsx`:

1. Change the import from `'../../components/canvas/PlateCanvas'` to `'../../components/canvas/plate3d/PlateCanvas'`.

2. Find the existing `phase` reference from `useLiveTestStore` (may already exist; if not, add):
   ```ts
   const liveTestPhase = useLiveTestStore((s) => s.phase)
   ```

3. Add to the `<PlateCanvas ... />` JSX:
   ```tsx
   liveTesting={liveTestPhase === 'TESTING'}
   ```

- [ ] **Step 3: Delete the old PlateCanvas.tsx**

Run:

```bash
git rm src/components/canvas/PlateCanvas.tsx
```

- [ ] **Step 4: Verify TypeScript compiles and tests pass**

Run: `npx tsc --noEmit && npm test`
Expected: no errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pages/fluxlite/LiveView.tsx src/pages/fluxlite/FluxLitePage.tsx
git commit -m "feat(plate3d): switch call sites to 3D PlateCanvas, add liveTesting prop"
```

---

## Task 11: Visual acceptance + polish

**Files:** (as-needed fixes only)

Spec reference: §12 (testing — visual acceptance).

- [ ] **Step 1: Start dev server**

Run: `npm run dev`
Expected: Electron app launches, no console errors, PlateCanvas area renders.

- [ ] **Step 2: Verify all four camera states**

- [ ] INTRO_SWOOP: on first entry to a view with the plate, camera animates from low-oblique to ortho top over ~1.2 s.
- [ ] ORTHO_LOCKED: at rest, top-down, no movement except active-cell amber pulse.
- [ ] PEEK_ORBIT: drag anywhere on the plate → perspective tilt. Dismiss via double-click or button, snaps back.
- [ ] ROTATE_ANIMATE: click the rotate button → plate spins 90° smoothly (~0.5 s).

- [ ] **Step 3: Verify cell interactivity**

- [ ] Click a cell → `onCellClick` fires with correct `(canonR, canonC)`. Verify amber outline appears on clicked cell, bottom readout updates to show `R{row},C{col}`.
- [ ] Set test cell colors + texts via dev tools; confirm they render correctly and rotate with the plate after `onRotate`.
- [ ] Cycle through all 5 device types (06, 07, 08, 11, 12) and confirm each uses the correct plate model.

- [ ] **Step 4: Verify liveTesting hard lock**

- [ ] Trigger `LiveView` into `CAPTURING` phase (via simulated session). Confirm drag is ignored; camera stays ortho. If peeked when capture starts, snap-back animates.

- [ ] **Step 5: Verify HUD chrome behavior**

- [ ] Mouse-enter container → corner brackets fade in. Mouse-leave → fade out.
- [ ] Hover reticle tracks hovered cell, label shows correct coord.
- [ ] Bottom readout shows device/dims/grid/state and active-cell coord.
- [ ] During PEEK, brackets + reticle are hidden.

- [ ] **Step 6: Cross-check the 2D component is gone**

Run: `git grep "components/canvas/PlateCanvas'"` — should return no hits outside the plate3d folder.

- [ ] **Step 7: Apply any fixes needed**

If any of the above fail, fix and commit each fix as a small commit (`fix(plate3d): ...`).

- [ ] **Step 8: Final commit (if none needed, skip)**

```bash
git status
# If dirty:
git add -u && git commit -m "chore(plate3d): visual acceptance polish"
```

---

## Verification summary

After all tasks:

- [ ] `npm test` — all tests pass
- [ ] `npx tsc --noEmit` — clean
- [ ] `npm run dev` — app runs, PlateCanvas works in both LiveView and FluxLitePage
- [ ] `git log --oneline` shows ~11 focused commits on `electron` branch
- [ ] No `renderer.dispose()` calls anywhere in plate3d (grep to confirm)
- [ ] Old `src/components/canvas/PlateCanvas.tsx` is gone
- [ ] `liveTesting` hard lock works in `LiveView`
