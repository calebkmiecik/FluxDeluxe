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

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm uppercase tracking-wider text-muted-foreground">Overview</h3>
      <div className="grid grid-cols-4 gap-2">
        <Tile label="Devices"  value={loading ? '…' : String(data?.device_count ?? 0)} />
        <Tile label="Sessions" value={loading ? '…' : String(data?.session_count ?? 0)} />
        <Tile label="Pass rate" value={loading ? '…' : fmtPct(data?.overall_pass_rate ?? null)} />
        <Tile
          label="Accuracy"
          value={loading ? '…' : `${fmtPct(data?.mae_pct ?? null)} MAE  /  ${fmtSignedPct(data?.signed_error_pct ?? null)} signed`}
        />
      </div>
    </div>
  )
}
