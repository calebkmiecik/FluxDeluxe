import { create } from 'zustand'
import {
  type LiveTestPhase,
  type StageDefinition,
  type CellMeasurement,
  type SessionMetadata,
  type MeasurementStatus,
  buildStages,
  getGridDims,
} from '../lib/liveTestTypes'
import { getColorBin } from '../lib/plateGeometry'

interface LiveTestState {
  // Phase
  phase: LiveTestPhase

  // Metadata (filled before session start)
  metadata: SessionMetadata | null

  // Stages
  stages: StageDefinition[]
  activeStageIndex: number

  // Grid
  gridRows: number
  gridCols: number

  // Measurements — keyed by "stageIndex:row,col"
  measurements: Map<string, CellMeasurement>

  // Warmup / Tare gate state
  warmupTriggered: boolean
  warmupStartMs: number | null
  tareStartMs: number | null

  // Current measurement engine status (updated from engine)
  measurementStatus: MeasurementStatus

  // Actions
  startSession: (meta: SessionMetadata) => void
  setPhase: (phase: LiveTestPhase) => void
  setActiveStage: (index: number) => void
  advanceStage: () => void
  triggerWarmup: () => void
  startTareCountdown: () => void
  resetTareCountdown: () => void
  setMeasurementStatus: (status: MeasurementStatus) => void
  recordMeasurement: (m: CellMeasurement) => void
  isCellDone: (stageIndex: number, row: number, col: number) => boolean
  getStageCells: (stageIndex: number) => CellMeasurement[]
  getStageProgress: (stageIndex: number) => { done: number; total: number }
  endSession: () => void
}

function cellKey(stageIndex: number, row: number, col: number): string {
  return `${stageIndex}:${row},${col}`
}

export const useLiveTestStore = create<LiveTestState>()((set, get) => ({
  phase: 'IDLE',
  metadata: null,
  stages: [],
  activeStageIndex: 0,
  gridRows: 3,
  gridCols: 3,
  measurements: new Map(),
  warmupTriggered: false,
  warmupStartMs: null,
  tareStartMs: null,
  measurementStatus: { state: 'IDLE', cell: null, progressMs: 0 },

  startSession: (meta) => {
    const stages = buildStages(meta.deviceType, meta.bodyWeightN, meta.dbToleranceN, meta.bwTolerancePct)
    const grid = getGridDims(meta.deviceType)
    set({
      metadata: meta,
      stages,
      activeStageIndex: 0,
      gridRows: grid.rows,
      gridCols: grid.cols,
      measurements: new Map(),
      warmupTriggered: false,
      warmupStartMs: null,
      tareStartMs: null,
      measurementStatus: { state: 'IDLE', cell: null, progressMs: 0 },
      phase: 'WARMUP',
    })
  },

  setPhase: (phase) => set({ phase }),

  setActiveStage: (index) => set({
    activeStageIndex: index,
    measurementStatus: { state: 'IDLE', cell: null, progressMs: 0 },
  }),

  advanceStage: () => {
    const { activeStageIndex, stages } = get()
    if (activeStageIndex < stages.length - 1) {
      set({
        activeStageIndex: activeStageIndex + 1,
        measurementStatus: { state: 'IDLE', cell: null, progressMs: 0 },
      })
    }
  },

  triggerWarmup: () => set({ warmupTriggered: true, warmupStartMs: Date.now() }),
  startTareCountdown: () => set({ tareStartMs: Date.now() }),
  resetTareCountdown: () => set({ tareStartMs: null }),

  setMeasurementStatus: (status) => set({ measurementStatus: status }),

  recordMeasurement: (m) => {
    const measurements = new Map(get().measurements)
    measurements.set(cellKey(m.stageIndex, m.row, m.col), m)
    set({ measurements })
  },

  isCellDone: (stageIndex, row, col) => {
    return get().measurements.has(cellKey(stageIndex, row, col))
  },

  getStageCells: (stageIndex) => {
    const all = get().measurements
    const cells: CellMeasurement[] = []
    all.forEach((m) => {
      if (m.stageIndex === stageIndex) cells.push(m)
    })
    return cells
  },

  getStageProgress: (stageIndex) => {
    const { gridRows, gridCols } = get()
    const total = gridRows * gridCols
    const done = get().getStageCells(stageIndex).length
    return { done, total }
  },

  endSession: () => set({
    phase: 'SUMMARY',
    measurementStatus: { state: 'IDLE', cell: null, progressMs: 0 },
  }),
}))
