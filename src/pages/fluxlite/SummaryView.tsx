import { useSessionStore } from '../../stores/sessionStore'

export function SummaryView() {
  const setPhase = useSessionStore((s) => s.setSessionPhase)

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
      <div className="bg-surface rounded-lg border border-border p-8 max-w-lg w-full text-center">
        <h2 className="text-xl font-semibold mb-2">Capture Complete</h2>
        <p className="text-zinc-400 mb-6">Review results below.</p>

        {/* Metrics placeholder — will be populated via getCaptureMetrics */}
        <div className="bg-background rounded p-4 mb-6">
          <p className="text-zinc-500 text-sm">Capture metrics will be displayed here.</p>
        </div>

        <div className="flex gap-3 justify-center">
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
    </div>
  )
}
