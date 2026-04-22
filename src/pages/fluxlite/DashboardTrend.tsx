import { useEffect, useMemo, useState } from 'react'
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import type { TimeSeriesPoint } from '../../lib/liveTestRepoTypes'
import { liveTestClient } from '../../lib/liveTestClient'
import type { DashboardFilters } from '../../lib/dashboardFilters'
import { pickGranularity, withAllTime } from '../../lib/dashboardFilters'

type Metric = 'pass_rate' | 'mae_pct' | 'signed_error_pct' | 'passed_count' | 'session_count'

const METRIC_OPTIONS: { value: Metric; label: string; format: (n: number | null) => string }[] = [
  { value: 'pass_rate',          label: 'Pass Rate',     format: (n) => n === null ? '—' : `${(n * 100).toFixed(1)}%` },
  { value: 'mae_pct',            label: 'MAE',           format: (n) => n === null ? '—' : `${(n * 100).toFixed(2)}%` },
  { value: 'signed_error_pct',   label: 'Signed Error',  format: (n) => n === null ? '—' : `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%` },
  { value: 'passed_count',       label: 'Plates Passed', format: (n) => n === null ? '—' : String(n) },
  { value: 'session_count',      label: 'Sessions',      format: (n) => n === null ? '—' : String(n) },
]

const CHART_KEY = 'fluxdeluxe.dashboardTrendMetric'

// Palette matching ForcePlot's Fz line (see src/lib/dataMode.ts)
const LINE_COLOR = '#3B8EFF'   // core bright blue
const LINE_DARK  = '#0051BA'   // primary dark blue
const AXIS_TEXT   = 'rgba(206, 206, 206, 0.8)'
const AXIS_STROKE = 'rgba(206, 206, 206, 0.25)'
const GRID_STROKE = 'rgba(206, 206, 206, 0.08)'

export function DashboardTrend({ filter }: { filter: DashboardFilters }) {
  const [metric, setMetric] = useState<Metric>(() => (localStorage.getItem(CHART_KEY) as Metric) || 'pass_rate')
  const [series, setSeries] = useState<TimeSeriesPoint[]>([])
  const [baseline, setBaseline] = useState<TimeSeriesPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    localStorage.setItem(CHART_KEY, metric)
  }, [metric])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const granularity = pickGranularity(filter)
    const currentP = liveTestClient.getTimeSeries({ filter, granularity })
    const baselineP = filter.timePreset === 'all'
      ? Promise.resolve([])
      : liveTestClient.getTimeSeries({ filter: withAllTime(filter), granularity: 'month' })
    Promise.all([currentP, baselineP]).then(([cur, base]) => {
      if (cancelled) return
      setSeries(cur)
      setBaseline(base)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [filter])

  const option = METRIC_OPTIONS.find((o) => o.value === metric)!

  const baselineValue = useMemo(() => {
    const vals = baseline.map((p) => p[metric]).filter((v): v is number => v !== null)
    if (vals.length === 0) return null
    return vals.reduce((a, b) => a + b, 0) / vals.length
  }, [baseline, metric])

  const chartData = series
    .map((p) => ({ ts: new Date(p.bucket_start).getTime(), value: p[metric] }))
    .filter((d) => d.value !== null) as Array<{ ts: number; value: number }>

  const empty = !loading && chartData.length === 0

  return (
    <>
      <div className="flex items-center justify-between">
        <h3 className="telemetry-label">Trend</h3>
        <select
          value={metric}
          onChange={(e) => setMetric(e.target.value as Metric)}
          className="bg-background border border-border rounded-md text-xs px-2 py-1 text-foreground focus:border-primary focus:outline-none"
        >
          {METRIC_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      <div className="bg-[#1A1A1A] border border-border rounded-md p-3 flex-1 min-h-[160px] flex flex-col">
        {loading && <p className="text-muted-foreground text-sm">Loading…</p>}
        {empty && !loading && <p className="text-muted-foreground text-sm">No data in the selected range.</p>}
        {!empty && !loading && (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <defs>
                {/* Subtle fill gradient — matches ForcePlot's 0.12 → 0.03 → 0 */}
                <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"  stopColor={LINE_DARK} stopOpacity={0.12} />
                  <stop offset="60%" stopColor={LINE_DARK} stopOpacity={0.03} />
                  <stop offset="100%" stopColor={LINE_DARK} stopOpacity={0} />
                </linearGradient>
                {/* Light glow — applied only to the outer darker stroke, approximates ctx.shadowBlur=4 */}
                <filter id="trendGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="1.2" />
                </filter>
              </defs>
              <CartesianGrid stroke={GRID_STROKE} strokeDasharray="0" vertical={false} />
              <XAxis
                dataKey="ts"
                type="number"
                domain={['dataMin', 'dataMax']}
                scale="time"
                tickFormatter={(v: number) => {
                  const d = new Date(v)
                  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                }}
                stroke={AXIS_STROKE}
                tick={{ fontSize: 11, fill: AXIS_TEXT, fontWeight: 500 }}
                tickLine={{ stroke: 'rgba(206, 206, 206, 0.45)' }}
                axisLine={{ stroke: AXIS_STROKE }}
              />
              <YAxis
                tickFormatter={(v: number) => option.format(v).replace(/\s/g, '')}
                stroke={AXIS_STROKE}
                tick={{ fontSize: 11, fill: AXIS_TEXT, fontWeight: 500 }}
                tickLine={{ stroke: 'rgba(206, 206, 206, 0.45)' }}
                axisLine={{ stroke: AXIS_STROKE }}
                width={50}
              />
              <Tooltip
                contentStyle={{ background: '#141414', border: '1px solid #333', borderRadius: 4, fontSize: 12 }}
                labelStyle={{ color: '#CECECE' }}
                itemStyle={{ color: '#CECECE' }}
                labelFormatter={(v: number) => new Date(v).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                formatter={(v: number) => [option.format(v), option.label]}
                cursor={{ stroke: 'rgba(206, 206, 206, 0.2)', strokeWidth: 1 }}
              />
              {baselineValue !== null && (
                <ReferenceLine
                  y={baselineValue}
                  stroke="rgba(206, 206, 206, 0.4)"
                  strokeDasharray="4 4"
                  label={{
                    value: `all-time ${option.format(baselineValue).trim()}`,
                    position: 'right',
                    fill: 'rgba(206, 206, 206, 0.7)',
                    fontSize: 10,
                  }}
                />
              )}
              {/* Fill + outer darker stroke (with subtle glow) */}
              <Area
                type="natural"
                dataKey="value"
                stroke={LINE_DARK}
                strokeWidth={2}
                fill="url(#trendFill)"
                dot={false}
                activeDot={false}
                connectNulls={true}
                isAnimationActive={false}
                style={{ filter: 'url(#trendGlow)' }}
              />
              {/* Inner bright crisp core line, no glow */}
              <Line
                type="natural"
                dataKey="value"
                stroke={LINE_COLOR}
                strokeWidth={1.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={{ r: 4, fill: LINE_COLOR, stroke: LINE_DARK, strokeWidth: 2 }}
                connectNulls={true}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </>
  )
}
