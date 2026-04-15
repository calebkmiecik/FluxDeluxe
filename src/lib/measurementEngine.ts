/**
 * Live Test Measurement Engine
 *
 * Processes incoming force frames and detects:
 * 1. Cell arming (force > threshold for 1s in same cell)
 * 2. Stability (force variance < 3%, COP drift < 100mm for 1s)
 * 3. Capture (emit measurement when stable)
 *
 * Called from the animation frame loop — not a React component.
 */

import type { DeviceFrame } from './types'
import type { CellMeasurement, MeasurementStatus, StageDefinition } from './liveTestTypes'
import {
  ARMING_THRESHOLD_N,
  ARMING_DURATION_MS,
  STABILITY_DURATION_MS,
  STABILITY_FZ_RANGE_PCT,
  STABILITY_FZ_MIN_RANGE_N,
  STABILITY_COP_MAX_MM,
} from './liveTestTypes'
import { PLATE_DIMENSIONS, GRID_DIMS } from './types'
import { getColorBin } from './plateGeometry'

interface SampleWindow {
  fz: number[]
  copX: number[]
  copY: number[]
  timestamps: number[]
}

export class MeasurementEngine {
  private state: 'IDLE' | 'ARMING' | 'MEASURING' = 'IDLE'
  private currentCell: { row: number; col: number } | null = null
  private armStartMs = 0
  private stableStartMs = 0
  private window: SampleWindow = { fz: [], copX: [], copY: [], timestamps: [] }
  private deviceType = '07'
  private onStatusChange: ((status: MeasurementStatus) => void) | null = null
  private onCapture: ((m: CellMeasurement) => void) | null = null
  private doneCells: Set<string> = new Set()

  setCallbacks(
    onStatus: (status: MeasurementStatus) => void,
    onCapture: (m: CellMeasurement) => void,
  ) {
    this.onStatusChange = onStatus
    this.onCapture = onCapture
  }

  setDeviceType(dt: string) { this.deviceType = dt }

  setDoneCells(cells: Set<string>) { this.doneCells = cells }

  reset() {
    this.state = 'IDLE'
    this.currentCell = null
    this.window = { fz: [], copX: [], copY: [], timestamps: [] }
    this.emitStatus({ state: 'IDLE', cell: null, progressMs: 0 })
  }

  /** Call this with each incoming frame for the selected device */
  processFrame(frame: DeviceFrame, stage: StageDefinition) {
    const cell = this.copToCell(frame.cop.x, frame.cop.y)
    const fz = Math.abs(frame.fz)
    const now = frame.time ?? Date.now()

    // Not enough force — reset to idle
    if (fz < ARMING_THRESHOLD_N) {
      if (this.state !== 'IDLE') {
        this.state = 'IDLE'
        this.currentCell = null
        this.window = { fz: [], copX: [], copY: [], timestamps: [] }
        this.emitStatus({ state: 'IDLE', cell: null, progressMs: 0 })
      }
      return
    }

    // Check if cell changed
    if (this.currentCell && (cell.row !== this.currentCell.row || cell.col !== this.currentCell.col)) {
      // Moved to a different cell — reset
      this.state = 'IDLE'
      this.currentCell = null
      this.window = { fz: [], copX: [], copY: [], timestamps: [] }
    }

    // Skip if this cell is already done
    const key = `${stage.index}:${cell.row},${cell.col}`
    if (this.doneCells.has(key)) {
      this.emitStatus({ state: 'IDLE', cell, progressMs: 0, reason: 'Cell already measured' })
      return
    }

    switch (this.state) {
      case 'IDLE': {
        // Start arming
        this.state = 'ARMING'
        this.currentCell = cell
        this.armStartMs = now
        this.window = { fz: [], copX: [], copY: [], timestamps: [] }
        this.emitStatus({ state: 'ARMING', cell, progressMs: 0 })
        break
      }

      case 'ARMING': {
        const elapsed = now - this.armStartMs
        this.emitStatus({ state: 'ARMING', cell, progressMs: Math.min(elapsed, ARMING_DURATION_MS) })

        if (elapsed >= ARMING_DURATION_MS) {
          // Armed — transition to measuring
          this.state = 'MEASURING'
          this.stableStartMs = 0
          this.window = { fz: [], copX: [], copY: [], timestamps: [] }
          this.emitStatus({ state: 'MEASURING', cell, progressMs: 0 })
        }
        break
      }

      case 'MEASURING': {
        // Add sample to window
        this.window.fz.push(frame.fz)
        this.window.copX.push(frame.cop.x * 1000) // m to mm
        this.window.copY.push(frame.cop.y * 1000)
        this.window.timestamps.push(now)

        // Trim window to last 2 seconds of samples
        const cutoff = now - 2000
        while (this.window.timestamps.length > 0 && this.window.timestamps[0] < cutoff) {
          this.window.fz.shift()
          this.window.copX.shift()
          this.window.copY.shift()
          this.window.timestamps.shift()
        }

        // Check stability
        const stable = this.checkStability()

        if (stable.isStable) {
          if (this.stableStartMs === 0) this.stableStartMs = now
          const stableDuration = now - this.stableStartMs

          this.emitStatus({
            state: 'MEASURING',
            cell,
            progressMs: Math.min(stableDuration, STABILITY_DURATION_MS),
            reason: 'Stable — hold...',
          })

          if (stableDuration >= STABILITY_DURATION_MS) {
            // Capture!
            this.captureCell(cell, stage)
          }
        } else {
          this.stableStartMs = 0
          this.emitStatus({
            state: 'MEASURING',
            cell,
            progressMs: 0,
            reason: stable.reason,
          })
        }
        break
      }
    }
  }

