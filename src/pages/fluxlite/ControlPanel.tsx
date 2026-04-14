import { useSessionStore } from '../../stores/sessionStore'
import { useDeviceStore } from '../../stores/deviceStore'
import { getSocket } from '../../lib/socket'

export function ControlPanel() {
  const phase = useSessionStore((s) => s.sessionPhase)
  const setPhase = useSessionStore((s) => s.setSessionPhase)
  const connectionState = useDeviceStore((s) => s.connectionState)
  const devices = useDeviceStore((s) => s.devices)
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId)
  const selectDevice = useDeviceStore((s) => s.selectDevice)

  const selectedDevice = devices.find((d) => d.axfId === selectedDeviceId)

  const handleTare = () => {
    getSocket().emit('tareAll')
  }

  const handleStartSession = () => {
    getSocket().emit('tareAll')
    setPhase('ARMED')
  }

  const handleStopCapture = () => {
    getSocket().emit('stopCapture', {})
  }

  const handleCancelSession = () => {
    getSocket().emit('cancelCapture', {})
    setPhase('IDLE')
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Connection status */}
      <Section>
        <div className="flex items-center gap-2 mb-2">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
            connectionState === 'READY' ? 'bg-success' :
            connectionState === 'DISCONNECTED' || connectionState === 'ERROR' ? 'bg-danger' :
            'bg-warning animate-pulse'
          }`} />
          <span className="telemetry-label">
            {connectionState === 'READY' ? 'Connected' : connectionState.toLowerCase().replace('_', ' ')}
          </span>
        </div>

        {/* Device selector */}
        {devices.length > 0 && (
          <div className="mt-2">
            <div className="telemetry-label mb-1">Device</div>
            <select
              value={selectedDeviceId || ''}
              onChange={(e) => selectDevice(e.target.value || null)}
              className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm text-foreground"
            >
              <option value="">Select device...</option>
              {devices.map((d) => (
                <option key={d.axfId} value={d.axfId}>
                  {d.name || d.axfId} (Type {d.deviceTypeId})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Device info */}
        {selectedDevice && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <div className="telemetry-label">Type</div>
              <div className="telemetry-value text-sm">{selectedDevice.deviceTypeId}</div>
            </div>
            <div>
              <div className="telemetry-label">ID</div>
              <div className="telemetry-value text-sm font-mono">{selectedDevice.axfId.slice(-8)}</div>
            </div>
          </div>
        )}
      </Section>

      {/* Session status */}
      <Section>
        <div className="flex items-center gap-2 mb-3">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
            phase === 'CAPTURING' ? 'bg-danger animate-pulse' :
            phase === 'ARMED' || phase === 'STABLE' ? 'bg-success' :
            'bg-muted-foreground'
          }`} />
          <span className="telemetry-label">
            {phase === 'IDLE' ? 'Ready' :
             phase === 'ARMED' ? 'Armed' :
             phase === 'STABLE' ? 'Stable' :
             phase === 'CAPTURING' ? 'Capturing' :
             phase === 'SUMMARY' ? 'Complete' :
             phase}
          </span>
        </div>

        {/* Phase-specific controls */}
        {phase === 'IDLE' && (
          <div className="flex flex-col gap-2">
            <button
              onClick={handleStartSession}
              disabled={connectionState !== 'READY' || !selectedDeviceId}
              className="w-full px-4 py-2 bg-primary text-white rounded-md btn-glow transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Start Session
            </button>
          </div>
        )}

        {(phase === 'ARMED' || phase === 'STABLE' || phase === 'CAPTURING') && (
          <div className="flex flex-col gap-2">
            {phase === 'CAPTURING' && (
              <button
                onClick={handleStopCapture}
                className="w-full px-4 py-2 bg-destructive text-white rounded-md transition-colors"
              >
                Stop Capture
              </button>
            )}
            <button
              onClick={handleCancelSession}
              className="w-full px-4 py-2 bg-transparent border border-border text-muted-foreground rounded-md hover:bg-white/5 hover:text-foreground transition-colors"
            >
              End Session
            </button>
          </div>
        )}

        {phase === 'SUMMARY' && (
          <div className="flex flex-col gap-2">
            <div className="bg-background rounded-md p-3 mb-1">
              <p className="text-muted-foreground text-xs">Capture metrics will appear here.</p>
            </div>
            <button
              onClick={() => setPhase('ARMED')}
              className="w-full px-4 py-2 bg-transparent border border-border text-muted-foreground rounded-md hover:bg-white/5 hover:text-foreground transition-colors"
            >
              Test Again
            </button>
            <button
              onClick={() => setPhase('IDLE')}
              className="w-full px-4 py-2 bg-primary text-white rounded-md btn-glow transition-colors"
            >
              Done
            </button>
          </div>
        )}
      </Section>

      {/* Quick actions */}
      <Section>
        <div className="telemetry-label mb-2">Actions</div>
        <div className="flex flex-col gap-1.5">
          <button
            onClick={handleTare}
            disabled={connectionState !== 'READY'}
            className="w-full px-3 py-1.5 text-sm bg-transparent border border-border text-muted-foreground rounded-md hover:bg-white/5 hover:text-foreground transition-colors disabled:opacity-40"
          >
            Tare All
          </button>
          <button
            onClick={() => getSocket().emit('getConnectedDevices')}
            className="w-full px-3 py-1.5 text-sm bg-transparent border border-border text-muted-foreground rounded-md hover:bg-white/5 hover:text-foreground transition-colors"
          >
            Refresh Devices
          </button>
        </div>
      </Section>
    </div>
  )
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-3 border-b border-border">
      {children}
    </div>
  )
}
