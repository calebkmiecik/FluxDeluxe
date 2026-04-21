import { useEffect, useState, type ReactNode } from 'react'
import type { OverviewResult } from '../../lib/liveTestRepoTypes'
import { liveTestClient } from '../../lib/liveTestClient'
import type { DashboardFilters } from '../../lib/dashboardFilters'
import { effectiveTimeRange, priorEquivalentFilter, withAllTime } from '../../lib/dashboardFilters'

const MIN_PRIOR_SESSIONS = 2

type DeltaDirection = 'up' | 'down' | 'flat'
interface Delta {
  text: string
  direction: DeltaDirection
  /** true = this direction is a good outcome (renders green). false = bad (red). */
  goodWhen: DeltaDirection
  tooltip: string
}

function Tile({ label, value, delta, baseline, sub }: {
  label: string
  value: ReactNode
  delta?: Delta | null
  baseline?: string | null
  sub?: string
}) {
  return (
    <div className="relative bg-white/[0.02] border border-border rounded-md px-4 py-4">
      {(baseline || delta) && (
        <div className="absolute top-3 right-3 flex flex-col items-end gap-0.5 pointer-events-none">
          {baseline && (
            <span className="text-muted-foreground text-[11px] tracking-wider font-medium pointer-events-auto">
              {baseline}
            </span>
          )}
          {delta && <div className="pointer-events-auto"><DeltaPill delta={delta} /></div>}
        </div>
      )}
      <div className="telemetry-label pr-24">{label}</div>
      <div className="text-3xl font-semibold text-foreground leading-none mt-2">{value}</div>
      {sub && <div className="text-muted-foreground text-xs mt-1.5">{sub}</div>}
    </div>
  )
}

