import { useEffect, useState, type ReactNode } from 'react'
import type { SessionDetail } from '../../lib/liveTestRepoTypes'
import { liveTestClient } from '../../lib/liveTestClient'
import { deviceTypeToFamily, familyLabel } from '../../lib/deviceFamily'

// ── Formatters ──────────────────────────────────────────────────
function asNum(n: unknown): number | null {
  if (n === null || n === undefined) return null
  const v = typeof n === 'number' ? n : Number(n)
  return Number.isFinite(v) ? v : null
}
function fmtN(n: unknown, digits = 1): string {
  const v = asNum(n); return v === null ? '—' : `${v.toFixed(digits)}N`
}
function fmtPct(n: unknown, digits = 1): string {
  const v = asNum(n); return v === null ? '—' : `${(v * 100).toFixed(digits)}%`
}
function fmtSignedPct(n: unknown, digits = 2): string {
  const v = asNum(n); if (v === null) return '—'
  const pct = v * 100; return `${pct >= 0 ? '+' : ''}${pct.toFixed(digits)}%`
}
/** Error / target → percentage (formatted). target in Newtons. */
function fmtCellPct(errorN: unknown, targetN: unknown): string {
  const e = asNum(errorN); const t = asNum(targetN)
  if (e === null || t === null || t === 0) return '—'
  return `${(e / t * 100).toFixed(1)}%`
}
function fmtCellSignedPct(signedN: unknown, targetN: unknown): string {
  const s = asNum(signedN); const t = asNum(targetN)
  if (s === null || t === null || t === 0) return '—'
  const pct = s / t * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}

// ── Cell color binning (tuned for dark theme) ───────────────────
function colorFromBin(bin: string): string {
  switch (bin) {
    case 'green':       return '#1f6f2e'   // passed, near target
    case 'light_green': return '#3a7e3f'
    case 'yellow':      return '#a67a15'
    case 'orange':      return '#b45a18'
    case 'red':         return '#9a2a2a'
    default:            return '#262626'  // not captured
  }
}

