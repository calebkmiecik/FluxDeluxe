import { useEffect, useState } from 'react'
import type { SessionDetail } from '../../lib/liveTestRepoTypes'
import { liveTestClient } from '../../lib/liveTestClient'

function fmtN(n: unknown, digits = 1): string {
  if (n === null || n === undefined) return '—'
  const num = typeof n === 'number' ? n : Number(n)
  return Number.isFinite(num) ? num.toFixed(digits) : '—'
}
function fmtPct(n: unknown): string {
  if (n === null || n === undefined) return '—'
  const num = typeof n === 'number' ? n : Number(n)
  return Number.isFinite(num) ? `${(num * 100).toFixed(0)}%` : '—'
}

export function SessionDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    liveTestClient.getSession(id).then((d) => {
      if (!cancelled) {
        setData(d)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [id])

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-md p-6 max-w-4xl w-full max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {loading && <p className="text-muted-foreground">Loading…</p>}
        {!loading && !data && <p className="text-muted-foreground">Session not found.</p>}
        {!loading && data && <SessionDetailBody data={data} onClose={onClose} />}
      </div>
    </div>
  )
}

function SessionDetailBody({ data, onClose }: { data: SessionDetail; onClose: () => void }) {
  const s = data.session as any
  const aggByType = new Map<string, any>()
  for (const a of data.aggregates) aggByType.set((a as any).stage_type, a)

  const cellsByStage = new Map<number, any[]>()
  for (const c of data.cells) {
    const arr = cellsByStage.get((c as any).stage_index) ?? []
    arr.push(c)
    cellsByStage.set((c as any).stage_index, arr)
  }

  return (
    <>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">
            Session • {new Date(s.started_at).toLocaleString()} • {s.device_id} • {s.tester_name || '—'}
          </h3>
          <p className="text-muted-foreground text-sm">
            Model {s.model_id || '—'} • {s.n_cells_captured}/{s.n_cells_expected} cells • pass {fmtPct(s.overall_pass_rate)}
          </p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground px-2">×</button>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        {(['dumbbell', 'two_leg', 'one_leg'] as const).map((t) => {
          const a = aggByType.get(t)
          const label = t === 'dumbbell' ? 'Dumbbell' : t === 'two_leg' ? 'Two-leg' : 'One-leg'
          return (
            <div key={t} className="bg-background border border-border rounded-md p-3">
              <div className="text-xs text-muted-foreground uppercase">{label}</div>
              <div className="text-foreground">MAE {fmtN(a?.mae)}</div>
              <div className="text-xs text-muted-foreground">bias {fmtN(a?.signed_mean_error)}  ± {fmtN(a?.std_error)}</div>
              <div className="text-xs text-muted-foreground">pass {fmtPct(a?.pass_rate)}</div>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[0, 1, 2, 3, 4, 5].map((stageIndex) => {
          const cells = cellsByStage.get(stageIndex) ?? []
          const stageName = cells[0]?.stage_name ?? `Stage ${stageIndex}`
          const stageLoc = cells[0]?.stage_location ?? '—'
          return (
            <div key={stageIndex} className="bg-background border border-border rounded-md p-3">
              <div className="text-xs text-muted-foreground uppercase mb-2">
                Stage {stageIndex} — {stageName} @ {stageLoc}
              </div>
              <CellGrid rows={s.grid_rows} cols={s.grid_cols} cells={cells} />
            </div>
          )
        })}
      </div>
    </>
  )
}

function CellGrid({ rows, cols, cells }: { rows: number; cols: number; cells: any[] }) {
  const byRC = new Map<string, any>()
  for (const c of cells) byRC.set(`${c.row},${c.col}`, c)
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
      {Array.from({ length: rows * cols }).map((_, i) => {
        const r = Math.floor(i / cols)
        const c = i % cols
        const cell = byRC.get(`${r},${c}`)
        const color = cell ? colorFromBin(cell.color_bin) : 'rgb(40,40,40)'
        const title = cell
          ? `err ${fmtN(cell.error_n)}N  (${fmtN(cell.signed_error_n)})  pass ${cell.pass ? 'yes' : 'no'}`
          : 'Not captured'
        return (
          <div
            key={i}
            title={title}
            className="aspect-square rounded-sm flex items-center justify-center text-xs text-white/90"
            style={{ background: color }}
          >
            {cell ? fmtN(cell.error_n, 0) : ''}
          </div>
        )
      })}
    </div>
  )
}

function colorFromBin(bin: string): string {
  switch (bin) {
    case 'green':       return '#2e7d32'
    case 'light_green': return '#558b2f'
    case 'yellow':      return '#f9a825'
    case 'orange':      return '#ef6c00'
    case 'red':         return '#c62828'
    default:            return 'rgb(60,60,60)'
  }
}
