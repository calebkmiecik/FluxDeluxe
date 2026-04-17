/**
 * Shared config for the force/moment dashboard toggle.
 * The Live view shows either Forces (Fx/Fy/Fz) or Moments (Mx/My/Mz) at a time.
 */

export type DataMode = 'forces' | 'moments'

export type ForceAxis = 'fx' | 'fy' | 'fz'
export type MomentAxis = 'mx' | 'my' | 'mz'
export type Axis = ForceAxis | MomentAxis

export interface AxisMeta {
  key: Axis
  label: string
  line: string
  core: string
  glow: string
  fill: string
}

export interface ModeConfig {
  mode: DataMode
  title: string        // e.g. "Force" / "Moment" for axis label
  unit: string         // "N" / "Nm"
  axes: AxisMeta[]     // order matters — primary first
}

export const FORCE_MODE: ModeConfig = {
  mode: 'forces',
  title: 'Force',
  unit: 'N',
  axes: [
    { key: 'fz', label: 'Fz', line: '#0051BA', core: '#3B8EFF', glow: 'rgba(0, 81, 186, 0.35)', fill: 'rgba(0, 81, 186, 0.12)' },
    { key: 'fx', label: 'Fx', line: '#00897B', core: '#00BFA5', glow: 'rgba(0, 191, 165, 0.25)', fill: 'rgba(0, 191, 165, 0.06)' },
    { key: 'fy', label: 'Fy', line: '#E65100', core: '#FF9100', glow: 'rgba(255, 145, 0, 0.25)', fill: 'rgba(255, 145, 0, 0.06)' },
  ],
}

export const MOMENT_MODE: ModeConfig = {
  mode: 'moments',
  title: 'Moment',
  unit: 'Nm',
  // Same axis colors as forces — Z is blue, X is teal, Y is orange regardless of mode.
  axes: [
    { key: 'mz', label: 'Mz', line: '#0051BA', core: '#3B8EFF', glow: 'rgba(0, 81, 186, 0.35)', fill: 'rgba(0, 81, 186, 0.12)' },
    { key: 'mx', label: 'Mx', line: '#00897B', core: '#00BFA5', glow: 'rgba(0, 191, 165, 0.25)', fill: 'rgba(0, 191, 165, 0.06)' },
    { key: 'my', label: 'My', line: '#E65100', core: '#FF9100', glow: 'rgba(255, 145, 0, 0.25)', fill: 'rgba(255, 145, 0, 0.06)' },
  ],
}

export function getModeConfig(mode: DataMode): ModeConfig {
  return mode === 'forces' ? FORCE_MODE : MOMENT_MODE
}

/** Pull the right scalar off a DeviceFrame for a given axis key */
export function extractAxisValue(
  frame: { fx: number; fy: number; fz: number; moments: { x: number; y: number; z: number } },
  axis: Axis,
): number {
  switch (axis) {
    case 'fx': return frame.fx
    case 'fy': return frame.fy
    case 'fz': return frame.fz
    case 'mx': return frame.moments.x
    case 'my': return frame.moments.y
    case 'mz': return frame.moments.z
  }
}