export function SessionDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    liveTestClient.getSession(id).then((d) => {
      if (!cancelled) { setData(d); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [id])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-[#1A1A1A] border border-border rounded-md max-w-5xl w-full max-h-[90vh] overflow-auto card-accent"
        onClick={(e) => e.stopPropagation()}
      >
        {loading && <p className="text-muted-foreground p-6">Loading…</p>}
        {!loading && !data && <p className="text-muted-foreground p-6">Session not found.</p>}
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

  const family = deviceTypeToFamily(s.device_type)
  const deviceLabel = family ? familyLabel(family) : s.device_type

  // Overall pass rate (fraction 0..1) → %
  const passRatePct = asNum(s.overall_pass_rate)
  // Overall MAE / signed error — dummy builds these into the per-cell data but the session row doesn't carry
  // them, so compute on the fly from cells if present.
  const allErrorRatios = data.cells.map((c: any) => {
    const e = asNum(c.error_n); const t = asNum(c.target_n)
    if (e === null || t === null || t === 0) return null
    return e / t
  }).filter((x): x is number => x !== null)
  const allSignedRatios = data.cells.map((c: any) => {
    const s_ = asNum(c.signed_error_n); const t = asNum(c.target_n)
    if (s_ === null || t === null || t === 0) return null
    return s_ / t
  }).filter((x): x is number => x !== null)
  const overallMaePct = allErrorRatios.length ? allErrorRatios.reduce((a, b) => a + b, 0) / allErrorRatios.length : null
  const overallSignedPct = allSignedRatios.length ? allSignedRatios.reduce((a, b) => a + b, 0) / allSignedRatios.length : null

  // Stage-type aggregates — in N (from `aggregates` rows)
  const stages: { type: 'dumbbell' | 'two_leg' | 'one_leg'; label: string }[] = [
    { type: 'dumbbell', label: 'Dumbbell' },
    { type: 'two_leg',  label: 'Two-leg' },
    { type: 'one_leg',  label: 'One-leg' },
  ]

  return (
    <>
      {/* ── Header strip ──────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border">
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3 min-w-0">
          <Field label="Device"  value={s.device_id} sub={deviceLabel} />
          <Field label="Tester"  value={s.tester_name || '—'} />
          <Field label="Model"   value={s.model_id || '—'} />
          <Field label="Weight"  value={s.body_weight_n ? `${Math.round(asNum(s.body_weight_n) ?? 0)}N` : '—'} />
          <Field label="Date"    value={new Date(s.started_at).toLocaleString()} />
          <Field
            label="Result"
            value={
              s.session_passed === true ? (
                <span className="text-success font-medium uppercase tracking-wider">Pass</span>
              ) : s.session_passed === false ? (
                <span className="text-danger font-medium uppercase tracking-wider">Fail</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
            sub={passRatePct === null ? undefined : `${(passRatePct * 100).toFixed(0)}% cells`}
          />
        </div>
        <button
          onClick={onClose}
          className="shrink-0 px-2.5 py-1 text-xs tracking-[0.08em] uppercase border border-border rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
          aria-label="Close"
        >
          Close
        </button>
      </div>

      {/* ── Summary row ──────────────────────────────────────── */}
      <div className="px-5 py-4 border-b border-border grid grid-cols-4 gap-3">
        <SummaryStat label="Pass rate" value={fmtPct(passRatePct)} />
        <SummaryStat label="MAE" value={fmtPct(overallMaePct)} />
        <SummaryStat label="Signed" value={fmtSignedPct(overallSignedPct)} />
        <SummaryStat label="Cells" value={`${s.n_cells_captured} / ${s.n_cells_expected}`} />
      </div>

      {/* ── By stage type (same bar pattern as dashboard) ────── */}
      <div className="px-5 py-4 border-b border-border">
        <h3 className="telemetry-label mb-3">By stage type</h3>
        <div className="grid items-center gap-x-4 gap-y-3" style={{ gridTemplateColumns: '90px repeat(4, minmax(0, 1fr))' }}>
          <div />
          <div className="telemetry-label">MAE</div>
          <div className="telemetry-label">Pass</div>
          <div className="telemetry-label">Signed</div>
          <div className="telemetry-label">Std</div>
          {stages.map(({ type, label }) => {
            const a = aggByType.get(type)
            const target = type === 'dumbbell' ? 206.3 : (asNum(s.body_weight_n) ?? 1)
            // N-based aggregates from the row; convert to % for display.
            const maePct = asNum(a?.mae) !== null && target > 0 ? (asNum(a?.mae)! / target) : null
            const signedMeanPct = asNum(a?.signed_mean_error) !== null && target > 0 ? (asNum(a?.signed_mean_error)! / target) : null
            const stdPct = asNum(a?.std_error) !== null && target > 0 ? (asNum(a?.std_error)! / target) : null
            const passRate = asNum(a?.pass_rate)
            return (
              <StageBarRow
                key={type}
                label={label}
                mae={maePct}
                pass={passRate}
                signed={signedMeanPct}
                std={stdPct}
              />
            )
          })}
        </div>
      </div>

      {/* ── Plate grids — 6 stages (3 stage types × 2 locations) ── */}
      <div className="px-5 py-4">
        <h3 className="telemetry-label mb-3">Cell measurements</h3>
        <div className="grid grid-cols-3 gap-3">
          {(['A', 'B'] as const).flatMap((loc) =>
            stages.map((stage) => {
              const stageIndex = stage.type === 'dumbbell' ? (loc === 'A' ? 0 : 3)
                : stage.type === 'two_leg' ? (loc === 'A' ? 1 : 4)
                : (loc === 'A' ? 2 : 5)
              const cells = cellsByStage.get(stageIndex) ?? []
              return (
                <div key={`${stage.type}-${loc}`} className="panel-inset p-3">
                  <div className="flex items-baseline justify-between mb-2">
                    <div className="telemetry-label">{stage.label}</div>
                    <div className="telemetry-label">@ {loc}</div>
                  </div>
                  <CellGrid rows={s.grid_rows} cols={s.grid_cols} cells={cells} />
                </div>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}

// ── Subcomponents ────────────────────────────────────────────────

function Field({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="telemetry-label">{label}</div>
      <div className="text-sm text-foreground font-medium">{value}</div>
      {sub && <div className="text-muted-foreground text-[11px] tracking-wider">{sub}</div>}
    </div>
  )
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="telemetry-label">{label}</div>
      <div className="text-xl font-semibold text-foreground leading-none mt-1.5 tabular-nums">{value}</div>
    </div>
  )
}

// Bar styling matches DashboardOverview stage-type section
const BAR_FILL = 'bg-primary/40'
const BAR_TRACK = 'bg-white/[0.04]'
const BAR_MAX_W = 'max-w-[120px]'

function StageBarRow({ label, mae, pass, signed, std }: {
  label: string
  mae: number | null
  pass: number | null
  signed: number | null
  std: number | null
}) {
  // Normalize each bar's fill width relative to sensible upper bounds for a single session.
  const maeMax = 0.05    // 5% MAE gives a full bar
  const stdMax = 0.05    // 5% std gives a full bar
  const signedMax = 0.05 // ±5% signed fills half-bar each direction
  return (
    <>
      <div className="text-sm text-foreground font-medium">{label}</div>
      <ScalarCell value={mae}    format={fmtPct}       fill={mae !== null ? mae / maeMax : 0} />
      <PassCellInline value={pass} />
      <SignedCellInline value={signed} maxAbs={signedMax} />
      <ScalarCell value={std}    format={fmtPct}       fill={std !== null ? std / stdMax : 0} />
    </>
  )
}

function ScalarCell({ value, format, fill }: {
  value: number | null
  format: (n: number | null | undefined) => string
  fill: number
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-sm text-foreground tabular-nums w-14 shrink-0">{format(value)}</span>
      <div className={`flex-1 ${BAR_MAX_W} h-1 ${BAR_TRACK} rounded-sm overflow-hidden`}>
        <div
          className={`h-full ${BAR_FILL} rounded-sm`}
          style={{ width: `${Math.max(0, Math.min(1, fill)) * 100}%` }}
        />
      </div>
    </div>
  )
}

function PassCellInline({ value }: { value: number | null }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-sm text-foreground tabular-nums w-14 shrink-0">{fmtPct(value)}</span>
      <div className={`flex-1 ${BAR_MAX_W} h-1 ${BAR_TRACK} rounded-sm overflow-hidden`}>
        <div
          className={`h-full rounded-sm ${BAR_FILL}`}
          style={{ width: `${Math.max(0, Math.min(1, value ?? 0)) * 100}%` }}
        />
      </div>
    </div>
  )
}

function SignedCellInline({ value, maxAbs }: { value: number | null; maxAbs: number }) {
  const clamped = value === null ? 0 : Math.max(-1, Math.min(1, value / maxAbs))
  const widthPct = Math.abs(clamped) * 50
  const isNegative = clamped < 0
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-sm text-foreground tabular-nums w-14 shrink-0">{fmtSignedPct(value)}</span>
      <div className={`flex-1 ${BAR_MAX_W} h-1 ${BAR_TRACK} rounded-sm overflow-hidden relative`}>
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/15" />
        {value !== null && (
          <div
            className={`absolute top-0 bottom-0 ${BAR_FILL} ${isNegative ? 'rounded-l-sm' : 'rounded-r-sm'}`}
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

function CellGrid({ rows, cols, cells }: { rows: number; cols: number; cells: any[] }) {
  const byRC = new Map<string, any>()
  for (const c of cells) byRC.set(`${c.row},${c.col}`, c)
  return (
    <div className="grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
      {Array.from({ length: rows * cols }).map((_, i) => {
        const r = Math.floor(i / cols)
        const c = i % cols
        const cell = byRC.get(`${r},${c}`)
        const color = cell ? colorFromBin(cell.color_bin) : '#1f1f1f'
        const labelPct = cell ? fmtCellPct(cell.error_n, cell.target_n) : ''
        const title = cell
          ? `${fmtCellPct(cell.error_n, cell.target_n)} error (${fmtCellSignedPct(cell.signed_error_n, cell.target_n)}) · ${cell.pass ? 'PASS' : 'FAIL'}`
          : 'Not captured'
        return (
          <div
            key={i}
            title={title}
            className="aspect-square flex items-center justify-center font-mono text-[10px] text-white/90 leading-none tabular-nums"
            style={{ background: color }}
          >
            {labelPct}
          </div>
        )
      })}
    </div>
  )
}
