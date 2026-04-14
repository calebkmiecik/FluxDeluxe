import type { DeviceFrame } from './types'

export function extractDeviceFrames(payload: unknown): DeviceFrame[] {
  if (Array.isArray(payload)) {
    return payload.filter((f): f is DeviceFrame => typeof f === 'object' && f !== null)
  }

  if (typeof payload !== 'object' || payload === null) return []

  const p = payload as Record<string, unknown>

  // Raw sensor stream: { deviceId, sensors:[...], cop:{...}, moments:{...} }
  if ('sensors' in p && Array.isArray(p.sensors)) {
    const did = String(p.deviceId ?? '').trim()
    if (!did) return []
    const sum = (p.sensors as Record<string, unknown>[]).find(
      (s) => typeof s === 'object' && s !== null && s.name === 'Sum'
    )
    if (!sum) return []
    const cop = (p.cop ?? {}) as Record<string, number>
    const moments = (p.moments ?? {}) as Record<string, number>
    return [{
      id: did,
      fx: Number(sum.x ?? 0),
      fy: Number(sum.y ?? 0),
      fz: Number(sum.z ?? 0),
      time: p.time as number | undefined,
      avgTemperatureF: p.avgTemperatureF as number | undefined,
      cop: { x: Number(cop.x ?? 0), y: Number(cop.y ?? 0) },
      moments: { x: Number(moments.x ?? 0), y: Number(moments.y ?? 0), z: Number(moments.z ?? 0) },
      groupId: (p.groupId ?? p.group_id) as string | undefined,
    }]
  }

  // Processed stream: { devices:[...] }
  if ('devices' in p && Array.isArray(p.devices)) {
    return p.devices.filter((f): f is DeviceFrame => typeof f === 'object' && f !== null)
  }

  // Single frame dict
  if ('id' in p || 'deviceId' in p) {
    return [p as DeviceFrame]
  }

  return []
}
