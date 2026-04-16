/**
 * Extract the two-char device type prefix from an Axioforce axfId.
 * axfId format: "XX.YYYYYYYY" where XX is the hex device type.
 * Returns '' if the format doesn't match.
 */
export function deviceTypeFromAxfId(axfId: string): string {
  const m = /^([A-Fa-f0-9]{2})\./.exec(axfId)
  return m ? m[1] : ''
}
