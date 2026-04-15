import { describe, it, expect } from 'vitest'
import { MeasurementEngine } from './measurementEngine'
import type { StageDefinition } from './liveTestTypes'
import type { DeviceFrame } from './types'

// Helper: build a minimal DeviceFrame. Note the engine's internal window
// stores frame.fz verbatim (signed), but armaing uses |fz| >= 50N.
function frame(fz: number, copX = 0, copY = 0, t = 0): DeviceFrame {
  return {
    time: t,
    fx: 0, fy: 0, fz,
    mx: 0, my: 0, mz: 0,
    cop: { x: copX, y: copY },
  } as DeviceFrame
}

describe('MeasurementEngine signedErrorN', () => {
  it('records signed_error_n as (meanFz - target), preserving direction', () => {
    const engine = new MeasurementEngine()
    // target 100N; we feed fz=90 so meanFz≈90, signedError = 90 - 100 = -10
    const stage: StageDefinition = {
      index: 0, name: 'DB', type: 'dumbbell', location: 'A',
      targetN: 100, toleranceN: 10,
    }
    const captures: any[] = []
    engine.setCallbacks(() => {}, (m) => captures.push(m))
    engine.setDeviceType('07')

    // Positive Fz above the arming threshold (50N), stable enough to capture.
    // 10 ms cadence for 3s → 1s arming + 1s stability + margin.
    for (let t = 0; t < 3000; t += 10) {
      engine.processFrame(frame(90, 0, 0, t), stage)
    }

    expect(captures.length).toBeGreaterThan(0)
    const m = captures[0]
    expect(m.meanFzN).toBeCloseTo(90, 1)
    expect(m.signedErrorN).toBeCloseTo(-10, 1)      // direction preserved
    expect(m.errorN).toBeCloseTo(10, 1)             // magnitude
    expect(m.errorN).toBeCloseTo(Math.abs(m.signedErrorN), 5)
  })
})
