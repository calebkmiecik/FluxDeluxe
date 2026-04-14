import { useSessionStore } from '../../stores/sessionStore'

export function SummaryView() {
  const setPhase = useSessionStore((s) => s.setSessionPhase)

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
      <div className="bg-card border border-border rounded-lg max-w-lg p-8 w-full text-center">
        <h2 className="text-xl font-semibold mb-2">Capture Complete</h2>
        <p className="text-muted-foreground mb-6">Review results below.</p>

        {/* Metrics placeholder — will be populated via getCaptureMetrics */}
        <div className="bg-background rounded-md p-4 mb-6">
          <p className="text-muted-foreground text-sm">Capture metrics will be displayed here.</p>
        </div>

        <div className="flex gap-3 justify-center">
          <button
            onClick={() => setPhase('ARMED')}
            className="px-4 py-2 bg-transparent border border-border text-muted-foreground hover:bg-white/5 hover:text-foreground rounded-md transition-colors"
          >
            Test Again
          </button>
          <button
            onClick={() => setPhase('IDLE')}
            className="px-4 py-2 bg-primary text-white rounded-md btn-glow transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
