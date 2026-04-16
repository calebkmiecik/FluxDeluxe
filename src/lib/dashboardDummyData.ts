/**
 * Dummy data for Dashboard preview.
 *
 * When enabled, installs a dummy implementation on `liveTestClient` so the
 * Dashboard components see a realistic body of sessions without touching
 * Supabase or requiring the migration to be applied. Writes are NOT mocked.
 */

import type {
  SessionListRow,
  SessionDetail,
  OverviewResult,
} from './liveTestRepoTypes'
import { setDummyImpl } from './liveTestClient'
import type { DashboardFilters } from './dashboardFilters'
import { effectiveTimeRange, effectiveDeviceTypes } from './dashboardFilters'
import { deviceTypeToFamily } from './deviceFamily'

// ── Realistic session generator ────────────────────────────────

interface StageSpec {
  index: number
  name: string
  type: 'dumbbell' | 'two_leg' | 'one_leg'
  location: 'A' | 'B'
  targetN: number
}

function stageSpecs(bodyWeightN: number): StageSpec[] {
  return [
    { index: 0, name: '45 lb Dumbbell', type: 'dumbbell', location: 'A', targetN: 206.3 },
    { index: 1, name: 'Two Leg',        type: 'two_leg',  location: 'A', targetN: bodyWeightN },
    { index: 2, name: 'One Leg',        type: 'one_leg',  location: 'A', targetN: bodyWeightN },
    { index: 3, name: '45 lb Dumbbell', type: 'dumbbell', location: 'B', targetN: 206.3 },
    { index: 4, name: 'Two Leg',        type: 'two_leg',  location: 'B', targetN: bodyWeightN },
    { index: 5, name: 'One Leg',        type: 'one_leg',  location: 'B', targetN: bodyWeightN },
  ]
}

