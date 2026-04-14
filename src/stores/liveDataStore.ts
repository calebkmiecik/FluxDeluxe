import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { DeviceFrame } from '../lib/types'

const MAX_BUFFER_SIZE = 300 // ~5 seconds at 60fps

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

interface LiveDataStoreState {
  currentFrame: DeviceFrame | null
  frameBuffer: RingBuffer<DeviceFrame>
  pushFrame: (frame: DeviceFrame) => void
  clearBuffer: () => void
}

export const useLiveDataStore = create<LiveDataStoreState>()(
  subscribeWithSelector((set, get) => ({
    currentFrame: null,
    frameBuffer: new RingBuffer<DeviceFrame>(MAX_BUFFER_SIZE),
    pushFrame: (frame) => {
      get().frameBuffer.push(frame)
      set({ currentFrame: frame })
    },
    clearBuffer: () => set({ currentFrame: null, frameBuffer: new RingBuffer<DeviceFrame>(MAX_BUFFER_SIZE) }),
  }))
)
