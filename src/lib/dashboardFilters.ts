/**
 * Dashboard filter state + helpers.
 *
 * A single `DashboardFilters` object is threaded from the DashboardPage to
 * DashboardOverview and SessionList. The liveTestClient passes it to the
 * IPC layer verbatim, and the main-process repo translates it into
 * Supabase queries.
 */

import type { DeviceFamily } from './deviceFamily'
import { familyToDeviceTypes } from './deviceFamily'

export type TimePreset = 'all' | '7d' | '30d' | '90d' | 'ytd' | 'custom'

export interface DashboardFilters {
  timePreset: TimePreset
  /** Used only when `timePreset === 'custom'`. ISO `YYYY-MM-DD` (local). */
  timeFrom: string | null
  /** Used only when `timePreset === 'custom'`. ISO `YYYY-MM-DD` (local). */
  timeTo: string | null
  /** `null` = all families */
  deviceFamily: DeviceFamily | null
  /** Body weight in Newtons, inclusive. `null` = unbounded. */
  weightMinN: number | null
  weightMaxN: number | null
  /** Pass/fail filter. `null` = show all. */
  passFilter: 'pass' | 'fail' | null
  /**
   * Tag-based search. Each tag is AND'd. Matched against device_id, tester_name,
   * device_nickname, model_id, family label.
   */
  searchTags: string[]
}

export const DEFAULT_FILTERS: DashboardFilters = {
  timePreset: 'all',
  timeFrom: null,
  timeTo: null,
  deviceFamily: null,
  weightMinN: null,
  weightMaxN: null,
  passFilter: null,
  searchTags: [],
}

export function isDefaultFilters(f: DashboardFilters): boolean {
  return (
    f.timePreset === 'all' &&
    f.deviceFamily === null &&
    f.weightMinN === null &&
    f.weightMaxN === null &&
    f.passFilter === null &&
    f.searchTags.length === 0
  )
}

/**
 * Resolve the active time window to concrete ISO timestamps.
 * Returns `{from: null, to: null}` when no time constraint applies.
 */
export function effectiveTimeRange(f: DashboardFilters): { fromIso: string | null; toIso: string | null } {
  const now = new Date()
  switch (f.timePreset) {
    case 'all':
      return { fromIso: null, toIso: null }
    case '7d':
      return { fromIso: new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString(), toIso: null }
    case '30d':
      return { fromIso: new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString(), toIso: null }
    case '90d':
      return { fromIso: new Date(now.getTime() - 90 * 24 * 3600 * 1000).toISOString(), toIso: null }
    case 'ytd': {
      const y = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0)
      return { fromIso: y.toISOString(), toIso: null }
    }
    case 'custom':
      return {
        fromIso: f.timeFrom ? new Date(f.timeFrom + 'T00:00:00').toISOString() : null,
        toIso: f.timeTo ? new Date(f.timeTo + 'T23:59:59').toISOString() : null,
      }
  }
}

/** Resolve the filter's device_type codes, or `null` for "no family constraint". */
export function effectiveDeviceTypes(f: DashboardFilters): string[] | null {
  return f.deviceFamily ? familyToDeviceTypes(f.deviceFamily) : null
}

/** Short human-readable label for "compared to the prior equivalent window". */
export function priorWindowLabel(f: DashboardFilters): string {
  switch (f.timePreset) {
    case '7d':    return 'vs prior 7d'
    case '30d':   return 'vs prior 30d'
    case '90d':   return 'vs prior 90d'
    case 'ytd':   return 'vs prior YTD'
    case 'custom': return 'vs prior period'
    default:      return 'vs prior'
  }
}

/**
 * Returns a copy of the filter with the time constraint stripped.
 * Used to fetch the "all-time baseline" for the current non-time filter set
 * (device / weight / pass-fail / search still apply).
 */
export function withAllTime(f: DashboardFilters): DashboardFilters {
  return { ...f, timePreset: 'all', timeFrom: null, timeTo: null }
}

/**
 * Returns a copy of the filter shifted to the equivalent prior time window.
 * 7d selected → prior 7d (i.e. 14-to-7 days ago). Custom → same-length window
 * immediately before `timeFrom`. Returns `null` for All-time or when the
 * current time range can't be resolved (no comparison basis).
 */
export function priorEquivalentFilter(f: DashboardFilters): DashboardFilters | null {
  if (f.timePreset === 'all') return null
  const { fromIso, toIso } = effectiveTimeRange(f)
  if (!fromIso) return null
  const from = new Date(fromIso).getTime()
  const to = toIso ? new Date(toIso).getTime() : Date.now()
  const span = to - from
  if (span <= 0) return null
  const priorTo = new Date(from)
  const priorFrom = new Date(from - span)
  return {
    ...f,
    timePreset: 'custom',
    timeFrom: priorFrom.toISOString().slice(0, 10),
    timeTo: priorTo.toISOString().slice(0, 10),
  }
}
