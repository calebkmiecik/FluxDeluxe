import { useDeviceStore } from '../../stores/deviceStore'
import { useSessionStore } from '../../stores/sessionStore'

export function IdleView() {
  const devices = useDeviceStore((s) => s.devices)
  const connectionState = useDeviceStore((s) => s.connectionState)
  const setPhase = useSessionStore((s) => s.setSessionPhase)

  return (
    <div className="flex-1 flex flex-col p-6 gap-6 overflow-auto">
      {/* Quick-start */}
      <div className="bg-surface rounded-lg border border-border p-6">
        <h2 className="text-lg font-semibold mb-4">Start Testing</h2>
        {connectionState !== 'READY' ? (
          <p className="text-zinc-400">Waiting for backend connection...</p>
        ) : devices.length === 0 ? (
          <p className="text-zinc-400">No devices connected. Connect a force plate to begin.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-zinc-400">{devices.length} device{devices.length !== 1 ? 's' : ''} connected</p>
            <button
              onClick={() => setPhase('WARMUP')}
              className="self-start px-4 py-2 bg-primary text-white rounded hover:bg-primary/80 transition-colors"
            >
              Begin Session
            </button>
          </div>
        )}
      </div>

      {/* Recent tests placeholder */}
      <div className="bg-surface rounded-lg border border-border p-6 flex-1">
        <h2 className="text-lg font-semibold mb-4">Recent Tests</h2>
        <p className="text-zinc-400">No recent tests.</p>
      </div>
    </div>
  )
}
