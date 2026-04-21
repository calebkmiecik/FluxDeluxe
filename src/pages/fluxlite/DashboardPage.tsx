import { useEffect, useState } from 'react'
import { DashboardOverview } from './DashboardOverview'
import { DashboardTrend } from './DashboardTrend'
import { SessionList } from './SessionList'
import { SessionDetailModal } from './SessionDetailModal'
import { DashboardFiltersBar } from './DashboardFiltersBar'
import { toast } from 'sonner'
import { enableDummy, disableDummy } from '../../lib/dashboardDummyData'
import { liveTestClient } from '../../lib/liveTestClient'
import { DEFAULT_FILTERS, type DashboardFilters } from '../../lib/dashboardFilters'

const DUMMY_KEY = 'fluxdeluxe.dashboardDummy'
const FILTERS_KEY = 'fluxdeluxe.dashboardFilters'

function loadFilters(): DashboardFilters {
  try {
    const raw = localStorage.getItem(FILTERS_KEY)
    if (!raw) return DEFAULT_FILTERS
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_FILTERS, ...parsed }
  } catch {
    return DEFAULT_FILTERS
  }
}

export function DashboardPage() {
  const [openId, setOpenId] = useState<string | null>(null)
  const [queued, setQueued] = useState(0)
  const [poison, setPoison] = useState(0)
  const [retrying, setRetrying] = useState(false)
  const [filters, setFiltersState] = useState<DashboardFilters>(loadFilters)

  // Lazy init applies the dummy patch BEFORE children mount & fire their fetches.
  const [dummy, setDummyState] = useState<boolean>(() => {
    const on = localStorage.getItem(DUMMY_KEY) === '1'
    if (on) enableDummy()
    return on
  })

  const setDummy = (next: boolean) => {
    if (next) enableDummy()
    else disableDummy()
    localStorage.setItem(DUMMY_KEY, next ? '1' : '0')
    setDummyState(next)
    refreshStatus()
  }

  const setFilters = (next: DashboardFilters) => {
    setFiltersState(next)
    localStorage.setItem(FILTERS_KEY, JSON.stringify(next))
  }

  const refreshStatus = async () => {
    const s = await liveTestClient.queueStatus()
    setQueued(s.queued)
    setPoison(s.poison)
  }

  useEffect(() => { refreshStatus() }, [])

  const retry = async () => {
    setRetrying(true)
    const result = await liveTestClient.retryQueued()
    await refreshStatus()
    setRetrying(false)
    if (result.uploaded > 0) toast.success(`Uploaded ${result.uploaded} session(s)`)
    if (result.errors.length > 0) toast.warning(`${result.errors.length} still failing — see logs`)
  }

  return (
    <div className="flex-1 flex flex-col p-4 gap-4 overflow-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Dashboard</h2>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dummy}
              onChange={(e) => setDummy(e.target.checked)}
              className="accent-primary"
            />
            Dummy data
          </label>
          {queued > 0 && (
            <span className="text-xs text-muted-foreground ml-2">
              {queued} queued{poison > 0 ? `, ${poison} failed permanently` : ''}
            </span>
          )}
          <button
            onClick={retry}
            disabled={retrying || queued === 0}
            className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-white/5 disabled:opacity-50"
          >
            {retrying ? 'Retrying…' : 'Retry failed uploads'}
          </button>
        </div>
      </div>

      <DashboardFiltersBar filters={filters} onChange={setFilters} />

      <div className="flex flex-col gap-6">
        <DashboardOverview key={`overview-${dummy}`} filter={filters} />
        <DashboardTrend key={`trend-${dummy}`} filter={filters} />
        <SessionList key={`list-${dummy}`} filter={filters} onOpen={setOpenId} />
      </div>
      {openId && <SessionDetailModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}