function mulberry32(seed: number) {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6D2B79F5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function colorBinFor(errorRatio: number): string {
  if (errorRatio <= 0.5) return 'green'
  if (errorRatio <= 0.75) return 'light_green'
  if (errorRatio <= 1.0) return 'yellow'
  if (errorRatio <= 1.5) return 'orange'
  return 'red'
}

interface FakeProfile {
  /** stddev of signed error as fraction of target, per stage type */
  spread: { dumbbell: number; two_leg: number; one_leg: number }
  /** mean bias as fraction of target, per stage type */
  bias:   { dumbbell: number; two_leg: number; one_leg: number }
  /** pass threshold scale — lower = fewer passes */
  cleanliness: number
}

interface FakeSessionSpec {
  id: string
  deviceId: string
  deviceNickname: string | null
  deviceType: string
  testerName: string
  modelId: string
  bodyWeightN: number
  startedAt: string
  profile: FakeProfile
  skip?: { stageIndex: number; cells: Array<[number, number]> }[] // cells NOT captured
}

const PROFILES: Record<string, FakeProfile> = {
  great: {
    spread: { dumbbell: 0.008, two_leg: 0.012, one_leg: 0.018 },
    bias:   { dumbbell: -0.001, two_leg: 0.002, one_leg: -0.004 },
    cleanliness: 1.0,
  },
  solid: {
    spread: { dumbbell: 0.012, two_leg: 0.018, one_leg: 0.025 },
    bias:   { dumbbell: 0.003, two_leg: -0.006, one_leg: 0.008 },
    cleanliness: 0.92,
  },
  drifting: {
    spread: { dumbbell: 0.018, two_leg: 0.028, one_leg: 0.040 },
    bias:   { dumbbell: 0.012, two_leg: 0.018, one_leg: -0.015 },
    cleanliness: 0.78,
  },
}

function daysAgoIso(d: number, hourOffset = 0): string {
  const t = Date.now() - d * 24 * 3600 * 1000 + hourOffset * 3600 * 1000
  return new Date(t).toISOString()
}

const SESSION_SPECS: FakeSessionSpec[] = [
  // Recent week — active, all 4 families represented
  { id: 'dummy-001', deviceId: 'AXF-07-0123', deviceNickname: 'Plate A (lab)',   deviceType: '07', testerName: 'caleb',  modelId: 'v2.1', bodyWeightN: 780, startedAt: daysAgoIso(0, -2),  profile: PROFILES.great },
  { id: 'dummy-002', deviceId: 'AXF-07-0123', deviceNickname: 'Plate A (lab)',   deviceType: '07', testerName: 'caleb',  modelId: 'v2.1', bodyWeightN: 780, startedAt: daysAgoIso(0, -6),  profile: PROFILES.solid },
  { id: 'dummy-003', deviceId: 'AXF-11-0045', deviceNickname: null,              deviceType: '11', testerName: 'jane',   modelId: 'v2.0', bodyWeightN: 620, startedAt: daysAgoIso(1, -3),  profile: PROFILES.solid },
  { id: 'dummy-004', deviceId: 'AXF-11-0045', deviceNickname: null,              deviceType: '11', testerName: 'jane',   modelId: 'v2.0', bodyWeightN: 620, startedAt: daysAgoIso(2, -4),  profile: PROFILES.drifting,
    skip: [{ stageIndex: 5, cells: [[0,0],[0,1],[0,2],[1,0],[1,1],[1,2],[2,0]] }] /* only 2 cells captured in 1L-B */ },
  { id: 'dummy-005', deviceId: 'AXF-08-0302', deviceNickname: 'Plate C (QA)',    deviceType: '08', testerName: 'marcus', modelId: 'v2.1', bodyWeightN: 890, startedAt: daysAgoIso(3, -1),  profile: PROFILES.great },
  { id: 'dummy-006', deviceId: 'AXF-07-0123', deviceNickname: 'Plate A (lab)',   deviceType: '07', testerName: 'caleb',  modelId: 'v2.1', bodyWeightN: 780, startedAt: daysAgoIso(4, -5),  profile: PROFILES.solid },
  { id: 'dummy-007', deviceId: 'AXF-06-0011', deviceNickname: 'Lite bench',      deviceType: '06', testerName: 'alex',   modelId: 'v2.1', bodyWeightN: 710, startedAt: daysAgoIso(5, -8),  profile: PROFILES.great },
  { id: 'dummy-008', deviceId: 'AXF-08-0302', deviceNickname: 'Plate C (QA)',    deviceType: '08', testerName: 'marcus', modelId: 'v2.1', bodyWeightN: 890, startedAt: daysAgoIso(6, -2),  profile: PROFILES.drifting },
  { id: 'dummy-009', deviceId: 'AXF-06-0011', deviceNickname: 'Lite bench',      deviceType: '06', testerName: 'alex',   modelId: 'v2.0', bodyWeightN: 710, startedAt: daysAgoIso(6, -10), profile: PROFILES.solid },
  // Older — shows 30d vs 7d range makes a difference
  { id: 'dummy-010', deviceId: 'AXF-11-0045', deviceNickname: null,              deviceType: '11', testerName: 'jane',   modelId: 'v1.9', bodyWeightN: 620, startedAt: daysAgoIso(10, 0),  profile: PROFILES.great },
  { id: 'dummy-011', deviceId: 'AXF-07-0123', deviceNickname: 'Plate A (lab)',   deviceType: '07', testerName: 'caleb',  modelId: 'v2.0', bodyWeightN: 780, startedAt: daysAgoIso(14, 0),  profile: PROFILES.solid },
  { id: 'dummy-012', deviceId: 'AXF-08-0302', deviceNickname: 'Plate C (QA)',    deviceType: '08', testerName: 'marcus', modelId: 'v1.9', bodyWeightN: 890, startedAt: daysAgoIso(22, 0),  profile: PROFILES.drifting },
  { id: 'dummy-013', deviceId: 'AXF-06-0011', deviceNickname: 'Lite bench',      deviceType: '06', testerName: 'alex',   modelId: 'v1.9', bodyWeightN: 710, startedAt: daysAgoIso(35, 0),  profile: PROFILES.solid },
  { id: 'dummy-014', deviceId: 'AXF-07-0123', deviceNickname: 'Plate A (lab)',   deviceType: '07', testerName: 'caleb',  modelId: 'v1.9', bodyWeightN: 780, startedAt: daysAgoIso(40, 0),  profile: PROFILES.great },
  { id: 'dummy-015', deviceId: 'AXF-11-0045', deviceNickname: null,              deviceType: '11', testerName: 'jane',   modelId: 'v1.8', bodyWeightN: 620, startedAt: daysAgoIso(55, 0),  profile: PROFILES.solid },
]

interface BuiltSession {
  listRow: SessionListRow
  detail: SessionDetail
  /** Precomputed per-stage-type aggregate rows, for use in the overview rollup */
  aggRows: Array<{ stage_type: 'dumbbell' | 'two_leg' | 'one_leg'; n_cells: number; mae: number | null; signed_mean_error: number | null; std_error: number | null; pass_rate: number | null }>
  /** Total cells captured (for overview cells tile) */
  n_cells_captured: number
  /** Overall pass rate (for overview pass-rate tile) */
  overall_pass_rate: number | null
  /** Session-level pass/fail determined by threshold */
  session_passed: boolean | null
  /** Per-cell |error/target| ratios, for computing overview mae_pct */
  cellErrorPcts: number[]
  /** Per-cell signed_error/target ratios, for computing overview signed_error_pct */
  cellSignedPcts: number[]
}

function buildSession(spec: FakeSessionSpec): BuiltSession {
  const gridRows = 3
  const gridCols = 3
  const stages = stageSpecs(spec.bodyWeightN)
  const rnd = mulberry32(hash(spec.id))

  const skipMap = new Map<number, Set<string>>()
  for (const s of spec.skip ?? []) skipMap.set(s.stageIndex, new Set(s.cells.map(([r, c]) => `${r},${c}`)))

  // Generate cells per stage
  const cells: Array<Record<string, unknown>> = []
  const capturedByStageType: Record<'dumbbell'|'two_leg'|'one_leg', Array<{ errorN: number; signedErrorN: number; pass: boolean }>> = {
    dumbbell: [], two_leg: [], one_leg: [],
  }
  const cellErrorPcts: number[] = []
  const cellSignedPcts: number[] = []
  let totalCaptured = 0
  let totalPassed = 0

  for (const stage of stages) {
    const toleranceN = stage.type === 'dumbbell' ? 6 : spec.bodyWeightN * 0.015
    const biasFrac = spec.profile.bias[stage.type]
    const spreadFrac = spec.profile.spread[stage.type]
    const skipSet = skipMap.get(stage.index)
    for (let row = 0; row < gridRows; row++) {
      for (let col = 0; col < gridCols; col++) {
        if (skipSet?.has(`${row},${col}`)) continue

        // Signed error drawn from N(bias*target, spread*target) using Box–Muller-ish
        const u1 = Math.max(1e-6, rnd())
        const u2 = rnd()
        const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
        const signedErrorN = biasFrac * stage.targetN + spreadFrac * stage.targetN * gauss * 0.6
        const errorN = Math.abs(signedErrorN)
        const errorRatio = toleranceN > 0 ? errorN / toleranceN : 0
        const pass = errorRatio <= spec.profile.cleanliness
        const colorBin = colorBinFor(errorRatio)
        const meanFzN = stage.targetN + signedErrorN
        const stdFzN = Math.abs(spreadFrac * stage.targetN * 0.3) // cosmetic
        const captured_at = spec.startedAt

        cells.push({
          id: `${spec.id}-${stage.index}-${row}-${col}`,
          session_id: spec.id,
          stage_index: stage.index,
          stage_name: stage.name,
          stage_type: stage.type,
          stage_location: stage.location,
          target_n: stage.targetN,
          tolerance_n: toleranceN,
          row, col,
          mean_fz_n: meanFzN,
          std_fz_n: stdFzN,
          error_n: errorN,
          signed_error_n: signedErrorN,
          error_ratio: errorRatio,
          color_bin: colorBin,
          pass,
          captured_at,
        })
        capturedByStageType[stage.type].push({ errorN, signedErrorN, pass })
        if (stage.targetN > 0) {
          cellErrorPcts.push(errorN / stage.targetN)
          cellSignedPcts.push(signedErrorN / stage.targetN)
        }
        totalCaptured++
        if (pass) totalPassed++
      }
    }
  }

  // Aggregates per stage type
  const aggRows = (['dumbbell', 'two_leg', 'one_leg'] as const).map((stage_type) => {
    const bucket = capturedByStageType[stage_type]
    const n_cells = bucket.length
    if (n_cells === 0) return { stage_type, n_cells: 0, mae: null, signed_mean_error: null, std_error: null, pass_rate: null }
    const mae = bucket.reduce((s, c) => s + c.errorN, 0) / n_cells
    const signedMean = bucket.reduce((s, c) => s + c.signedErrorN, 0) / n_cells
    const variance = bucket.reduce((s, c) => s + (c.signedErrorN - signedMean) ** 2, 0) / n_cells
    return {
      stage_type,
      n_cells,
      mae,
      signed_mean_error: signedMean,
      std_error: Math.sqrt(variance),
      pass_rate: bucket.filter((c) => c.pass).length / n_cells,
    }
  })

  const n_cells_expected = gridRows * gridCols * 6
  const overall_pass_rate = totalCaptured === 0 ? null : totalPassed / totalCaptured
  // Default pass threshold: 85% of cells within tolerance
  const PASS_THRESHOLD = 0.85
  const session_passed = overall_pass_rate === null ? null : overall_pass_rate >= PASS_THRESHOLD

  const sessionRow = {
    id: spec.id,
    started_at: spec.startedAt,
    ended_at: spec.startedAt,
    device_id: spec.deviceId,
    device_type: spec.deviceType,
    model_id: spec.modelId,
    tester_name: spec.testerName,
    body_weight_n: spec.bodyWeightN,
    grid_rows: gridRows,
    grid_cols: gridCols,
    n_cells_captured: totalCaptured,
    n_cells_expected,
    overall_pass_rate,
    session_passed,
    app_version: 'dummy',
  }

  const listRow: SessionListRow = {
    id: spec.id,
    started_at: spec.startedAt,
    device_id: spec.deviceId,
    device_type: spec.deviceType,
    tester_name: spec.testerName,
    model_id: spec.modelId,
    body_weight_n: spec.bodyWeightN,
    n_cells_captured: totalCaptured,
    n_cells_expected,
    overall_pass_rate,
    session_passed,
    device_nickname: spec.deviceNickname,
  }

  const detail: SessionDetail = {
    session: sessionRow as unknown as Record<string, unknown>,
    cells,
    aggregates: aggRows.map((a) => ({ session_id: spec.id, ...a } as unknown as Record<string, unknown>)),
  }

  return { listRow, detail, aggRows, n_cells_captured: totalCaptured, overall_pass_rate, session_passed, cellErrorPcts, cellSignedPcts }
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

// Build all sessions up-front so list/detail/overview are consistent
const BUILT: BuiltSession[] = SESSION_SPECS
  .map(buildSession)
  .sort((a, b) => b.listRow.started_at.localeCompare(a.listRow.started_at))

const DETAIL_BY_ID = new Map<string, SessionDetail>(BUILT.map((b) => [b.listRow.id, b.detail]))

function applyFilter(filter: DashboardFilters): BuiltSession[] {
  const { fromIso, toIso } = effectiveTimeRange(filter)
  const types = effectiveDeviceTypes(filter)
  const tags = filter.searchTags.map((t) => t.trim().toLowerCase()).filter(Boolean)

  return BUILT.filter((b) => {
    const t = new Date(b.listRow.started_at).getTime()
    if (fromIso && t < new Date(fromIso).getTime()) return false
    if (toIso && t > new Date(toIso).getTime()) return false

    if (types && !types.includes(b.listRow.device_type)) return false

    const weight = b.listRow.body_weight_n
    if (filter.weightMinN !== null && (weight === null || weight < filter.weightMinN)) return false
    if (filter.weightMaxN !== null && (weight === null || weight > filter.weightMaxN)) return false

    if (filter.passFilter === 'pass' && b.session_passed !== true) return false
    if (filter.passFilter === 'fail' && b.session_passed !== false) return false

    // All tags must match (AND logic)
    for (const tag of tags) {
      // Free-text tag — match against metadata fields
      const family = deviceTypeToFamily(b.listRow.device_type) ?? ''
      const hay = [
        b.listRow.device_id,
        b.listRow.device_nickname ?? '',
        b.listRow.tester_name,
        b.listRow.model_id,
        b.listRow.device_type,
        family,
      ].join(' ').toLowerCase()
      if (!hay.includes(tag)) return false
    }

    return true
  })
}

function buildOverview(filter: DashboardFilters): OverviewResult {
  const subset = applyFilter(filter)
  const session_count = subset.length
  const cells_captured = subset.reduce((s, b) => s + b.n_cells_captured, 0)
  const passRates = subset.map((b) => b.overall_pass_rate).filter((x): x is number => x !== null)
  const overall_pass_rate = passRates.length === 0 ? null : passRates.reduce((a, b) => a + b, 0) / passRates.length
  const device_count = new Set(subset.map((b) => b.listRow.device_id)).size

  const per_stage_type = (['dumbbell', 'two_leg', 'one_leg'] as const).map((stage_type) => {
    const rows = subset.flatMap((b) => b.aggRows).filter((r) => r.stage_type === stage_type && r.n_cells > 0)
    const avg = (key: 'mae' | 'signed_mean_error' | 'std_error' | 'pass_rate') =>
      rows.length === 0 ? null : rows.reduce((s, r) => s + (r[key] as number), 0) / rows.length
    return {
      stage_type,
      mae: avg('mae'),
      signed_mean_error: avg('signed_mean_error'),
      std_error: avg('std_error'),
      pass_rate: avg('pass_rate'),
    }
  })

  // Compute % error metrics from per-cell error/target ratios
  const allErrorPcts = subset.flatMap((b) => b.cellErrorPcts)
  const allSignedPcts = subset.flatMap((b) => b.cellSignedPcts)
  const mae_pct = allErrorPcts.length === 0 ? null : allErrorPcts.reduce((a, b) => a + b, 0) / allErrorPcts.length
  const signed_error_pct = allSignedPcts.length === 0 ? null : allSignedPcts.reduce((a, b) => a + b, 0) / allSignedPcts.length

  return { session_count, cells_captured, device_count, overall_pass_rate, mae_pct, signed_error_pct, per_stage_type }
}

// ── Enable / disable ──────────────────────────────────────────

export function enableDummy(): void {
  setDummyImpl({
    getOverview: async ({ filter }: { filter: DashboardFilters }) => buildOverview(filter),
    listSessions: async ({ limit, offset, filter }: { limit: number; offset: number; filter: DashboardFilters }) =>
      applyFilter(filter).slice(offset, offset + limit).map((b) => b.listRow),
    getSession: async (id: string) => DETAIL_BY_ID.get(id) ?? null,
    queueStatus: async () => ({ queued: 0, poison: 0 }),
    retryQueued: async () => ({ uploaded: 0, stillQueued: 0, errors: [] }),
  })
}

export function disableDummy(): void {
  setDummyImpl(null)
}
