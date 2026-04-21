import type { StageType } from './liveTestTypes'

export interface SessionListRow {
  id: string
  started_at: string
  device_id: string
  device_type: string
  tester_name: string
  model_id: string
  body_weight_n: number | null
  n_cells_captured: number
  n_cells_expected: number
  overall_pass_rate: number | null
  session_passed: boolean | null
  device_nickname: string | null
}

export interface SessionDetail {
  session: Record<string, unknown>
  cells: Array<Record<string, unknown>>
  aggregates: Array<Record<string, unknown>>
}

export interface OverviewResult {
  session_count: number
  sessions_passed: number
  cells_captured: number
  device_count: number
  overall_pass_rate: number | null
  /** ISO timestamp of the earliest session in the filtered set (for computing rates). */
  earliest_session_at: string | null
  /** Count of distinct 7-day buckets with at least one session (for per-week rates). */
  active_weeks: number
  /** Mean |error/target| across all cells, as a fraction (0.02 = 2%). `null` if no cells. */
  mae_pct: number | null
  /** Mean (signed_error/target) across all cells, as a fraction. `null` if no cells. */
  signed_error_pct: number | null
  per_stage_type: Array<{
    stage_type: StageType
    mae: number | null
    signed_mean_error: number | null
    std_error: number | null
    pass_rate: number | null
  }>
}
