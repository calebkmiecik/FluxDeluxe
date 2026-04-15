import { DashboardOverview } from './DashboardOverview'

export function DashboardPage() {
  return (
    <div className="flex-1 flex flex-col p-4 gap-4 overflow-auto">
      <h2 className="text-lg font-semibold">Dashboard</h2>
      <DashboardOverview />
    </div>
  )
}
