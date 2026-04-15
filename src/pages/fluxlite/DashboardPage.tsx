import { useState } from 'react'
import { DashboardOverview } from './DashboardOverview'
import { SessionList } from './SessionList'
import { SessionDetailModal } from './SessionDetailModal'

export function DashboardPage() {
  const [openId, setOpenId] = useState<string | null>(null)
  return (
    <div className="flex-1 flex flex-col p-4 gap-6 overflow-auto">
      <h2 className="text-lg font-semibold">Dashboard</h2>
      <DashboardOverview />
      <SessionList onOpen={setOpenId} />
      {openId && <SessionDetailModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}
