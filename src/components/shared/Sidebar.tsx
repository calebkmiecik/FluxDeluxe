import { useUiStore } from '../../stores/uiStore'
import { useDeviceStore } from '../../stores/deviceStore'
import { colors } from '../../lib/theme'
import fluxliteIcon from '../../assets/fluxlite-icon.svg'

const NAV_ITEMS = [
  { id: 'launcher' as const, icon: '⊞', label: 'Home' },
  { id: 'fluxlite' as const, icon: '⚡', label: 'FluxLite' },
] as const

export function Sidebar() {
  const { currentPage, navigate } = useUiStore()
  const connectionState = useDeviceStore((s) => s.connectionState)
  const devices = useDeviceStore((s) => s.devices)

  return (
    <div className="flex flex-col w-40 border-r border-border overflow-hidden" style={{ backgroundColor: colors.surfaceDark }}>
      {/* Logo */}
      <div className="flex items-center gap-2 px-3 py-3">
        <img src={fluxliteIcon} className="w-8 h-8 flex-shrink-0" />
        <span className="text-sm font-semibold text-foreground">FluxLite</span>
      </div>

      {/* Divider below logo */}
      <div className="border-t border-border mx-3 my-2" />

      {/* Nav items */}
      <nav className="flex flex-col gap-1 flex-1">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => navigate(item.id)}
            className={`flex items-center gap-3 py-2 px-3 text-sm transition-colors ${
              currentPage === item.id
                ? 'border-l-2 border-l-primary bg-primary/10 text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
            }`}
          >
            <span className="text-lg w-6 text-center flex-shrink-0">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Divider above status */}
      <div className="border-t border-border mx-3 my-2" />

      {/* Status section */}
      <div className="px-3 pb-3">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
            connectionState === 'READY'
              ? 'bg-success'
              : connectionState === 'DISCONNECTED' || connectionState === 'ERROR'
              ? 'bg-danger'
              : 'bg-warning animate-pulse'
          }`} />
          <span className="text-xs text-muted-foreground">
            {connectionState === 'READY'
              ? `${devices.length} device${devices.length !== 1 ? 's' : ''}`
              : connectionState.toLowerCase().replace('_', ' ')}
          </span>
        </div>
      </div>
    </div>
  )
}
