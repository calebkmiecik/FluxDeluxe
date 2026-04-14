import { useSessionStore } from '../../stores/sessionStore'

export function SummaryView() {
  const setPhase = useSessionStore((s) => s.setSessionPhase)

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4">
      <h2 className="text-xl font-semibold">Capture Complete</h2>
      <p className="text-zinc-400">Results will be displayed here.</p>
      <div className="flex gap-3">
        <button
          onClick={() => setPhase('ARMED')}
          className="px-4 py-2 bg-surface border border-border rounded hover:bg-white/5 transition-colors"
        >
          Test Again
        </button>
        <button
          onClick={() => setPhase('IDLE')}
          className="px-4 py-2 bg-primary text-white rounded hover:bg-primary/80 transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  )
}
