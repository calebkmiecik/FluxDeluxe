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
 * Some device types have their sensor axes physically rotated relative to
 * our canonical world frame. XL plates (08, 12) are mounted 90° CCW. Other
 * types need no correction.
 *
 * Returns how many CCW 90° quarter-turns to apply to an (x, y) vector
 * coming from that device's sensor frame before placing it in world XZ.
 */
export function deviceAxisQuarterTurns(deviceType: string): number {
  if (deviceType === '08' || deviceType === '12') return 1
  return 0
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
 * Some device types also need a horizontal mirror (reflection across the
 * Y axis — X coordinate negates) applied AFTER the quarter-turn rotation.
 * Currently only the XL plates (08, 12).
 */
export function deviceAxisMirror(deviceType: string): boolean {
  return deviceType === '08' || deviceType === '12'
}

/**
 * Convenience: apply the device-specific axis rotation (and mirror, if any)
 * to an (x, y) pair coming from the sensor frame. Use for cop.x/cop.y,
 * fx/fy, mx/my.
 */
export function rotateForDevice(x: number, y: number, deviceType: string): [number, number] {
  let [rx, ry] = rotateQuarter(x, y, deviceAxisQuarterTurns(deviceType))
  if (deviceAxisMirror(deviceType)) rx = -rx
  return [rx, ry]
}
