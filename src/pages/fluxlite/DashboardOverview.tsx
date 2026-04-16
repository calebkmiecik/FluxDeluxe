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

function fmtN(n: number | null | undefined, digits = 1, suffix = 'N'): string {
  if (n === null || n === undefined) return '—'
  return `${n.toFixed(digits)}${suffix}`
}
function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return `${(n * 100).toFixed(1)}%`
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
      <div className="bg-card border border-border rounded-md p-3">
        <div className="text-muted-foreground text-xs uppercase tracking-wider">{label}</div>
        <div className="text-lg font-semibold text-foreground">MAE {fmtN(r?.mae ?? null)}</div>
        <div className="text-xs text-muted-foreground mt-1">± {fmtN(r?.std_error ?? null)}</div>
        <div className="text-xs text-muted-foreground">bias {fmtN(r?.signed_mean_error ?? null)}</div>
        <div className="text-xs text-muted-foreground mt-1">pass {fmtPct(r?.pass_rate ?? null)}</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm uppercase tracking-wider text-muted-foreground">Overview</h3>

      <div className="grid grid-cols-4 gap-2">
        <Tile label="Sessions" value={loading ? '…' : String(data?.session_count ?? 0)} />
        <Tile label="Cells"    value={loading ? '…' : String(data?.cells_captured ?? 0)} />
        <Tile label="Pass rate" value={loading ? '…' : fmtPct(data?.overall_pass_rate ?? null)} />
        <Tile label="Devices"  value={loading ? '…' : String(data?.device_count ?? 0)} />
      </div>

      <h3 className="text-sm uppercase tracking-wider text-muted-foreground mt-2">Accuracy by stage type</h3>
      <div className="grid grid-cols-3 gap-2">
        {stageTile('dumbbell', 'Dumbbell')}
        {stageTile('two_leg',  'Two-leg')}
        {stageTile('one_leg',  'One-leg')}
      </div>
    </div>
  )
}
