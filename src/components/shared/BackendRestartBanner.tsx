import { useEffect, useState } from 'react'
import { useUiStore } from '../../stores/uiStore'
import { plate3d } from '../../lib/theme'

const COUNTDOWN_SECONDS = 5

export function BackendRestartBanner() {
  const pending = useUiStore((s) => s.backendRestartPending)
  const setPending = useUiStore((s) => s.setBackendRestartPending)
  const [seconds, setSeconds] = useState(COUNTDOWN_SECONDS)

  // Reset the counter whenever we transition from idle → pending.
  useEffect(() => {
    if (pending) setSeconds(COUNTDOWN_SECONDS)
  }, [pending])

  // Tick down once per second while pending; fire the restart at 0.
  useEffect(() => {
    if (!pending) return
    if (seconds <= 0) {
      window.electronAPI?.restartDynamo()
      setPending(false)
      return
    }
    const id = setTimeout(() => setSeconds((s) => s - 1), 1000)
    return () => clearTimeout(id)
  }, [pending, seconds, setPending])

  if (!pending) return null

  return (
    <div
      className="fixed left-1/2 bottom-6 -translate-x-1/2 z-50 flex items-center gap-4 px-5 py-3 rounded-md border bg-surface-dark shadow-2xl"
      style={{
        borderColor: `${plate3d.edgeCyan}60`,
        backdropFilter: 'blur(8px)',
      }}
    >
      <div
        className="w-2 h-2 rounded-full"
        style={{
          backgroundColor: plate3d.edgeCyan,
          animation: 'status-breathe 1.2s ease-in-out infinite',
        }}
      />
      <div className="flex flex-col gap-0.5">
        <span className="telemetry-label uppercase text-foreground">
          Model packaged
        </span>
        <span className="text-sm text-muted-foreground">
          Restarting backend in{' '}
          <span className="font-mono text-foreground">{seconds}s</span>
        </span>
      </div>
      <div className="flex items-center gap-2 ml-2">
        <button
          onClick={() => {
            window.electronAPI?.restartDynamo()
            setPending(false)
          }}
          className="px-3 py-1 text-xs border rounded bg-transparent transition-colors"
          style={{ borderColor: plate3d.edgeCyan, color: plate3d.edgeCyan }}
        >
          Restart now
        </button>
        <button
          onClick={() => setPending(false)}
          className="px-3 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
