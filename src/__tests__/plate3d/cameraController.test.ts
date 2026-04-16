import { describe, it, expect, beforeEach } from 'vitest'
import { CameraController, resetIntroSwoopForTesting } from '../../components/canvas/plate3d/cameraController'

function makeController() {
  return new CameraController({ fitDistance: 1.0 })
}

describe('CameraController — intro swoop', () => {
  beforeEach(() => resetIntroSwoopForTesting())

  it('first instance enters INTRO_SWOOP state', () => {
    const c = makeController()
    expect(c.state).toBe('INTRO_SWOOP')
  })

  it('second instance in same session skips swoop → ORTHO_LOCKED', () => {
    makeController().update(10000) // first instance completes swoop
    const c2 = makeController()
    expect(c2.state).toBe('ORTHO_LOCKED')
  })

  it('completes after INTRO_SWOOP_MS', () => {
    const c = makeController()
    c.update(1200) // INTRO_SWOOP_MS
    expect(c.state).toBe('ORTHO_LOCKED')
  })

  it('pose at t=0 is perspective intro pose', () => {
    const c = makeController()
    const p = c.getPose()
    expect(p.ortho).toBe(false)
    expect(p.elevation).toBeCloseTo(0.510, 2)
  })

  it('pose at t=INTRO_SWOOP_MS is ortho top', () => {
    const c = makeController()
    c.update(1200)
    const p = c.getPose()
    expect(p.ortho).toBe(true)
    expect(p.elevation).toBeCloseTo(Math.PI / 2, 2)
  })
})

describe('CameraController — drag engagement', () => {
  beforeEach(() => resetIntroSwoopForTesting())

  it('drag engages PEEK_ORBIT from ORTHO_LOCKED', () => {
    const c = makeController()
    c.update(1200) // finish swoop
    c.beginDrag()
    expect(c.state).toBe('PEEK_ORBIT')
  })

  it('drag during liveTesting=true is ignored', () => {
    const c = makeController()
    c.update(1200)
    c.setLiveTesting(true)
    c.beginDrag()
    expect(c.state).toBe('ORTHO_LOCKED')
  })

  it('liveTesting transition false→true during PEEK triggers snap-back', () => {
    const c = makeController()
    c.update(1200)
    c.beginDrag()
    expect(c.state).toBe('PEEK_ORBIT')
    c.setLiveTesting(true)
    expect(c.state).toBe('PEEK_RETURN')
    c.update(400) // PEEK_RETURN_MS
    expect(c.state).toBe('ORTHO_LOCKED')
  })

  it('dismissPeek from PEEK_ORBIT transitions to PEEK_RETURN', () => {
    const c = makeController()
    c.update(1200)
    c.beginDrag()
    c.dismissPeek()
    expect(c.state).toBe('PEEK_RETURN')
  })
})

describe('CameraController — rotation', () => {
  beforeEach(() => resetIntroSwoopForTesting())

  it('meshRotation starts at rotation * π/2 (no animation on initial set)', () => {
    const c = makeController()
    c.update(1200)
    c.setRotation(2) // 180°
    expect(c.getMeshRotation()).toBeCloseTo(Math.PI, 3)
  })

  it('rotation change starts animating without changing camera state', () => {
    const c = makeController()
    c.update(1200) // finish swoop → ORTHO_LOCKED
    c.setRotation(0) // initial
    c.setRotation(1) // change
    expect(c.state).toBe('ORTHO_LOCKED')
    expect(c.isRotating()).toBe(true)
  })

  it('rotation fires from PEEK and leaves camera in PEEK_ORBIT', () => {
    const c = makeController()
    c.update(1200)
    c.setRotation(0)
    c.beginDrag() // → PEEK_ORBIT
    c.setRotation(1)
    expect(c.state).toBe('PEEK_ORBIT')
    expect(c.isRotating()).toBe(true)
    c.update(500) // finish rotation
    expect(c.state).toBe('PEEK_ORBIT') // still peeked!
    expect(c.isRotating()).toBe(false)
  })

  it('rotation animation completes after ROTATE_ANIMATE_MS', () => {
    const c = makeController()
    c.update(1200)
    c.setRotation(0)
    c.setRotation(1)
    c.update(500) // ROTATE_ANIMATE_MS
    expect(c.isRotating()).toBe(false)
    expect(c.getMeshRotation()).toBeCloseTo(Math.PI / 2, 3)
  })
})

