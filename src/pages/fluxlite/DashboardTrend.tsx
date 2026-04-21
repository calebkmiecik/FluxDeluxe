import { useEffect, useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import type { TimeSeriesPoint } from '../../lib/liveTestRepoTypes'
import { liveTestClient } from '../../lib/liveTestClient'
import type { DashboardFilters } from '../../lib/dashboardFilters'
import { pickGranularity, withAllTime } from '../../lib/dashboardFilters'

type Metric = 'pass_rate' | 'mae_pct' | 'signed_error_pct' | 'passed_count' | 'session_count'

const METRIC_OPTIONS: { value: Metric; label: string; format: (n: number | null) => string; isPct: boolean; signed?: boolean }[] = [
  { value: 'pass_rate',          label: 'Pass Rate',     format: (n) => n === null ? '—' : `${(n * 100).toFixed(1)}%`, isPct: true },
  { value: 'mae_pct',            label: 'MAE',           format: (n) => n === null ? '—' : `${(n * 100).toFixed(2)}%`, isPct: true },
  { value: 'signed_error_pct',   label: 'Signed Error',  format: (n) => n === null ? '—' : `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`, isPct: true, signed: true },
  { value: 'passed_count',       label: 'Plates Passed', format: (n) => n === null ? '—' : String(n), isPct: false },
  { value: 'session_count',      label: 'Sessions',      format: (n) => n === null ? '—' : String(n), isPct: false },
]

const CHART_KEY = 'fluxdeluxe.dashboardTrendMetric'

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
    // Baseline series = same filter minus time bounds, for computing all-time average
    const baselineP = filter.timePreset === 'all'
      ? Promise.resolve([])
      : liveTestClient.getTimeSeries({ filter: withAllTime(filter), granularity: 'week' })
    Promise.all([currentP, baselineP]).then(([cur, base]) => {
      if (cancelled) return
      setSeries(cur)
      setBaseline(base)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [filter])

  const option = METRIC_OPTIONS.find((o) => o.value === metric)!

  // Compute baseline value = average of the metric across all baseline buckets (non-null).
  const baselineValue = useMemo(() => {
    const vals = baseline.map((p) => p[metric]).filter((v): v is number => v !== null)
    if (vals.length === 0) return null
    return vals.reduce((a, b) => a + b, 0) / vals.length
  }, [baseline, metric])

  // Chart data — skip points with null for the chosen metric (gaps look better than zero dips).
  const chartData = series
    .map((p) => ({ ts: new Date(p.bucket_start).getTime(), value: p[metric] }))
    .filter((d) => d.value !== null) as Array<{ ts: number; value: number }>

  const empty = !loading && chartData.length === 0

  return (
    <div className="bg-white/[0.02] border border-border rounded-md p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="telemetry-label">Trend</h3>
        <div className="flex items-center gap-2">
          <span className="telemetry-label">Metric</span>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as Metric)}
            className="bg-background border border-border rounded-md text-sm px-2 py-1 text-foreground focus:border-primary focus:outline-none"
          >
            {METRIC_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="h-48">
        {loading && <p className="text-muted-foreground text-sm">Loading…</p>}
        {empty && !loading && <p className="text-muted-foreground text-sm">No data in the selected range.</p>}
        {!empty && !loading && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#2a2a2a" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="ts"
                type="number"
                domain={['dataMin', 'dataMax']}
                scale="time"
                tickFormatter={(v: number) => {
                  const d = new Date(v)
                  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                }}
                stroke="#555"
                tick={{ fontSize: 11, fill: '#8E9FBC' }}
              />
              <YAxis
                tickFormatter={(v: number) => option.format(v).replace(/\s/g, '')}
                stroke="#555"
                tick={{ fontSize: 11, fill: '#8E9FBC' }}
                width={50}
              />
              <Tooltip
                contentStyle={{ background: '#141414', border: '1px solid #333', borderRadius: 4, fontSize: 12 }}
                labelStyle={{ color: '#CECECE' }}
                itemStyle={{ color: '#CECECE' }}
                labelFormatter={(v: number) => new Date(v).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                formatter={(v: number) => [option.format(v), option.label]}
              />
              {baselineValue !== null && (
                <ReferenceLine
                  y={baselineValue}
                  stroke="#8E9FBC"
                  strokeDasharray="4 4"
                  strokeOpacity={0.7}
                  label={{ value: `all-time ${option.format(baselineValue).trim()}`, position: 'right', fill: '#8E9FBC', fontSize: 10 }}
                />
              )}
              <Line
                type="monotone"
                dataKey="value"
                stroke="#0051BA"
                strokeWidth={2}
                dot={{ r: 3, fill: '#0051BA', stroke: '#0051BA' }}
                activeDot={{ r: 5 }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
