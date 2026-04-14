import { useSessionStore } from '../../stores/sessionStore'
import { useDeviceStore } from '../../stores/deviceStore'
import { getSocket } from '../../lib/socket'
import { Play, Square, X, RotateCcw, RefreshCw, Scale } from 'lucide-react'

const PHASE_DISPLAY: Record<string, { label: string; color: string; className?: string }> = {
  IDLE:      { label: 'STANDBY', color: 'bg-muted-foreground' },
  WARMUP:    { label: 'WARMUP',  color: 'bg-warning', className: 'status-live' },
  TARE:      { label: 'TARE',    color: 'bg-warning', className: 'status-live' },
  ARMED:     { label: 'ARMED',   color: 'bg-success' },
  STABLE:    { label: 'STABLE',  color: 'bg-success' },
  CAPTURING: { label: 'REC',     color: 'bg-danger',  className: 'status-live' },
  SUMMARY:   { label: 'COMPLETE', color: 'bg-primary' },
}

export function ControlPanel() {
  const phase = useSessionStore((s) => s.sessionPhase)
  const setPhase = useSessionStore((s) => s.setSessionPhase)
  const connectionState = useDeviceStore((s) => s.connectionState)
  const devices = useDeviceStore((s) => s.devices)
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId)
  const selectDevice = useDeviceStore((s) => s.selectDevice)

  const selectedDevice = devices.find((d) => d.axfId === selectedDeviceId)
  const phaseInfo = PHASE_DISPLAY[phase] ?? PHASE_DISPLAY.IDLE

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
      {/* ── Device Section ─────────────────────────────── */}
      <Section label="Device">
        {devices.length > 0 ? (
          <>
            <select
              value={selectedDeviceId || ''}
              onChange={(e) => selectDevice(e.target.value || null)}
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono text-foreground focus:border-primary focus:outline-none transition-colors"
            >
              <option value="">Select device...</option>
              {devices.map((d) => (
                <option key={d.axfId} value={d.axfId}>
                  {d.name || d.axfId} (Type {d.deviceTypeId})
                </option>
              ))}
            </select>

            {selectedDevice && (
              <div className="mt-3 panel-inset p-3 grid grid-cols-2 gap-3">
                <div>
                  <div className="telemetry-label">Type</div>
                  <div className="telemetry-value">{selectedDevice.deviceTypeId}</div>
                </div>
                <div>
                  <div className="telemetry-label">Serial</div>
                  <div className="telemetry-value text-sm">{selectedDevice.axfId.slice(-8)}</div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="panel-inset p-3">
            <span className="text-sm text-muted-foreground font-mono">No devices found</span>
          </div>
        )}
      </Section>

      {/* ── Session Section ────────────────────────────── */}
      <Section label="Session">
        {/* Phase badge */}
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${phaseInfo.color} ${phaseInfo.className ?? ''}`} />
          <span className="font-mono text-xs tracking-widest text-foreground">
            {phaseInfo.label}
          </span>
        </div>

        {/* Phase-specific controls */}
        {phase === 'IDLE' && (
          <button
            onClick={handleStartSession}
            disabled={connectionState !== 'READY' || !selectedDeviceId}
            className="w-full flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium tracking-wide bg-primary text-white rounded-md btn-glow transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Play size={16} fill="currentColor" />
            Start Session
          </button>
        )}

        {(phase === 'ARMED' || phase === 'STABLE' || phase === 'CAPTURING') && (
          <div className="flex flex-col gap-2">
            {phase === 'CAPTURING' && (
              <button
                onClick={handleStopCapture}
                className="w-full flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium bg-destructive text-white rounded-md transition-colors"
              >
                <Square size={14} fill="currentColor" />
                Stop Capture
              </button>
            )}
            <button
              onClick={handleCancelSession}
              className="w-full flex items-center justify-center gap-2 px-5 py-2.5 text-sm bg-transparent border border-border text-muted-foreground rounded-md hover:bg-white/5 hover:text-foreground transition-colors"
            >
              <X size={14} />
              End Session
            </button>
          </div>
        )}

        {phase === 'SUMMARY' && (
          <div className="flex flex-col gap-2">
            <div className="panel-inset p-4 mb-1">
              <p className="text-muted-foreground text-sm font-mono">Capture metrics will appear here.</p>
            </div>
            <button
              onClick={() => setPhase('ARMED')}
              className="w-full flex items-center justify-center gap-2 px-5 py-2.5 text-sm bg-transparent border border-border text-muted-foreground rounded-md hover:bg-white/5 hover:text-foreground transition-colors"
            >
              <RotateCcw size={14} />
              Test Again
            </button>
            <button
              onClick={() => setPhase('IDLE')}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium bg-primary text-white rounded-md btn-glow transition-all"
            >
              Done
            </button>
          </div>
        )}
      </Section>

      {/* ── Actions Section ────────────────────────────── */}
      <Section label="Actions">
        <div className="flex flex-col gap-2">
          <button
            onClick={handleTare}
            disabled={connectionState !== 'READY'}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm bg-transparent border border-border text-muted-foreground rounded-md hover:bg-white/5 hover:text-foreground transition-colors disabled:opacity-40"
          >
            <Scale size={14} />
            Tare All
          </button>
          <button
            onClick={() => getSocket().emit('getConnectedDevices')}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm bg-transparent border border-border text-muted-foreground rounded-md hover:bg-white/5 hover:text-foreground transition-colors"
          >
            <RefreshCw size={14} />
            Refresh Devices
          </button>
        </div>
      </Section>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-4 border-b border-border">
      <div className="telemetry-label mb-3">{label}</div>
      {children}
    </div>
  )
}
