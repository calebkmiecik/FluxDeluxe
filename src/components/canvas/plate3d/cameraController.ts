/**
 * Camera state machine for the 3D plate canvas.
 *
 * States:
 *   INTRO_SWOOP    — 1.2s perspective→ortho landing on first mount per session
 *   ORTHO_LOCKED   — resting top-down ortho (default interactive state)
 *   PEEK_ORBIT    — user-dragged perspective (clamped elevation)
 *   PEEK_RETURN    — 0.4s eased return to ortho top
 *   ROTATE_ANIMATE — 0.5s plate mesh spin (camera stays put)
 *
 * This module is pure state + time — it does NOT touch three.js.
 * The React component feeds it deltaTime each frame and reads the
 * resulting pose + meshRotation to drive the scene.
 */

import {
  INTRO_SWOOP_MS,
  ROTATE_ANIMATE_MS,
  PEEK_RETURN_MS,
  INTRO_START_AZIMUTH,
  INTRO_START_ELEVATION,
  INTRO_DISTANCE_MULT,
  MIN_PEEK_ELEVATION,
  MAX_ELEVATION,
  easing,
} from './constants'

export type CameraState =
  | 'INTRO_SWOOP'
  | 'ORTHO_LOCKED'
  | 'PEEK_ORBIT'
  | 'PEEK_RETURN'
  | 'ROTATE_ANIMATE'

export interface CameraPose {
  azimuth: number
  elevation: number
  distance: number
  ortho: boolean
}

export interface CameraControllerOptions {
  fitDistance: number // world-space distance to keep plate comfortably framed
}

// Module-level flag — INTRO_SWOOP plays at most once per process lifetime.
let _introPlayedThisSession = false

export function resetIntroSwoopForTesting() {
  _introPlayedThisSession = false
}

const CLAMP = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

export class CameraController {
  state: CameraState
  private fitDistance: number
  private pose: CameraPose
  private meshRotation = 0 // radians, around Y
  private rotationQuadrant: number | null = null // last-known rotation prop
  private liveTesting = false

  // Animation state (valid only when state is a *_ANIMATE / *_SWOOP / *_RETURN)
  private animStart = 0
  private animDuration = 0
  private animFromPose: CameraPose | null = null
  private animToPose: CameraPose | null = null
  private animFromRotation = 0
  private animToRotation = 0

  private elapsedMs = 0

  constructor(opts: CameraControllerOptions) {
    this.fitDistance = opts.fitDistance
    if (_introPlayedThisSession) {
      this.state = 'ORTHO_LOCKED'
      this.pose = this.orthoTop()
    } else {
      this.state = 'INTRO_SWOOP'
      this.pose = this.introStartPose()
      this.animStart = 0
      this.animDuration = INTRO_SWOOP_MS
      this.animFromPose = { ...this.pose }
      this.animToPose = this.orthoTop()
      _introPlayedThisSession = true
    }
  }

  private introStartPose(): CameraPose {
    return {
      azimuth: INTRO_START_AZIMUTH,
      elevation: INTRO_START_ELEVATION,
      distance: this.fitDistance * INTRO_DISTANCE_MULT,
      ortho: false,
    }
  }

  private orthoTop(): CameraPose {
    return {
      azimuth: 0,
      elevation: MAX_ELEVATION,
      distance: this.fitDistance,
      ortho: true,
    }
  }

