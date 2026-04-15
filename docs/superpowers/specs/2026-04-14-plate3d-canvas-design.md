# Plate 3D Canvas — Design Spec

**Date:** 2026-04-14
**Status:** Approved (pending spec review)
**Replaces:** `src/components/canvas/PlateCanvas.tsx` (2D implementation)

---

## 1. Goal

Replace the existing 2D `PlateCanvas` with a 3D renderer ported from the
Axioforce production frontend, preserving the exact public prop contract.
The aesthetic sits between Tesla (clean, minimal, dark, plate-as-hero) and
Mission Control (precise wireframe, monospace telemetry, corner brackets) —
leaning Tesla.

The default view is orthographic top-down. On first mount per app session,
the camera animates in via a 1.2 s perspective-to-ortho swoop. Users can
drag to peek into a perspective orbit, with snap-back on demand or on
live-testing transition.

## 2. Non-goals

- No mound / batter's box rendering (plate-only).
- No COP overlay inside this component — remains in `COPVisualization`.
- No real lighting; the depth illusion is produced entirely by wireframe
  edges layered above/below a translucent top-surface fill mesh
  (production pattern, preserved).
- No new animation library; ease curves are local helpers.

## 3. Public contract

The component is a drop-in replacement. Its exported name, import path
relative to the `canvas/` folder, and prop shape remain identical except
for **one optional addition**:

```ts
interface PlateCanvasProps {
  deviceType: string                 // '06', '07', '08', '10', '11', '12'
  rotation: number                   // 0-3 quadrants
  cellColors: Map<string, string>    // "row,col" -> bin name
  cellTexts: Map<string, string>     // "row,col" -> display text
  activeCell: { row: number; col: number } | null
  onCellClick: (row: number, col: number) => void
  onRotate: () => void
  onTare: () => void
  onRefresh: () => void
  liveTesting?: boolean              // NEW — default false
}
```

Existing call sites (`LiveView.tsx`, `FluxLitePage.tsx`) change only their
`import` path. `LiveView` additionally passes `liveTesting={phase === 'CAPTURING'}`.
`FluxLitePage` omits the prop (default `false`).

## 4. File layout

```
src/components/canvas/plate3d/
  PlateCanvas.tsx         ← drop-in replacement, same export name
  PlateScene.ts           ← WebGL scene manager (ported from production)
  plateModelCache.ts      ← base64 JSON decoder + edge split (ported)
  cameraController.ts     ← camera state machine
  cellOverlay.ts          ← cell fills, labels, active highlight
  cellRaycaster.ts        ← screen-click -> canonical cell
  constants.ts            ← device→JSON map, timings, palette
  assets/
    plate-lite.json       ← device types 06, 10
    plate-launchpad.json  ← device types 07, 11
    plate-xl.json         ← device types 08, 12
```

The existing `src/components/canvas/PlateCanvas.tsx` is deleted. The two
import sites change one line each.

Theme additions live in `src/lib/theme.ts` under a new `plate3d` block
(see §8).

## 5. Rendering composition

Three stacked canvases inside one container (production pattern):

| z | Canvas | Contents |
|---|--------|----------|
| 0 | 2D | background fill, floor grid (radial fade), below-fill wireframes (`footEdges`, `bodyEdges`, `topEdgesLower`) |
| 1 | WebGL | plate top fill mesh, cell color meshes (co-planar with top, offset +0.0005 m), active-cell amber ring |
| 2 | 2D | above-fill wireframes (`topEdgesUpper`), projected cell text labels, HUD chrome (corner brackets, bottom readout, hover reticle) |

**Why cell colors go in WebGL (z=1).** They must tilt and rotate with the
plate during PEEK and during ROTATE_ANIMATE. Rendering them as flat 3D
planes gets correct tilt projection and depth-testing for free. Projecting
them as 2D quads would require manual distortion and painter's sort.

**Why cell text goes in 2D (z=2).** Tesla-clean readability requires crisp,
kerned, DPI-aware glyphs at all camera tilts. MSDF text is pixel-crawly,
geometric text is heavy. 2D text projected from the cell's world XZ stays
crisp and foreshortens naturally.

