export function DashboardPage() {
  return (
    <div className="flex-1 flex flex-col p-4 gap-4 overflow-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Dashboard</h2>
      </div>
      <p className="text-muted-foreground text-sm">
        Overview and recent sessions will appear here.
      </p>
    </div>
  )
}
