import { describe, it, expect } from 'vitest'
import { extractDeviceFrames } from '../lib/frameParser'

describe('extractDeviceFrames', () => {
  it('handles list of frame dicts', () => {
    const payload = [
      { id: 'axf_001', fx: 1, fy: 2, fz: 100, cop: { x: 0, y: 0 }, moments: { x: 0, y: 0, z: 0 } },
    ]
    const frames = extractDeviceFrames(payload)
    expect(frames).toHaveLength(1)
    expect(frames[0].id).toBe('axf_001')
    expect(frames[0].fz).toBe(100)
  })

  it('handles dict with "devices" key', () => {
    const payload = {
      devices: [
        { id: 'axf_002', fx: 0, fy: 0, fz: 200, cop: { x: 1, y: 2 }, moments: { x: 0, y: 0, z: 0 } },
      ],
    }
    const frames = extractDeviceFrames(payload)
    expect(frames).toHaveLength(1)
    expect(frames[0].fz).toBe(200)
  })

  it('handles raw sensor payload', () => {
    const payload = {
      deviceId: 'axf_003',
      sensors: [{ name: 'Sum', x: 1, y: 2, z: 300 }],
      cop: { x: 10, y: 20 },
      moments: { x: 5, y: 6, z: 7 },
      avgTemperatureF: 72.5,
    }
    const frames = extractDeviceFrames(payload)
    expect(frames).toHaveLength(1)
    expect(frames[0].id).toBe('axf_003')
    expect(frames[0].fz).toBe(300)
    expect(frames[0].cop.x).toBe(10)
  })

  it('handles single frame dict', () => {
    const payload = { id: 'axf_004', fx: 0, fy: 0, fz: 50, cop: { x: 0, y: 0 }, moments: { x: 0, y: 0, z: 0 } }
    const frames = extractDeviceFrames(payload)
    expect(frames).toHaveLength(1)
  })

  it('returns empty for non-dict/non-array', () => {
    expect(extractDeviceFrames(null)).toEqual([])
    expect(extractDeviceFrames('string')).toEqual([])
    expect(extractDeviceFrames(42)).toEqual([])
  })
})