**Active cell highlight** — amber ring mesh in the WebGL layer, follows
tilt. A secondary corner-bracket reticle in the HUD layer pulses subtly
over the active cell's screen-space position. Only one color is amber.

## 6. Camera state machine

Four states. Transitions animate; rests are static.

```
         [first mount]
              │
              ▼
       ┌───────────────┐
       │  INTRO_SWOOP  │  1.2 s, one-shot per app session
       └───────┬───────┘
               │ on complete
               ▼
       ┌───────────────┐ ── drag start ──▶ ┌──────────────┐
       │  ORTHO_LOCKED │                   │  PEEK_ORBIT  │
       │ (resting pose)│ ◀── release/dbl ─ │ (perspective)│
       └───────┬───────┘     0.4 s ease    └──────────────┘
               │
               │ rotation prop changes
               ▼
       ┌────────────────┐
       │ ROTATE_ANIMATE │  0.5 s, plate mesh spins 90° (not camera)
       └────────┬───────┘
                │ on complete
                ▼
          ORTHO_LOCKED
```

### 6.1 INTRO_SWOOP

- Starts at production's resting pose: `azimuth=1.110, elevation=0.510,
  distance=fit*1.25`, perspective projection.
- Animates over 1.2 s (`cubicInOut`) to ortho top-down: `azimuth=0,
  elevation=π/2, distance=fit`, orthographic projection.
- Fires **once per app session**, guarded by a module-level flag in
  `cameraController.ts`. Subsequent mounts within the same Electron
  process snap straight to ortho top.

### 6.2 ORTHO_LOCKED (resting)

- Orthographic projection, straight-down pose.
- No mouse-look response.
- Wheel zoom allowed, clamped to ±15% of fit distance.
- Clicks hit the raycaster (§7).

### 6.3 PEEK_ORBIT

- Entered on `mousedown` + drag exceeding the click threshold (§7.3).
- Switches to perspective projection, unlocks azimuth/elevation.
- Elevation clamped `[0.15, π/2]` (camera can't go below the plate).
- Pan allowed, clamped so the plate center stays inside the viewport.
- Exits via: (a) double-click anywhere, or (b) "⌖ TOP" button in the HUD,
  or (c) `liveTesting` transitioning `false → true`.
- Exit animates 0.4 s `cubicOut` back to ortho top.
- Idle peek does **not** auto-return; user inspection is respected.

### 6.4 ROTATE_ANIMATE

- Triggered when the `rotation` prop changes during mount. The plate mesh
  is rotated around world Y; the camera does not move.
- 0.5 s, `cubicOut`, from `previousRotation * π/2` to `rotation * π/2`.
- Clicks suppressed during animation.
- On initial mount with `rotation != 0`, the mesh starts at the final
  angle; no animation plays. Animation only fires on prop *change*.

### 6.5 Live-testing hard lock

When `liveTesting === true`:
- Drag is ignored entirely (state machine stays in ORTHO_LOCKED).
- Wheel zoom still allowed.
- On `liveTesting` transition `false → true`, if currently PEEK_ORBIT,
  eased 0.4 s return to ortho.
- Rotate animation still fires normally.

## 7. Cell interaction

### 7.1 Click resolution pipeline

1. **Screen → NDC → ray** via `THREE.Raycaster.setFromCamera(ndc, camera)`.
   Works for both ortho and perspective cameras.
2. **Ray → hit-plane intersection**. A single invisible rectangular
   `THREE.Plane` at world Y = `floorY + plateTopHeight`, bounded by the
   JSON `bounds`, rotated by the current plate mesh rotation. Not added
   to the scene — used only for raycasting.
3. **Hit point XZ → display cell** — map `(hitX, hitZ)` within `bounds` to
   `(dispR, dispC)` using `displayRows × displayCols`. Floor-clamp to the
   grid extents.
4. **Display cell → canonical** — call existing
   `invertRotation(dispR, dispC, rows, cols, rotation)` then
   `invertDeviceMapping(invR, invC, rows, cols, deviceType)` from
   `src/lib/plateGeometry.ts`. No new coordinate-transform logic.

### 7.2 Miss handling

If the ray misses the hit plane, no callback fires. Matches existing
behavior — clicks off-plate are silently ignored.

### 7.3 Click vs drag disambiguation

- A pointer interaction with `< 3 px` total movement and `< 200 ms`
  duration counts as a click.
- Anything above either threshold engages PEEK_ORBIT (unless
  `liveTesting` is true, in which case the drag is ignored).
- Without this split, every click produces a tiny unwanted camera nudge.

### 7.4 Cell *rendering* reuses the same helpers in reverse

For every entry in `cellColors` / `cellTexts`:
1. `mapCellForDevice(canonR, canonC, rows, cols, deviceType)` → device cell
2. `mapCellForRotation(dr, dc, rows, cols, rotation)` → display cell
3. display cell → plate-local XZ rect → world position

This keeps the geometry-helper module the single source of truth. The
3D code adds no coordinate transforms of its own.

## 8. Aesthetic (Tesla-leaning hybrid)

### 8.1 Palette

Extends `src/lib/theme.ts` with a new `plate3d` token block:

| Token | Value | Use |
|-------|-------|-----|
| `bg` | `#141414` (existing `canvasBg`) | canvas background |
| `floorGrid` | `#3A4556` (new) | floor grid with radial fade |
| `plateFill` | `#1C2638` (new) | plate top surface, opacity 0.92 |
| `edgeCyan` | `#7AB8FF` (new) | plate wireframe edges |
| `cellBins` | existing `COLOR_BIN_RGBA`, opacity × 0.55 | cell fills |
| `activeAmber` | `#FFC107` (existing `warning`) | active cell only |

