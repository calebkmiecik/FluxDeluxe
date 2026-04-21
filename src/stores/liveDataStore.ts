import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { DeviceFrame } from '../lib/types'

const MAX_BUFFER_SIZE = 5000 // ~5 seconds at 1000Hz

export class RingBuffer<T> {
  private buf: T[] = []
  private head = 0
  private _size = 0
  constructor(private capacity: number) {}
  push(item: T): void {
    if (this._size < this.capacity) {
      this.buf.push(item)
      this._size++
    } else {
      this.buf[this.head] = item
      this.head = (this.head + 1) % this.capacity
    }
  }
  toArray(): T[] {
    if (this._size < this.capacity) return this.buf.slice()
    return [...this.buf.slice(this.head), ...this.buf.slice(0, this.head)]
  }
  clear(): void { this.buf = []; this.head = 0; this._size = 0 }
  get size(): number { return this._size }
}

export interface TimestampedFrame extends DeviceFrame {
  /** Monotonic timestamp (ms) set on arrival — always present, unlike frame.time */
  _receivedAt: number
}

interface LiveDataStoreState {
  currentFrame: TimestampedFrame | null
  frameBuffer: RingBuffer<TimestampedFrame>
  pushFrame: (frame: DeviceFrame) => void
  clearBuffer: () => void
}

// Per-device latest frame cache — mutable, not reactive (avoids Map
// copying on every 100Hz push). Read via getLatestFrameForDevice().
const _latestByDevice = new Map<string, TimestampedFrame>()

export function getLatestFrameForDevice(deviceId: string): TimestampedFrame | null {
  return _latestByDevice.get(deviceId) ?? null
}

/** Monotonic timestamp (ms) of the last frame seen for this device, or null if never. */
export function getLastSeenForDevice(deviceId: string): number | null {
  return _latestByDevice.get(deviceId)?._receivedAt ?? null
}

export const useLiveDataStore = create<LiveDataStoreState>()(
  subscribeWithSelector((set, get) => ({
    currentFrame: null,
    frameBuffer: new RingBuffer<TimestampedFrame>(MAX_BUFFER_SIZE),
    pushFrame: (frame) => {
      const stamped: TimestampedFrame = { ...frame, _receivedAt: performance.now() }
      _latestByDevice.set(frame.id, stamped)
      get().frameBuffer.push(stamped)
      set({ currentFrame: stamped })
    },
    clearBuffer: () => {
      _latestByDevice.clear()
      set({ currentFrame: null, frameBuffer: new RingBuffer<TimestampedFrame>(MAX_BUFFER_SIZE) })
    },
  }))
)
