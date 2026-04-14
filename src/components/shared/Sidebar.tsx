import { useUiStore } from '../../stores/uiStore'
import { useDeviceStore } from '../../stores/deviceStore'

const NAV_ITEMS = [
  { id: 'launcher' as const, icon: '⊞', label: 'Home' },
  { id: 'fluxlite' as const, icon: '⚡', label: 'FluxLite' },
] as const

export function Sidebar() {
  const { currentPage, navigate } = useUiStore()
  const connectionState = useDeviceStore((s) => s.connectionState)
  const devices = useDeviceStore((s) => s.devices)

  return (
    <div className="flex flex-col w-12 hover:w-48 transition-all duration-150 bg-surface border-r border-border group overflow-hidden">
      {/* Nav items */}
      <nav className="flex flex-col gap-1 p-2 flex-1">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => navigate(item.id)}
            className={`flex items-center gap-3 px-2 py-2 rounded text-sm transition-colors ${
              currentPage === item.id ? 'bg-primary/20 text-primary' : 'text-zinc-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <span className="text-lg w-6 text-center flex-shrink-0">{item.icon}</span>
            <span className="whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Device status dots */}
      <div className="p-2 border-t border-border">
        <div className="flex items-center gap-2 px-2">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
            connectionState === 'READY' ? 'bg-success' :
            connectionState === 'DISCONNECTED' || connectionState === 'ERROR' ? 'bg-danger' :
            'bg-warning animate-pulse'
          }`} />
          <span className="text-xs text-zinc-500 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
            {connectionState === 'READY' ? `${devices.length} device${devices.length !== 1 ? 's' : ''}` : connectionState.toLowerCase().replace('_', ' ')}
          </span>
        </div>
      </div>
    </div>
  )
}
