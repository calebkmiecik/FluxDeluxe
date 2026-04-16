import { useEffect, useState } from 'react'
import type { SessionListRow } from '../../lib/liveTestRepoTypes'
import { liveTestClient } from '../../lib/liveTestClient'

const PAGE = 50

export function SessionList({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<SessionListRow[]>([])
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    liveTestClient.listSessions({ limit: PAGE, offset: 0 }).then((r) => {
      if (cancelled) return
      setRows(r)
      setOffset(r.length)
      setDone(r.length < PAGE)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const loadMore = async () => {
    setLoading(true)
    const more = await liveTestClient.listSessions({ limit: PAGE, offset })
    setRows((prev) => [...prev, ...more])
    setOffset(offset + more.length)
    if (more.length < PAGE) setDone(true)
    setLoading(false)
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm uppercase tracking-wider text-muted-foreground">Recent sessions</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b border-border">
            <th className="pb-2 pr-4 text-muted-foreground text-xs uppercase tracking-wider">Date</th>
            <th className="pb-2 pr-4 text-muted-foreground text-xs uppercase tracking-wider">Device</th>
            <th className="pb-2 pr-4 text-muted-foreground text-xs uppercase tracking-wider">Tester</th>
            <th className="pb-2 pr-4 text-muted-foreground text-xs uppercase tracking-wider">Model</th>
            <th className="pb-2 pr-4 text-muted-foreground text-xs uppercase tracking-wider">Pass</th>
            <th className="pb-2 text-muted-foreground text-xs uppercase tracking-wider">Cells</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              onClick={() => onOpen(r.id)}
              className="border-b border-border/50 hover:bg-white/5 transition-colors cursor-pointer"
            >
              <td className="py-2 pr-4 text-muted-foreground">{new Date(r.started_at).toLocaleString()}</td>
              <td className="py-2 pr-4 text-foreground">{r.device_nickname ?? r.device_id}</td>
              <td className="py-2 pr-4 text-muted-foreground">{r.tester_name || '—'}</td>
              <td className="py-2 pr-4 text-muted-foreground">{r.model_id || '—'}</td>
              <td className="py-2 pr-4 text-muted-foreground">
                {r.overall_pass_rate === null ? '—' : `${(r.overall_pass_rate * 100).toFixed(0)}%`}
              </td>
              <td className="py-2 text-muted-foreground">{r.n_cells_captured}/{r.n_cells_expected}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {loading && <p className="text-muted-foreground text-sm">Loading…</p>}
      {!loading && !done && (
        <button onClick={loadMore} className="self-center mt-2 px-3 py-1.5 text-sm border border-border rounded-md hover:bg-white/5">
          Load more
        </button>
      )}
      {!loading && rows.length === 0 && (
        <p className="text-muted-foreground text-sm">No sessions yet.</p>
      )}
    </div>
  )
}
