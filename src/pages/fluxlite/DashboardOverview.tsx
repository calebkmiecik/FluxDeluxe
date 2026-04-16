import { useEffect, useState } from 'react'
import type { OverviewResult } from '../../lib/liveTestRepoTypes'
import { liveTestClient } from '../../lib/liveTestClient'
import type { DashboardFilters } from '../../lib/dashboardFilters'

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-card border border-border rounded-md p-3">
      <div className="text-muted-foreground text-xs uppercase tracking-wider">{label}</div>
      <div className="text-xl font-semibold text-foreground">{value}</div>
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

/** Average non-null values from per_stage_type for a given key. */
function avgStageMetric(data: OverviewResult, key: 'mae' | 'signed_mean_error'): number | null {
  const vals = data.per_stage_type.map((s) => s[key]).filter((v): v is number => v !== null)
  if (vals.length === 0) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
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

  const overallMae = data ? avgStageMetric(data, 'mae') : null
  const overallSigned = data ? avgStageMetric(data, 'signed_mean_error') : null

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm uppercase tracking-wider text-muted-foreground">Overview</h3>
      <div className="grid grid-cols-4 gap-2">
        <Tile label="Devices"  value={loading ? '…' : String(data?.device_count ?? 0)} />
        <Tile label="Sessions" value={loading ? '…' : String(data?.session_count ?? 0)} />
        <Tile label="Pass rate" value={loading ? '…' : fmtPct(data?.overall_pass_rate ?? null)} />
        <Tile
          label="Accuracy"
          value={loading ? '…' : `MAE ${fmtN(overallMae)}`}
          sub={loading ? undefined : `Signed ${fmtN(overallSigned)}`}
        />
      </div>
    </div>
  )
}
