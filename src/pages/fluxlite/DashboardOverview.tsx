import { useEffect, useState } from 'react'
import type { OverviewResult } from '../../lib/liveTestRepoTypes'
import { liveTestClient } from '../../lib/liveTestClient'
import type { DashboardFilters } from '../../lib/dashboardFilters'
import { effectiveTimeRange } from '../../lib/dashboardFilters'

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white/[0.02] border border-border rounded-md p-3">
      <div className="telemetry-label">{label}</div>
      <div className="text-xl font-semibold text-foreground mt-0.5">{value}</div>
      {sub && <div className="text-muted-foreground text-xs mt-1">{sub}</div>}
    </div>
  )
}

function fmtN(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined) return '—'
  return `${n.toFixed(digits)}N`
}
function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return `${(n * 100).toFixed(1)}%`
}
function fmtSignedPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  const pct = n * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
}

export function DashboardOverview({ filter }: { filter: DashboardFilters }) {
  const [data, setData] = useState<OverviewResult | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    liveTestClient.getOverview({ filter }).then((res) => {
      if (!cancelled) {
        setData(res)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [filter])

  const stageTile = (type: 'dumbbell' | 'two_leg' | 'one_leg', label: string) => {
    const r = data?.per_stage_type.find((p) => p.stage_type === type)
    return (
      <div className="bg-white/[0.02] border border-border rounded-md p-3">
        <div className="telemetry-label">{label}</div>
        <div className="flex items-baseline gap-2 mt-0.5">
          <span className="text-lg font-semibold text-foreground">MAE {fmtN(r?.mae ?? null)}</span>
          <span className="text-xs text-muted-foreground">pass {fmtPct(r?.pass_rate ?? null)}</span>
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          bias {fmtN(r?.signed_mean_error ?? null)} / std {fmtN(r?.std_error ?? null)}
        </div>
      </div>
    )
  }

  // Compute passed-per-week from earliest session to now (or the time range bounds)
  const passedPerWeek = (() => {
    if (loading || !data || data.sessions_passed === 0) return null
    const { fromIso } = effectiveTimeRange(filter)
    // Use whichever is later: the filter's from-date or the earliest session
    const rangeStart = fromIso
      ? new Date(Math.max(new Date(fromIso).getTime(), data.earliest_session_at ? new Date(data.earliest_session_at).getTime() : 0))
      : data.earliest_session_at ? new Date(data.earliest_session_at) : null
    if (!rangeStart) return null
    // Minimum denominator = 3 days (in weeks) so short spans don't blow up the rate
    const weeks = Math.max((Date.now() - rangeStart.getTime()) / (7 * 24 * 3600 * 1000), 3 / 7)
    return data.sessions_passed / weeks
  })()

  return (
    <div className="flex flex-col gap-3">
      <h3 className="telemetry-label">Overview</h3>
      <div className="grid grid-cols-5 gap-2">
        <Tile label="Devices"  value={loading ? '…' : String(data?.device_count ?? 0)} />
        <Tile label="Sessions" value={loading ? '…' : String(data?.session_count ?? 0)} />
        <Tile label="Passed / week" value={loading ? '…' : passedPerWeek !== null ? passedPerWeek.toFixed(1) : '—'} />
        <Tile label="Pass rate" value={loading ? '…' : fmtPct(data?.overall_pass_rate ?? null)} />
        <Tile
          label="Accuracy"
          value={loading ? '…' : `${fmtPct(data?.mae_pct ?? null)} MAE  /  ${fmtSignedPct(data?.signed_error_pct ?? null)} signed`}
        />
      </div>

      <h3 className="telemetry-label mt-1">By stage type</h3>
      <div className="grid grid-cols-3 gap-2">
        {stageTile('dumbbell', 'Dumbbell')}
        {stageTile('two_leg',  'Two-leg')}
        {stageTile('one_leg',  'One-leg')}
      </div>
    </div>
  )
}
