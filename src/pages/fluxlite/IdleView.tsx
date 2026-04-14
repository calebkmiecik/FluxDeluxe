import { useDeviceStore } from '../../stores/deviceStore'
import { useSessionStore } from '../../stores/sessionStore'

export function IdleView() {
  const devices = useDeviceStore((s) => s.devices)
  const connectionState = useDeviceStore((s) => s.connectionState)
  const setPhase = useSessionStore((s) => s.setSessionPhase)

  return (
    <div className="flex-1 flex flex-col p-6 gap-6 overflow-auto">
      {/* Quick-start */}
      <div className="card-accent bg-card rounded-lg border border-border p-6">
        <h2 className="text-base font-semibold tracking-tight mb-4">Start Testing</h2>
        {connectionState !== 'READY' ? (
          <p className="text-muted-foreground">Waiting for backend connection...</p>
        ) : devices.length === 0 ? (
          <p className="text-muted-foreground">No devices connected. Connect a force plate to begin.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <div className="telemetry-label">Connected Devices</div>
              <div className="telemetry-value">{devices.length}</div>
            </div>
            <button
              onClick={() => setPhase('WARMUP')}
              className="self-start px-4 py-2 bg-primary text-white rounded-md btn-glow transition-colors"
            >
              Begin Session
            </button>
          </div>
        )}
      </div>

      {/* Recent tests placeholder */}
      <div className="bg-card rounded-lg border border-border p-6 flex-1">
        <h2 className="text-base font-semibold tracking-tight mb-4">Recent Tests</h2>
        <p className="text-muted-foreground">No recent tests.</p>
      </div>
    </div>
  )
}
