/**
 * Device-type family mapping.
 *
 * Source of truth: `src/components/canvas/plate3d/constants.ts`
 * Device type codes (from `.axfId` / `deviceTypeId`) map to product families:
 *   - Lite      ← 06, 10
 *   - Launchpad ← 07, 11
 *   - XL        ← 08, 12
 */

export type DeviceFamily = 'lite' | 'launchpad' | 'xl'

export const ALL_FAMILIES: DeviceFamily[] = ['lite', 'launchpad', 'xl']

const TYPE_TO_FAMILY: Record<string, DeviceFamily> = {
  '06': 'lite',
  '10': 'lite',
  '07': 'launchpad',
  '11': 'launchpad',
  '08': 'xl',
  '12': 'xl',
}

const FAMILY_TO_TYPES: Record<DeviceFamily, string[]> = {
  lite: ['06', '10'],
  launchpad: ['07', '11'],
  xl: ['08', '12'],
}

const FAMILY_LABEL: Record<DeviceFamily, string> = {
  lite: 'Lite',
  launchpad: 'Launchpad',
  xl: 'XL',
}

/** Returns the family for a device_type code, or `null` if unknown. */
export function deviceTypeToFamily(deviceType: string): DeviceFamily | null {
  return TYPE_TO_FAMILY[deviceType] ?? null
}

/** Returns the known device_type codes for a family. */
export function familyToDeviceTypes(family: DeviceFamily): string[] {
  return FAMILY_TO_TYPES[family]
}

/** Display label for a family (e.g. `launchpad` → `Launchpad`). */
export function familyLabel(family: DeviceFamily): string {
  return FAMILY_LABEL[family]
}
