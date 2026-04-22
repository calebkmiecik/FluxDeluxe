import { useEffect, useState } from 'react'
import type { SessionListRow } from '../../lib/liveTestRepoTypes'
import { liveTestClient } from '../../lib/liveTestClient'
import type { DashboardFilters } from '../../lib/dashboardFilters'
import { deviceTypeToFamily, familyLabel } from '../../lib/deviceFamily'

const PAGE = 50

export function SessionList({ filter, onOpen }: { filter: DashboardFilters; onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<SessionListRow[]>([])
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    liveTestClient.listSessions({ limit: PAGE, offset: 0, filter }).then((r) => {
      if (cancelled) return
      setRows(r)
      setOffset(r.length)
      setDone(r.length < PAGE)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [filter])

  const loadMore = async () => {
    setLoading(true)
    const more = await liveTestClient.listSessions({ limit: PAGE, offset, filter })
    setRows((prev) => [...prev, ...more])
    setOffset(offset + more.length)
    if (more.length < PAGE) setDone(true)
    setLoading(false)
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="telemetry-label uppercase">Recent sessions</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b border-border">
            <th className="pb-2 pr-4 telemetry-label uppercase">Date</th>
            <th className="pb-2 pr-4 telemetry-label uppercase">Device</th>
            <th className="pb-2 pr-4 telemetry-label uppercase">Type</th>
            <th className="pb-2 pr-4 telemetry-label uppercase">Tester</th>
            <th className="pb-2 pr-4 telemetry-label uppercase">Weight</th>
            <th className="pb-2 pr-4 telemetry-label uppercase">Model</th>
            <th className="pb-2 pr-4 telemetry-label uppercase">Result</th>
            <th className="pb-2 telemetry-label uppercase">Cells</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const family = deviceTypeToFamily(r.device_type)
            return (
              <tr
                key={r.id}
                onClick={() => onOpen(r.id)}
                className="border-b border-border/50 hover:bg-white/5 transition-colors cursor-pointer"
              >
                <td className="py-2 pr-4 text-muted-foreground">{new Date(r.started_at).toLocaleString()}</td>
                <td className="py-2 pr-4 text-foreground">{r.device_nickname ?? r.device_id}</td>
                <td className="py-2 pr-4 text-muted-foreground">{family ? familyLabel(family) : r.device_type}</td>
                <td className="py-2 pr-4 text-muted-foreground">{r.tester_name || '—'}</td>
                <td className="py-2 pr-4 text-muted-foreground">
                  {r.body_weight_n === null ? '—' : `${r.body_weight_n.toFixed(0)}N`}
                </td>
                <td className="py-2 pr-4 text-muted-foreground">{r.model_id || '—'}</td>
                <td className="py-2 pr-4">
                  {r.session_passed === true && (
                    <span className="text-success text-xs font-medium uppercase">Pass</span>
                  )}
                  {r.session_passed === false && (
                    <span className="text-danger text-xs font-medium uppercase">Fail</span>
                  )}
                  {r.session_passed === null && (
                    <span className="text-muted-foreground">—</span>
                  )}
                  {r.overall_pass_rate !== null && (
                    <span className="text-muted-foreground text-xs ml-1.5">
                      {(r.overall_pass_rate * 100).toFixed(0)}%
                    </span>
                  )}
                </td>
                <td className="py-2 text-muted-foreground">{r.n_cells_captured}/{r.n_cells_expected}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {loading && <p className="text-muted-foreground text-sm">Loading…</p>}
      {!loading && !done && (
        <button onClick={loadMore} className="self-center mt-2 px-3 py-1.5 text-sm border border-border rounded-md hover:bg-white/5">
          Load more
        </button>
      )}
      {!loading && rows.length === 0 && (
        <p className="text-muted-foreground text-sm">No sessions match.</p>
      )}
    </div>
  )
}