Only one thing in the viewport is amber. If two things are amber, it's a
bug.

### 8.2 Typography

- **Geist Mono** (12 px): bottom readout strip, corner bracket labels,
  hover reticle coord label. Monospace earns its place for numeric
  readouts.
- **Geist Variable**: everything else (none currently — this component has
  no sans-serif chrome).

### 8.3 HUD chrome (z=2 canvas)

- **Corner brackets**. Four L-shaped brackets at the four corners of the
  plate's screen-space bounding rect. ~16 px long, 1 px stroke,
  `edgeCyan` color, 0.7 opacity. Fade in 200 ms on container
  `mouseenter`, fade out on leave.
- **Bottom readout strip**. 28 px tall, rendered directly on the z=2
  canvas (not an HTML overlay — keeps it pixel-perfect with the plate).
  Left-aligned monospace: `06 · 404×353 mm · 3×3 · ▲ TOP` (device ·
  dimensions · grid · camera state). Right-aligned: active cell coord
  (`R2,C1`) in amber when a cell is active, otherwise blank.
- **Hover reticle**. 1 px cross-hair through the hovered cell's screen
  center + the cell's coord label (monospace, muted) floating
  above-right. Hidden during PEEK to avoid clutter.

### 8.4 Lighting & edges

- No real lights — material is `MeshBasicMaterial`, matching production.
- Active cell highlight: amber ring co-planar with the plate top, 1.5 px
  thick (approx — rendered as a line loop), inset 0.003 m from cell
  edges. Opacity pulses sinusoidally 0.8 ↔ 1.0 on a 1.6 s period. This
  is the only moving element at rest.

### 8.5 Motion vocabulary

| Transition | Duration | Easing |
|------------|----------|--------|
| Intro swoop | 1.2 s | `cubicInOut` |
| Rotate | 0.5 s | `cubicOut` |
| Peek return | 0.4 s | `cubicOut` |
| Corner bracket / reticle fade | 200 ms | `quadOut` |
| Active amber pulse | 1.6 s loop | `sin` |

### 8.6 Discipline rules

- No drop shadows, anywhere.
- No gradients except the floor grid radial fade.
- Exactly one accent color (amber) with exactly one job (active cell).
- Corner brackets and hover reticle hidden during PEEK.
- Chrome fades out, never pops.

## 9. Dependencies

New runtime dependency:
- `three` (^0.167.0 or newer)

New dev dependency:
- `@types/three`

No tween / animation library. Easing is hand-rolled (~20 LOC in
`constants.ts`). Matches the rest of the codebase's minimalism.

## 10. Asset loading

The three plate JSONs are imported statically in `constants.ts`:

