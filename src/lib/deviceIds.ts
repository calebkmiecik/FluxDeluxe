/**
 * Extract the two-char device type prefix from an Axioforce axfId.
 * axfId format: "XX.YYYYYYYY" where XX is the hex device type.
 * Returns '' if the format doesn't match.
 */
export function deviceTypeFromAxfId(axfId: string): string {
  const m = /^([A-Fa-f0-9]{2})\./.exec(axfId)
  return m ? m[1] : ''
}

/**
 * Per-device axis correction. Each entry describes how many CCW 90°
 * quarter-turns to apply to a sensor-frame (x, y) pair, followed by an
 * optional horizontal mirror (negate X).
 *
 * Add or edit entries as new device types are empirically dialed in.
 */
interface AxisTransform { turns: number; mirror: boolean }
const DEVICE_AXIS_TRANSFORMS: Record<string, AxisTransform> = {
  // Lite
  '06': { turns: 0, mirror: false },
  '10': { turns: 0, mirror: false },
  // Launchpad — 90° CW (= 3 CCW quarter turns), no mirror
  '07': { turns: 3, mirror: false },
  '11': { turns: 3, mirror: false },
  // Launchpad XL
  '08': { turns: 1, mirror: true },
  '12': { turns: 1, mirror: true },
}

function deviceAxisTransform(deviceType: string): AxisTransform {
  return DEVICE_AXIS_TRANSFORMS[deviceType] ?? { turns: 0, mirror: false }
}

export function deviceAxisQuarterTurns(deviceType: string): number {
  return deviceAxisTransform(deviceType).turns
}

export function deviceAxisMirror(deviceType: string): boolean {
  return deviceAxisTransform(deviceType).mirror
}

/**
 * Rotate a 2D vector CCW by `turns` × 90° around origin.
 * turns=1 → (x,y) → (-y, x);  turns=2 → (-x,-y);  turns=3 → (y,-x).
 */
export function rotateQuarter(x: number, y: number, turns: number): [number, number] {
  const t = ((turns % 4) + 4) % 4
  if (t === 0) return [x, y]
  if (t === 1) return [-y, x]
  if (t === 2) return [-x, -y]
  return [y, -x]
}

/**
 * Apply the device-specific axis rotation (and mirror, if any) to an
 * (x, y) pair coming from the sensor frame. Use for cop.x/cop.y,
 * fx/fy, mx/my.
 */
export function rotateForDevice(x: number, y: number, deviceType: string): [number, number] {
  const t = deviceAxisTransform(deviceType)
  let [rx, ry] = rotateQuarter(x, y, t.turns)
  if (t.mirror) rx = -rx
  return [rx, ry]
}
