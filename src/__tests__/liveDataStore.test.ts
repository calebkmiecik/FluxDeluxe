import { describe, it, expect, beforeEach } from 'vitest'
import { useLiveDataStore } from '../stores/liveDataStore'
import type { DeviceFrame } from '../lib/types'

function makeFrame(id: string, fz = 100): DeviceFrame {
  return {
    id,
    fx: 0,
    fy: 0,
    fz,
    cop: { x: 0, y: 0 },
    moments: { x: 0, y: 0, z: 0 },
  }
}

describe('liveDataStore', () => {
  beforeEach(() => {
    useLiveDataStore.getState().clearBuffer()
  })

  it('starts with null currentFrame', () => {
    expect(useLiveDataStore.getState().currentFrame).toBeNull()
  })

  it('starts with empty ring buffer', () => {
    expect(useLiveDataStore.getState().frameBuffer.size).toBe(0)
  })

  it('pushes frames to ring buffer', () => {
    useLiveDataStore.getState().pushFrame(makeFrame('axf_001'))
    useLiveDataStore.getState().pushFrame(makeFrame('axf_002'))
    expect(useLiveDataStore.getState().frameBuffer.size).toBe(2)
  })

  it('updates currentFrame on push', () => {
    const frame = makeFrame('axf_001', 250)
    useLiveDataStore.getState().pushFrame(frame)
    expect(useLiveDataStore.getState().currentFrame).toEqual(frame)
  })

  it('ring buffer caps at 300', () => {
    for (let i = 0; i < 350; i++) {
      useLiveDataStore.getState().pushFrame(makeFrame(`axf_${i}`, i))
    }
    expect(useLiveDataStore.getState().frameBuffer.size).toBe(300)
  })

  it('ring buffer toArray returns frames in order after overflow', () => {
    for (let i = 0; i < 310; i++) {
      useLiveDataStore.getState().pushFrame(makeFrame(`axf_${i}`, i))
    }
    const arr = useLiveDataStore.getState().frameBuffer.toArray()
    expect(arr).toHaveLength(300)
    // The oldest should be frame index 10 (frames 0-9 were overwritten)
    expect(arr[0].fz).toBe(10)
    // The newest should be frame index 309
    expect(arr[299].fz).toBe(309)
  })

  it('clearBuffer resets currentFrame and buffer', () => {
    useLiveDataStore.getState().pushFrame(makeFrame('axf_001'))
    useLiveDataStore.getState().clearBuffer()
    expect(useLiveDataStore.getState().currentFrame).toBeNull()
    expect(useLiveDataStore.getState().frameBuffer.size).toBe(0)
  })
})
