import { useEffect, useMemo, useState } from 'react'
import type { SessionListRow } from '../../lib/liveTestRepoTypes'
import { liveTestClient } from '../../lib/liveTestClient'
import type { DashboardFilters } from '../../lib/dashboardFilters'
import { deviceTypeToFamily, familyLabel } from '../../lib/deviceFamily'

const PAGE = 50

type SortKey = 'date' | 'device' | 'type' | 'weight' | 'result'
type SortDir = 'asc' | 'desc'

/** Default sort direction when a column is first selected. */
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  date: 'desc',    // newest first
  device: 'asc',
  type: 'asc',
  weight: 'desc',  // heaviest first
  result: 'desc',  // passes first (pass=true ranks above fail=false)
}

function compareRows(a: SessionListRow, b: SessionListRow, key: SortKey): number {
  switch (key) {
    case 'date': return new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
    case 'device': {
      const an = (a.device_nickname ?? a.device_id).toLowerCase()
      const bn = (b.device_nickname ?? b.device_id).toLowerCase()
      return an.localeCompare(bn)
    }
    case 'type': {
      const af = deviceTypeToFamily(a.device_type) ?? a.device_type
      const bf = deviceTypeToFamily(b.device_type) ?? b.device_type
      return String(af).localeCompare(String(bf))
    }
    case 'weight': {
      const av = a.body_weight_n ?? -Infinity
      const bv = b.body_weight_n ?? -Infinity
      return av - bv
    }
    case 'result': {
      // rank: true (1) > false (0) > null (-1)
      const rank = (v: boolean | null) => v === true ? 1 : v === false ? 0 : -1
      return rank(a.session_passed) - rank(b.session_passed)
    }
  }
}

export function SessionList({ filter, onOpen }: { filter: DashboardFilters; onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<SessionListRow[]>([])
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [done, setDone] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

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

  const sortedRows = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      const cmp = compareRows(a, b, sortKey)
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [rows, sortKey, sortDir])

  const onSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir(DEFAULT_DIR[key])
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="telemetry-label uppercase">Recent sessions</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b border-border">
            <SortHeader label="Date"   sortKey="date"   active={sortKey} dir={sortDir} onSort={onSort} />
            <SortHeader label="Device" sortKey="device" active={sortKey} dir={sortDir} onSort={onSort} />
            <SortHeader label="Type"   sortKey="type"   active={sortKey} dir={sortDir} onSort={onSort} />
            <th className="pb-2 pr-4 telemetry-label uppercase">Tester</th>
            <SortHeader label="Weight" sortKey="weight" active={sortKey} dir={sortDir} onSort={onSort} />
            <th className="pb-2 pr-4 telemetry-label uppercase">Model</th>
            <SortHeader label="Result" sortKey="result" active={sortKey} dir={sortDir} onSort={onSort} />
            <th className="pb-2 telemetry-label uppercase">Cells</th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((r) => {
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
      {!loading && sortedRows.length === 0 && (
        <p className="text-muted-foreground text-sm">No sessions match.</p>
      )}
    </div>
  )
}

function SortHeader({
  label, sortKey, active, dir, onSort,
}: {
  label: string
  sortKey: SortKey
  active: SortKey
  dir: SortDir
  onSort: (k: SortKey) => void
}) {
  const isActive = active === sortKey
  return (
    <th
      onClick={() => onSort(sortKey)}
      className={`pb-2 pr-4 telemetry-label uppercase select-none cursor-pointer transition-colors group ${
        isActive ? 'text-foreground' : 'hover:text-foreground'
      }`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`text-xs leading-none ${isActive ? 'text-foreground' : 'text-muted-foreground/60 group-hover:text-foreground'}`}>
          {isActive ? (dir === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </span>
    </th>
  )
}
