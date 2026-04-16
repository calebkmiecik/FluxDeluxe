import { useEffect, useState } from 'react'
import { DashboardOverview } from './DashboardOverview'
import { SessionList } from './SessionList'
import { SessionDetailModal } from './SessionDetailModal'
import { toast } from 'sonner'
import { enableDummy, disableDummy } from '../../lib/dashboardDummyData'
import { liveTestClient } from '../../lib/liveTestClient'

const DUMMY_KEY = 'fluxdeluxe.dashboardDummy'

export function DashboardPage() {
  const [openId, setOpenId] = useState<string | null>(null)
  const [queued, setQueued] = useState(0)
  const [poison, setPoison] = useState(0)
  const [retrying, setRetrying] = useState(false)
  // Lazy init applies the patch BEFORE children mount & fire their fetches.
  const [dummy, setDummyState] = useState<boolean>(() => {
    const on = localStorage.getItem(DUMMY_KEY) === '1'
    if (on) enableDummy()
    return on
  })

  const setDummy = (next: boolean) => {
    // Apply the patch synchronously BEFORE the re-render so remounted
    // children see the right window.electronAPI.liveTest on their first fetch.
    if (next) enableDummy()
    else disableDummy()
    localStorage.setItem(DUMMY_KEY, next ? '1' : '0')
    setDummyState(next)
    refreshStatus()
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
    <div className="flex-1 flex flex-col p-4 gap-6 overflow-auto">
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
      <DashboardOverview key={`overview-${dummy}`} />
      <SessionList key={`list-${dummy}`} onOpen={setOpenId} />
      {openId && <SessionDetailModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}