  /** Feed elapsed ms since last call. Advances animations. */
  update(deltaMs: number) {
    this.elapsedMs += deltaMs

    if (this.state === 'INTRO_SWOOP') {
      this.progressAnim((t) => {
        const e = easing.cubicInOut(t)
        this.pose = this.lerpPose(this.animFromPose!, this.animToPose!, e)
        // Cross from perspective to ortho near end (binary switch at t=0.85)
        this.pose.ortho = t >= 0.85
      }, () => {
        this.state = 'ORTHO_LOCKED'
        this.pose = this.orthoTop()
      })
    } else if (this.state === 'PEEK_RETURN') {
      this.progressAnim((t) => {
        const e = easing.cubicOut(t)
        this.pose = this.lerpPose(this.animFromPose!, this.animToPose!, e)
        this.pose.ortho = t >= 0.9
      }, () => {
        this.state = 'ORTHO_LOCKED'
        this.pose = this.orthoTop()
      })
    } else if (this.state === 'ROTATE_ANIMATE') {
      this.progressAnim((t) => {
        const e = easing.cubicOut(t)
        this.meshRotation = this.animFromRotation + (this.animToRotation - this.animFromRotation) * e
      }, () => {
        this.state = 'ORTHO_LOCKED'
        this.meshRotation = this.animToRotation
      })
    }
  }

  private progressAnim(onTick: (t: number) => void, onComplete: () => void) {
    const t = CLAMP((this.elapsedMs - this.animStart) / this.animDuration, 0, 1)
    onTick(t)
    if (t >= 1) onComplete()
  }

  private lerpPose(a: CameraPose, b: CameraPose, t: number): CameraPose {
    return {
      azimuth: a.azimuth + (b.azimuth - a.azimuth) * t,
      elevation: a.elevation + (b.elevation - a.elevation) * t,
      distance: a.distance + (b.distance - a.distance) * t,
      ortho: a.ortho, // overridden per-state
    }
  }

  beginDrag() {
    if (this.liveTesting) return
    if (this.state !== 'ORTHO_LOCKED' && this.state !== 'PEEK_ORBIT') return
    this.state = 'PEEK_ORBIT'
    this.pose.ortho = false
  }

  /** Called while dragging. dx/dy are raw pixel deltas. */
  applyDrag(dx: number, dy: number) {
    if (this.state !== 'PEEK_ORBIT') return
    this.pose.azimuth -= dx * 0.005
    this.pose.elevation = CLAMP(this.pose.elevation + dy * 0.005, MIN_PEEK_ELEVATION, MAX_ELEVATION)
  }

  dismissPeek() {
    if (this.state !== 'PEEK_ORBIT') return
    this.beginReturnToOrtho()
  }

  private beginReturnToOrtho() {
    this.animStart = this.elapsedMs
    this.animDuration = PEEK_RETURN_MS
    this.animFromPose = { ...this.pose }
    this.animToPose = this.orthoTop()
    this.state = 'PEEK_RETURN'
  }

  setLiveTesting(v: boolean) {
    const wasOff = !this.liveTesting
    this.liveTesting = v
    if (wasOff && v && this.state === 'PEEK_ORBIT') {
      this.beginReturnToOrtho()
    }
  }

  /** Set rotation quadrant (0-3). First call is initial, no animation. */
  setRotation(quadrant: number) {
    const targetRad = quadrant * (Math.PI / 2)
    if (this.rotationQuadrant === null) {
      this.rotationQuadrant = quadrant
      this.meshRotation = targetRad
      return
    }
    if (this.rotationQuadrant === quadrant) return
    this.rotationQuadrant = quadrant
    this.animStart = this.elapsedMs
    this.animDuration = ROTATE_ANIMATE_MS
    this.animFromRotation = this.meshRotation
    this.animToRotation = targetRad
    this.state = 'ROTATE_ANIMATE'
  }

  getPose(): CameraPose {
    return { ...this.pose }
  }

  getMeshRotation(): number {
    return this.meshRotation
  }

  isInteractive(): boolean {
    return this.state === 'ORTHO_LOCKED' || this.state === 'PEEK_ORBIT'
  }

  applyWheelZoom(deltaY: number) {
    const lo = this.fitDistance * (1 - 0.15)
    const hi = this.fitDistance * (1 + 0.15)
    this.pose.distance = CLAMP(this.pose.distance + deltaY * 0.001, lo, hi)
  }
}