describe('CameraController — wheel zoom clamp', () => {
  beforeEach(() => resetIntroSwoopForTesting())

  it('extreme positive wheel deltas cannot exceed fitDistance * 1.15', () => {
    const c = new CameraController({ fitDistance: 1.0 })
    c.update(1200)
    for (let i = 0; i < 100; i++) c.applyWheelZoom(1000)
    expect(c.getPose().distance).toBeCloseTo(1.15, 2)
  })

  it('extreme negative wheel deltas cannot fall below fitDistance * 0.85', () => {
    const c = new CameraController({ fitDistance: 1.0 })
    c.update(1200)
    for (let i = 0; i < 100; i++) c.applyWheelZoom(-1000)
    expect(c.getPose().distance).toBeCloseTo(0.85, 2)
  })

  it('wheel zoom during INTRO_SWOOP is ignored', () => {
    const c = makeController()
    expect(c.state).toBe('INTRO_SWOOP')
    const before = c.getPose().distance
    c.applyWheelZoom(1000)
    expect(c.getPose().distance).toBeCloseTo(before, 5)
  })
})

describe('CameraController — shortest-arc snap-back from peek', () => {
  beforeEach(() => resetIntroSwoopForTesting())

  it('peek return from accumulated azimuth takes shortest arc', () => {
    const c = makeController()
    c.update(1200) // finish swoop → ORTHO_LOCKED
    c.beginDrag() // → PEEK_ORBIT
    // Simulate a lot of dragging: push azimuth to a large negative value
    // (each applyDrag uses dx * 0.005, so dx=-4000 → +20 rad shift).
    // Easier: reach into the pose via applyDrag repeatedly.
    for (let i = 0; i < 1000; i++) c.applyDrag(-10, 0) // accumulates positive azimuth
    const startAz = c.getPose().azimuth
    expect(Math.abs(startAz)).toBeGreaterThan(Math.PI * 4) // several rotations worth

    c.dismissPeek() // → PEEK_RETURN
    // Halfway through the animation, azimuth should have moved by at most π (shortest arc),
    // NOT by half of the accumulated value.
    c.update(200) // 50% of PEEK_RETURN_MS (400ms)
    const halfwayAz = c.getPose().azimuth
    const moved = Math.abs(halfwayAz - startAz)
    expect(moved).toBeLessThan(Math.PI) // shortest-arc at t=0.5 ≤ π/2 ... leave margin

    c.update(200) // finish animation
    expect(c.state).toBe('ORTHO_LOCKED')
    // Final azimuth should be ortho-top's 0, reached via shortest arc
    expect(c.getPose().azimuth).toBeCloseTo(0, 3)
  })
})

describe('CameraController — shortest-arc rotation wrap', () => {
  beforeEach(() => resetIntroSwoopForTesting())

  it('rotating from quadrant 3 → 0 takes +π/2 arc (not -3π/2)', () => {
    const c = makeController()
    c.update(1200)      // finish swoop
    c.setRotation(0)    // initial, no animation
    c.setRotation(3)    // → 3π/2
    c.update(500)       // complete animation
    // meshRotation may be 3π/2 or -π/2 (equivalent), check trig values
    const rotAfter3 = c.getMeshRotation()
    expect(Math.cos(rotAfter3)).toBeCloseTo(0, 3)
    expect(Math.sin(rotAfter3)).toBeCloseTo(-1, 3)

    c.setRotation(0)    // the fourth-rotate-in-a-row scenario
    c.update(250)       // halfway through the animation
    const halfway = c.getMeshRotation()
    // Should have moved forward (positive) by ~π/4, not backward by ~3π/4
    const moved = halfway - rotAfter3
    expect(moved).toBeGreaterThan(0)
    expect(moved).toBeLessThan(Math.PI) // nowhere near 3π/2

    c.update(250)       // finish
    expect(c.isRotating()).toBe(false)
    // Final meshRotation is equivalent to 0 modulo 2π
    const final = c.getMeshRotation()
    expect(Math.cos(final)).toBeCloseTo(1, 3)
    expect(Math.sin(final)).toBeCloseTo(0, 3)
  })
})
