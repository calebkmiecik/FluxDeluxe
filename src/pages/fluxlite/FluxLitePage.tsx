import { useSessionStore } from '../../stores/sessionStore'
import { useUiStore } from '../../stores/uiStore'
import { IdleView } from './IdleView'
import { GateView } from './GateView'
import { LiveView } from './LiveView'
import { SummaryView } from './SummaryView'

const LITE_NAV = [
  { id: 'live' as const, label: 'Live' },
  { id: 'history' as const, label: 'History' },
  { id: 'models' as const, label: 'Models' },
] as const

export function FluxLitePage() {
  const phase = useSessionStore((s) => s.sessionPhase)
  const { activeLitePage, setActiveLitePage } = useUiStore()

  const isActiveSession = phase !== 'IDLE'

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Sub-nav tabs (only shown when IDLE) */}
      {!isActiveSession && (
        <div className="flex gap-1 px-4 pt-3 pb-1 border-b border-border">
          {LITE_NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveLitePage(item.id)}
              className={`px-3 py-1.5 text-sm rounded-t transition-colors ${
                activeLitePage === item.id
                  ? 'text-white bg-surface border-b-2 border-primary'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {/* Phase-aware content */}
      <div className="flex-1 overflow-hidden">
        {isActiveSession ? (
          phase === 'WARMUP' || phase === 'TARE' ? <GateView /> :
          phase === 'SUMMARY' ? <SummaryView /> :
          <LiveView />
        ) : (
          activeLitePage === 'live' ? <IdleView /> :
          activeLitePage === 'history' ? <div className="p-4 text-zinc-400">History (coming soon)</div> :
          <div className="p-4 text-zinc-400">Models (coming soon)</div>
        )}
      </div>
    </div>
  )
}
