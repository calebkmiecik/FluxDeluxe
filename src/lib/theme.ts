/**
 * Axioforce FluxDeluxe Design Tokens
 *
 * Single source of truth for all colors, typography, and spacing.
 * Import from here instead of hardcoding hex values.
 *
 * CSS custom properties in index.css reference these same values.
 * Canvas components use these directly (no CSS access in canvas context).
 */

// ── Colors ──────────────────────────────────────────────────────────
export const colors = {
  // Backgrounds
  background: '#141414',
  surface: '#242424',
  surfaceDark: '#1A1A1A',

  // Borders
  border: '#333333',
  borderAccent: '#0051BA',

  // Text
  text: '#CECECE',
  textMuted: '#8E9FBC',

  // Brand
  primary: '#0051BA',
  primaryHover: '#0063E0',
  primaryGlow: 'rgba(0, 81, 186, 0.3)',
  accent: '#8E9FBC',

  // Status
  success: '#00C853',
  warning: '#FFC107',
  danger: '#FF5252',

  // Fixed (don't change with theme)
  white: '#FFFFFF',
  black: '#000000',

  // Canvas-specific
  plateFill: '#AFB4BE',
  gridLine: '#333333',
  canvasBg: '#141414',

  // 3D plate canvas
  plate3dFloorGrid: '#3A4556',
  plate3dPlateFill: '#1C2638',
  plate3dEdgeCyan: '#7AB8FF',
  plate3dActiveAmber: '#FFC107', // alias for warning, used only for active cell
} as const

// ── Typography ──────────────────────────────────────────────────────
export const fonts = {
  sans: "'Geist Variable', system-ui, sans-serif",
  mono: "'Geist Mono Variable', monospace",
} as const

// ── Spacing (4px base grid) ─────────────────────────────────────────
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
} as const

// ── Border Radius ───────────────────────────────────────────────────
export const radius = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
} as const

// ── Canvas Drawing Helpers ──────────────────────────────────────────
// Use these in canvas ctx.fillStyle / ctx.strokeStyle calls
export const canvas = {
  bg: colors.canvasBg,
  gridLine: colors.gridLine,
  axisLabel: colors.textMuted,
  dataLine: colors.primary,
  noDataText: colors.textMuted,
  plateOutline: colors.gridLine,
  plateFill: colors.plateFill,
  plateBorder: colors.gridLine,
  copDot: colors.primary,
  copCrosshair: 'rgba(0, 81, 186, 0.4)',
  activeCell: colors.primary,
  cellText: colors.background,
  cellTextLight: colors.text,
  forceText: colors.text,
} as const

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
