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
export const MIN_PEEK_ELEVATION = 0.35 // ~20° — avoids grid horizon at very low angles
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
