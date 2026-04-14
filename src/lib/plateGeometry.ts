import { COLOR_BIN_MULTIPLIERS } from './types'

/** Mirror cell for device types that use anti-diagonal layout (06, 08, 12). */
export function mapCellForDevice(
  row: number, col: number, rows: number, cols: number, deviceType: string
): [number, number] {
  if (['06', '08', '12'].includes(deviceType)) {
    return [rows - 1 - col, cols - 1 - row]
  }
  return [row, col]
}

/** Rotate cell coordinates by k*90 degrees clockwise. */
export function mapCellForRotation(
  row: number, col: number, rows: number, cols: number, k: number
): [number, number] {
  const q = ((k % 4) + 4) % 4
  if (q === 0) return [row, col]
  if (q === 1) return [col, cols - 1 - row]
  if (q === 2) return [rows - 1 - row, cols - 1 - col]
  return [rows - 1 - col, row]
}

/** Invert rotation mapping (for click → canonical cell). */
export function invertRotation(
  row: number, col: number, rows: number, cols: number, k: number
): [number, number] {
  const q = ((k % 4) + 4) % 4
  if (q === 0) return [row, col]
  if (q === 1) return [cols - 1 - col, row]
  if (q === 2) return [rows - 1 - row, cols - 1 - col]
  return [col, rows - 1 - row]
}

/** Invert device mapping (for click → canonical cell). */
export function invertDeviceMapping(
  row: number, col: number, rows: number, cols: number, deviceType: string
): [number, number] {
  if (['06', '08', '12'].includes(deviceType)) {
    return [rows - 1 - col, cols - 1 - row]
  }
  return [row, col]
}

/** Map error ratio to color bin name. */
export function getColorBin(errorRatio: number): string {
  if (errorRatio <= COLOR_BIN_MULTIPLIERS.green) return 'green'
  if (errorRatio <= COLOR_BIN_MULTIPLIERS.light_green) return 'light_green'
  if (errorRatio <= COLOR_BIN_MULTIPLIERS.yellow) return 'yellow'
  if (errorRatio <= COLOR_BIN_MULTIPLIERS.orange) return 'orange'
  return 'red'
}
