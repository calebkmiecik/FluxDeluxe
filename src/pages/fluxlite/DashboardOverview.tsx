import { useEffect, useState, type ReactNode } from 'react'
import type { OverviewResult } from '../../lib/liveTestRepoTypes'
import { liveTestClient } from '../../lib/liveTestClient'
import type { DashboardFilters } from '../../lib/dashboardFilters'
import { priorEquivalentFilter, withAllTime, priorWindowLabel } from '../../lib/dashboardFilters'

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
  return (
    <span className={`${color} text-[11px] font-medium tracking-wider`} title={delta.tooltip}>
      {delta.text}
    </span>
  )
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

  // Plates-passed-per-week rate. Denominator is the count of weeks that actually
  // had testing activity — weeks with zero sessions are excluded, so a burst of
  // testing after a 2-week break isn't diluted by the dead weeks.
  const passedPerWeek = (!loading && data && data.active_weeks > 0)
    ? data.sessions_passed / data.active_weeks
    : null

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

  // All-time plates-passed-per-week rate (baseline) — also excludes dead weeks.
  const baselinePassedPerWeek = (baselineData && baselineData.active_weeks > 0)
    ? baselineData.sessions_passed / baselineData.active_weeks
    : null

  // Only show baselines when we actually have one to show and we're not in all-time view
  const showBaseline = !isAllTime && baselineData !== null && baselineData.session_count > 0

  // Deltas — only when prior window has enough sessions to compare.
  // When the Fail toggle is active, pass-related tiles are zero by definition,
  // so their deltas are meaningless — suppress them.
  const hasUsefulPrior = priorData !== null && priorData.session_count >= MIN_PRIOR_SESSIONS
  const failOnly = filter.passFilter === 'fail'
  const priorLabel = priorWindowLabel(filter)

  const platesPassedDelta: Delta | null = (() => {
    if (failOnly || !hasUsefulPrior || !data) return null
    const diff = data.sessions_passed - priorData!.sessions_passed
    return {
      text: `${diff > 0 ? `+${diff}` : diff} ${priorLabel}`,
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
      text: `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}% ${priorLabel}`,
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
      text: `${rounded > 0 ? '+' : ''}${rounded.toFixed(2)}% ${priorLabel}`,
      direction: directionOf(rounded),
      goodWhen: 'down',  // lower MAE is better
      tooltip: `Prior window: ${(priorData!.mae_pct * 100).toFixed(2)}% MAE`,
    }
  })()

  const stageTypes = [
    { type: 'dumbbell' as const, label: 'Dumbbell' },
    { type: 'two_leg'  as const, label: 'Two-leg' },
    { type: 'one_leg'  as const, label: 'One-leg' },
  ]
  const stageRows = stageTypes.map(({ type, label }) => ({
    label,
    row: data?.per_stage_type.find((p) => p.stage_type === type),
  }))

  // Column maxima for proportional bar widths
  const maxPos = (key: 'mae_pct' | 'std_error_pct') =>
    Math.max(...stageRows.map((r) => r.row?.[key] ?? 0), 0.0001)
  const maxSigned = Math.max(
    ...stageRows.map((r) => Math.abs(r.row?.signed_mean_error_pct ?? 0)),
    0.0001,
  )
  const maxMaePct = maxPos('mae_pct')
  const maxStdPct = maxPos('std_error_pct')

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
          baseline={showBaseline && baselinePassedPerWeek !== null ? `${baselinePassedPerWeek.toFixed(1)} / wk all-time` : null}
          sub={loading ? undefined : passedPerWeek !== null ? `${passedPerWeek.toFixed(1)} / week` : undefined}
        />
        <Tile
          label="Pass Rate"
          value={loading ? '…' : fmtPct(passRate)}
          delta={passRateDelta}
          baseline={showBaseline && baselinePassRate !== null ? `${fmtPct(baselinePassRate)} all-time` : null}
          sub={loading ? undefined : `${passedCount} of ${sessionCount}`}
        />
        <Tile
          label="Accuracy"
          value={loading ? '…' : `${fmtPct(data?.mae_pct ?? null)} MAE`}
          delta={accuracyDelta}
          baseline={
            showBaseline && baselineData?.mae_pct !== null && baselineData?.mae_pct !== undefined
              ? `${fmtPct(baselineData.mae_pct)} MAE all-time`
              : null
          }
          sub={loading ? undefined : `${fmtSignedPct(data?.signed_error_pct ?? null)} signed`}
        />
      </div>

      <h3 className="telemetry-label mt-1">By stage type</h3>
      <div className="bg-white/[0.02] border border-border rounded-md p-4">
        <div className="grid items-center gap-x-4 gap-y-2" style={{ gridTemplateColumns: '90px repeat(4, minmax(0, 1fr))' }}>
          {/* Header row */}
          <div />
          <div className="telemetry-label">MAE</div>
          <div className="telemetry-label">Pass</div>
          <div className="telemetry-label">Signed</div>
          <div className="telemetry-label">Std</div>

          {/* Data rows */}
          {stageRows.map(({ label, row }) => (
            <StageRow
              key={label}
              label={label}
              mae={row?.mae_pct ?? null}
              pass={row?.pass_rate ?? null}
              signed={row?.signed_mean_error_pct ?? null}
              std={row?.std_error_pct ?? null}
              maxMae={maxMaePct}
              maxSigned={maxSigned}
              maxStd={maxStdPct}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function StageRow({
  label, mae, pass, signed, std, maxMae, maxSigned, maxStd,
}: {
  label: string
  mae: number | null
  pass: number | null
  signed: number | null
  std: number | null
  maxMae: number
  maxSigned: number
  maxStd: number
}) {
  return (
    <>
      <div className="text-sm text-foreground font-medium">{label}</div>
      <MetricCell value={mae}    format={fmtPct}       barFill={mae !== null ? mae / maxMae : 0} />
      <PassCell   value={pass} />
      <SignedCell value={signed} maxAbs={maxSigned} />
      <MetricCell value={std}    format={fmtPct}       barFill={std !== null ? std / maxStd : 0} />
    </>
  )
}

/** Positive-scalar metric: number + horizontal bar that fills left-to-right. */
function MetricCell({ value, format, barFill }: {
  value: number | null
  format: (n: number | null) => string
  /** 0..1 proportional fill. */
  barFill: number
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-sm text-foreground tabular-nums w-14 shrink-0">{format(value)}</span>
      <div className="flex-1 h-1.5 bg-white/5 rounded-sm overflow-hidden">
        <div
          className="h-full bg-white/30 rounded-sm"
          style={{ width: `${Math.max(0, Math.min(1, barFill)) * 100}%` }}
        />
      </div>
    </div>
  )
}

/** Pass rate: 0..100% natural scale, color-graded. */
function PassCell({ value }: { value: number | null }) {
  const color =
    value === null ? 'bg-white/20' :
    value >= 0.9 ? 'bg-success/70' :
    value >= 0.75 ? 'bg-warning/70' :
    'bg-danger/70'
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-sm text-foreground tabular-nums w-14 shrink-0">{fmtPct(value)}</span>
      <div className="flex-1 h-1.5 bg-white/5 rounded-sm overflow-hidden">
        <div
          className={`h-full rounded-sm ${color}`}
          style={{ width: `${Math.max(0, Math.min(1, value ?? 0)) * 100}%` }}
        />
      </div>
    </div>
  )
}

/** Signed bipolar metric: bar extends left (negative) or right (positive) from center. */
function SignedCell({ value, maxAbs }: { value: number | null; maxAbs: number }) {
  const fill = value === null ? 0 : value / maxAbs  // -1 .. 1
  const clamped = Math.max(-1, Math.min(1, fill))
  const widthPct = Math.abs(clamped) * 50  // each half is 50% of bar width
  const isNegative = clamped < 0
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-sm text-foreground tabular-nums w-14 shrink-0">{fmtSignedPct(value)}</span>
      <div className="flex-1 h-1.5 bg-white/5 rounded-sm overflow-hidden relative">
        {/* center line */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/20" />
        {/* bar extends from center */}
        {value !== null && (
          <div
            className={`absolute top-0 bottom-0 ${isNegative ? 'bg-danger/60' : 'bg-success/60'}`}
            style={{
              left: isNegative ? `calc(50% - ${widthPct}%)` : '50%',
              width: `${widthPct}%`,
            }}
          />
        )}
      </div>
    </div>
  )
}