function DeltaPill({ delta }: { delta: Delta }) {
  const isGood =
    delta.direction === 'flat'
      ? true
      : delta.direction === delta.goodWhen
  const color =
    delta.direction === 'flat'
      ? 'text-muted-foreground'
      : isGood ? 'text-success' : 'text-danger'
  const arrow =
    delta.direction === 'up' ? '▲' :
    delta.direction === 'down' ? '▼' :
    '·'
  return (
    <span className={`${color} text-[11px] font-medium tracking-wider`} title={delta.tooltip}>
      {arrow} {delta.text}
    </span>
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

/** Join non-null strings with a bullet separator. Returns undefined if empty. */
function joinSub(...parts: Array<string | null | undefined>): string | undefined {
  const kept = parts.filter((p): p is string => !!p)
  if (kept.length === 0) return undefined
  return kept.join(' · ')
}

/** Compute direction from a signed delta. */
function directionOf(signedDelta: number, epsilon = 0): DeltaDirection {
  if (signedDelta > epsilon) return 'up'
  if (signedDelta < -epsilon) return 'down'
  return 'flat'
}

export function DashboardOverview({ filter }: { filter: DashboardFilters }) {
  const [data, setData] = useState<OverviewResult | null>(null)
  const [priorData, setPriorData] = useState<OverviewResult | null>(null)
  const [baselineData, setBaselineData] = useState<OverviewResult | null>(null)
  const [loading, setLoading] = useState(true)

  const isAllTime = filter.timePreset === 'all'

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const prior = priorEquivalentFilter(filter)
    const currentP = liveTestClient.getOverview({ filter })
    const priorP = prior ? liveTestClient.getOverview({ filter: prior }) : Promise.resolve(null)
    // Baseline = same filter without time bounds. Skip when filter is already all-time.
    const baselineP = isAllTime
      ? Promise.resolve(null)
      : liveTestClient.getOverview({ filter: withAllTime(filter) })
    Promise.all([currentP, priorP, baselineP]).then(([cur, pri, base]) => {
      if (cancelled) return
      setData(cur)
      setPriorData(pri)
      setBaselineData(base)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [filter, isAllTime])

  // Plates-passed-per-week rate (for subtitle)
  const passedPerWeek = (() => {
    if (loading || !data || data.sessions_passed === 0) return null
    const { fromIso, toIso } = effectiveTimeRange(filter)
    let spanMs: number | null = null
    if (fromIso) {
      spanMs = (toIso ? new Date(toIso).getTime() : Date.now()) - new Date(fromIso).getTime()
    } else if (data.earliest_session_at) {
      spanMs = Date.now() - new Date(data.earliest_session_at).getTime()
    }
    if (spanMs === null) return null
    const weeks = Math.max(spanMs / (7 * 24 * 3600 * 1000), 3 / 7)
    return data.sessions_passed / weeks
  })()

  // Count-based pass rate: plates passed / total sessions
  const passRate = !loading && data && data.session_count > 0
    ? data.sessions_passed / data.session_count
    : null
  const priorPassRate = priorData && priorData.session_count > 0
    ? priorData.sessions_passed / priorData.session_count
    : null
  const baselinePassRate = baselineData && baselineData.session_count > 0
    ? baselineData.sessions_passed / baselineData.session_count
    : null

  // All-time plates-passed-per-week rate (baseline) — uses baselineData's earliest session
  const baselinePassedPerWeek = (() => {
    if (!baselineData || !baselineData.earliest_session_at || baselineData.sessions_passed === 0) return null
    const spanMs = Date.now() - new Date(baselineData.earliest_session_at).getTime()
    const weeks = Math.max(spanMs / (7 * 24 * 3600 * 1000), 3 / 7)
    return baselineData.sessions_passed / weeks
  })()

  // Only show baselines when we actually have one to show and we're not in all-time view
  const showBaseline = !isAllTime && baselineData !== null && baselineData.session_count > 0

  // Deltas — only when prior window has enough sessions to compare.
  // When the Fail toggle is active, pass-related tiles are zero by definition,
  // so their deltas are meaningless — suppress them.
  const hasUsefulPrior = priorData !== null && priorData.session_count >= MIN_PRIOR_SESSIONS
  const failOnly = filter.passFilter === 'fail'

  const platesPassedDelta: Delta | null = (() => {
    if (failOnly || !hasUsefulPrior || !data) return null
    const diff = data.sessions_passed - priorData!.sessions_passed
    return {
      text: diff > 0 ? `+${diff}` : `${diff}`,
      direction: directionOf(diff),
      goodWhen: 'up',
      tooltip: `Prior window: ${priorData!.sessions_passed} passed`,
    }
  })()

  const passRateDelta: Delta | null = (() => {
    if (failOnly || !hasUsefulPrior || passRate === null || priorPassRate === null) return null
    const diffPp = (passRate - priorPassRate) * 100
    const rounded = Math.round(diffPp * 10) / 10
    return {
      text: `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}%`,
      direction: directionOf(rounded),
      goodWhen: 'up',
      tooltip: `Prior window: ${(priorPassRate * 100).toFixed(1)}%`,
    }
  })()

  const accuracyDelta: Delta | null = (() => {
    if (!hasUsefulPrior || !data || data.mae_pct === null || !priorData!.mae_pct) return null
    const diffPp = (data.mae_pct - priorData!.mae_pct) * 100
    const rounded = Math.round(diffPp * 100) / 100  // 2 decimal places for MAE
    return {
      text: `${rounded > 0 ? '+' : ''}${rounded.toFixed(2)}%`,
      direction: directionOf(rounded),
      goodWhen: 'down',  // lower MAE is better
      tooltip: `Prior window: ${(priorData!.mae_pct * 100).toFixed(2)}% MAE`,
    }
  })()

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

  const deviceCount = data?.device_count ?? 0
  const sessionCount = data?.session_count ?? 0
  const passedCount = data?.sessions_passed ?? 0

  return (
    <div className="flex flex-col gap-3">
      <h3 className="telemetry-label">Overview</h3>
      <div className="grid grid-cols-4 gap-2">
        <Tile
          label="Devices"
          value={loading ? '…' : String(deviceCount)}
          sub={loading ? undefined : `${sessionCount} session${sessionCount === 1 ? '' : 's'}`}
        />
        <Tile
          label="Plates Passed"
          value={loading ? '…' : String(passedCount)}
          delta={platesPassedDelta}
          baseline={showBaseline && baselinePassedPerWeek !== null ? `avg ${baselinePassedPerWeek.toFixed(1)} / wk` : null}
          sub={loading ? undefined : passedPerWeek !== null ? `${passedPerWeek.toFixed(1)} / week` : undefined}
        />
        <Tile
          label="Pass Rate"
          value={loading ? '…' : fmtPct(passRate)}
          delta={passRateDelta}
          baseline={showBaseline && baselinePassRate !== null ? `avg ${fmtPct(baselinePassRate)}` : null}
          sub={loading ? undefined : `${passedCount} of ${sessionCount}`}
        />
        <Tile
          label="Accuracy"
          value={
            loading ? (
              '…'
            ) : (
              <span className="text-2xl">
                {fmtPct(data?.mae_pct ?? null)} MAE <span className="text-muted-foreground/40">/</span> {fmtSignedPct(data?.signed_error_pct ?? null)} signed
              </span>
            )
          }
          delta={accuracyDelta}
          baseline={
            showBaseline && baselineData?.mae_pct !== null && baselineData?.mae_pct !== undefined
              ? `avg ${fmtPct(baselineData.mae_pct)} MAE`
              : null
          }
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