```ts
import plateLite from './assets/plate-lite.json'
import plateLaunchpad from './assets/plate-launchpad.json'
import plateXl from './assets/plate-xl.json'

export const PLATE_JSON_BY_TYPE: Record<string, unknown> = {
  '06': plateLite,       '10': plateLite,
  '07': plateLaunchpad,  '11': plateLaunchpad,
  '08': plateXl,         '12': plateXl,
}
```

Bundle impact: ~1.9 MB total across the three files, bundled into the
renderer chunk. Because the app is Electron-local, load cost is a one-time
disk read. Runtime plate-type switching is instant (in-memory parse
already cached).

If lazy-loading becomes desirable later (dynamic `import()` per device
type, splitting into three chunks), the `PLATE_JSON_BY_TYPE` indirection
makes that a local change.

## 11. Error handling

- **WebGL unavailable**. `waitForWebGL()` probes with exponential backoff.
  If it never resolves, the component renders a muted fallback — a dark
  panel with the monospace text "3D view unavailable" and the current
  device type. The rest of the app (data panels, force plot) continues
  unaffected. Cell interaction is lost in this fallback state.
- **Unknown `deviceType`**. If not present in `PLATE_JSON_BY_TYPE`, falls
  back to `plate-launchpad` and `console.warn` fires once. Cell grid math
  still works (driven by `PLATE_DIMENSIONS` / `GRID_DIMS` in `types.ts`,
  which would also be missing an entry — the existing 2D code has the
  same exposure).
- **Corrupt / empty JSON fields**. `parsePlateJSON` defaults `floorY` to
  `0` and `bounds` to `{minX:-0.3, maxX:0.3, minZ:-0.3, maxZ:0.3}`.
  Zero-length edges / faces simply skip their draw pass.
- **Renderer lifecycle**. Never call `renderer.dispose()` — it invokes
  `WEBGL_lose_context.loseContext()`, and Chromium blocks the page after
  ~3 intentional context losses. Use the production `WeakMap` renderer
  cache keyed by canvas element so the GL context is reclaimed naturally
  on GC.

## 12. Testing

- **Unit tests** (vitest + jsdom, existing style): cell coordinate
  round-trip (world XZ ↔ canonical cell) across all 5 device types × 4
  rotations × sampled cells. Catches regressions in the raycaster or its
  interaction with `plateGeometry` helpers.
- **Visual / manual acceptance**: spot-check the four states
  (INTRO_SWOOP, ORTHO_LOCKED, PEEK_ORBIT, ROTATE_ANIMATE) in dev; confirm
  cell colors track rotation, active amber correct, chrome fades behave,
  `liveTesting` hard-lock disables drag.
- **No WebGL rendering tests** — jsdom has no WebGL context; mocking it
  is high-effort low-value. Math correctness is tested via unit tests;
  render correctness is verified by eye.

## 13. Open items / assumptions

1. **Device `10`** is not in `src/lib/types.ts` (`PLATE_DIMENSIONS`,
   `GRID_DIMS`, `THRESHOLDS_*`). Plate-3D handles it by mapping to
   `plate-lite`, but the broader app won't render `10` correctly until
   `types.ts` is updated. Flagged for follow-up — out of scope here.
2. **`liveTesting` criterion in `LiveView`**. Design assumes
   `liveTesting={phase === 'CAPTURING'}`. If you want
   `ARMED | STABLE | CAPTURING`, it's a one-line change in
   `LiveView.tsx`.
3. **`FluxLitePage`** keeps default `liveTesting=false`, so users can
   peek freely there. Assumed correct; confirm if that page is also
   considered "live testing" at some phase.
4. **"Once per app session"** for the intro swoop scopes to the Electron
   process lifetime. Re-entering LiveView within the same run snaps
   straight to top, no swoop.
5. **Plate JSON files** will be copied from the production frontend
   (`AxioforceFlux3/src/renderer/assets/models/extracted/`) into
   `src/components/canvas/plate3d/assets/`. Schema is assumed to match
   what the production Claude documented (base64 Float32Arrays for
   `edges`, `footEdges`, `topPlateEdges`, `faces`; plus `floorY`,
   `bounds`).