  private checkStability(): { isStable: boolean; reason?: string } {
    const { fz, copX, copY } = this.window
    if (fz.length < 10) return { isStable: false, reason: 'Collecting samples...' }

    // Fz range check
    const fzMin = Math.min(...fz)
    const fzMax = Math.max(...fz)
    const fzMean = fz.reduce((a, b) => a + b, 0) / fz.length
    const fzRange = fzMax - fzMin
    const fzThreshold = Math.max(Math.abs(fzMean) * STABILITY_FZ_RANGE_PCT, STABILITY_FZ_MIN_RANGE_N)

    if (fzRange > fzThreshold) {
      return { isStable: false, reason: `Fz range ${fzRange.toFixed(1)}N (need <${fzThreshold.toFixed(1)}N)` }
    }

    // COP displacement check
    const copXMean = copX.reduce((a, b) => a + b, 0) / copX.length
    const copYMean = copY.reduce((a, b) => a + b, 0) / copY.length
    let maxDisp = 0
    for (let i = 0; i < copX.length; i++) {
      const dx = copX[i] - copXMean
      const dy = copY[i] - copYMean
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d > maxDisp) maxDisp = d
    }

    if (maxDisp > STABILITY_COP_MAX_MM) {
      return { isStable: false, reason: `COP drift ${maxDisp.toFixed(0)}mm (need <${STABILITY_COP_MAX_MM}mm)` }
    }

    return { isStable: true }
  }

  private captureCell(cell: { row: number; col: number }, stage: StageDefinition) {
    const { fz } = this.window
    const meanFz = fz.reduce((a, b) => a + b, 0) / fz.length
    const variance = fz.reduce((a, b) => a + (b - meanFz) ** 2, 0) / fz.length
    const stdFz = Math.sqrt(variance)
    const signedErrorN = meanFz - stage.targetN
    const errorN = Math.abs(signedErrorN)
    const errorRatio = stage.toleranceN > 0 ? errorN / stage.toleranceN : 0
    const colorBin = getColorBin(errorRatio)

    const measurement: CellMeasurement = {
      row: cell.row,
      col: cell.col,
      stageIndex: stage.index,
      meanFzN: meanFz,
      stdFzN: stdFz,
      errorN,
      signedErrorN,
      errorRatio,
      colorBin,
      pass: errorRatio <= 1.0,
      timestamp: Date.now(),
    }

    this.onCapture?.(measurement)

    // Reset to idle
    this.state = 'IDLE'
    this.currentCell = null
    this.window = { fz: [], copX: [], copY: [], timestamps: [] }
    this.emitStatus({ state: 'CAPTURED', cell, progressMs: STABILITY_DURATION_MS })

    // Brief pause then back to idle
    setTimeout(() => {
      this.emitStatus({ state: 'IDLE', cell: null, progressMs: 0 })
    }, 500)
  }

  private copToCell(copXM: number, copYM: number): { row: number; col: number } {
    const dims = PLATE_DIMENSIONS[this.deviceType]
    const grid = GRID_DIMS[this.deviceType]
    if (!dims || !grid) return { row: 0, col: 0 }

    const halfW = dims.width / 2
    const halfH = dims.height / 2
    const copXMm = copXM * 1000
    const copYMm = copYM * 1000

    // Map COP (mm, origin center) to grid cell
    const col = Math.floor(((copXMm + halfW) / dims.width) * grid.cols)
    const row = Math.floor(((halfH - copYMm) / dims.height) * grid.rows)

    return {
      row: Math.max(0, Math.min(grid.rows - 1, row)),
      col: Math.max(0, Math.min(grid.cols - 1, col)),
    }
  }

  private emitStatus(status: MeasurementStatus) {
    this.onStatusChange?.(status)
  }
}

// Singleton
export const measurementEngine = new MeasurementEngine()
