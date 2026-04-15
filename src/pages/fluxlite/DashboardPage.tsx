import { useEffect, useState } from 'react'
import { DashboardOverview } from './DashboardOverview'
import { SessionList } from './SessionList'
import { SessionDetailModal } from './SessionDetailModal'
import { toast } from 'sonner'

export function DashboardPage() {
  const [openId, setOpenId] = useState<string | null>(null)
  const [queued, setQueued] = useState(0)
  const [poison, setPoison] = useState(0)
  const [retrying, setRetrying] = useState(false)

  const refreshStatus = async () => {
    if (!window.electronAPI?.liveTest) return
    const s = await window.electronAPI.liveTest.queueStatus()
    setQueued(s.queued)
    setPoison(s.poison)
  }

  useEffect(() => { refreshStatus() }, [])

  const retry = async () => {
    if (!window.electronAPI?.liveTest) return
    setRetrying(true)
    const result = await window.electronAPI.liveTest.retryQueued()
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
          {queued > 0 && (
            <span className="text-xs text-muted-foreground">
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
      <DashboardOverview />
      <SessionList onOpen={setOpenId} />
      {openId && <SessionDetailModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}
