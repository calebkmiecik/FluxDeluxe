import { useSessionStore } from '../../stores/sessionStore'
import { getSocket } from '../../lib/socket'

export function GateView() {
  const phase = useSessionStore((s) => s.sessionPhase)
  const setPhase = useSessionStore((s) => s.setSessionPhase)

  const handleTare = () => {
    getSocket().emit('tareAll')
    setPhase('ARMED')
  }

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="flex flex-col items-center">
        <div className="telemetry-label mb-3">{phase}</div>
        <div className="bg-card border border-border rounded-lg p-8 max-w-md text-center">
          {phase === 'WARMUP' ? (
            <>
              <h2 className="text-xl font-semibold tracking-tight mb-4">Warmup</h2>
              <p className="text-muted-foreground mb-6">Allow the plate to reach stable temperature before testing.</p>
              <button
                onClick={() => setPhase('TARE')}
                className="px-6 py-2 bg-primary text-white rounded-md btn-glow transition-colors"
              >
                Warmup Complete
              </button>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold tracking-tight mb-4">Tare</h2>
              <p className="text-muted-foreground mb-6">Ensure nothing is on the plate, then tare to zero the baseline.</p>
              <button
                onClick={handleTare}
                className="px-6 py-2 bg-primary text-white rounded-md btn-glow transition-colors"
              >
                Tare & Begin
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
