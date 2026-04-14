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
      <div className="bg-surface rounded-lg border border-border p-8 max-w-md text-center">
        {phase === 'WARMUP' ? (
          <>
            <h2 className="text-xl font-semibold mb-4">Warmup</h2>
            <p className="text-zinc-400 mb-6">Allow the plate to reach stable temperature before testing.</p>
            <button
              onClick={() => setPhase('TARE')}
              className="px-6 py-2 bg-primary text-white rounded hover:bg-primary/80 transition-colors"
            >
              Warmup Complete
            </button>
          </>
        ) : (
          <>
            <h2 className="text-xl font-semibold mb-4">Tare</h2>
            <p className="text-zinc-400 mb-6">Ensure nothing is on the plate, then tare to zero the baseline.</p>
            <button
              onClick={handleTare}
              className="px-6 py-2 bg-primary text-white rounded hover:bg-primary/80 transition-colors"
            >
              Tare & Begin
            </button>
          </>
        )}
      </div>
    </div>
  )
}
