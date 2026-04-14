import { useUiStore } from '../../stores/uiStore'
import { useDeviceStore } from '../../stores/deviceStore'
import { colors } from '../../lib/theme'
import { LayoutGrid, Zap, Wifi, WifiOff, Radio } from 'lucide-react'
import fluxliteIcon from '../../assets/fluxlite-icon.svg'

const NAV_ITEMS = [
  { id: 'launcher' as const, Icon: LayoutGrid, label: 'Home' },
  { id: 'fluxlite' as const, Icon: Zap, label: 'FluxLite' },
] as const

export function Sidebar() {
  const { currentPage, navigate } = useUiStore()
  const connectionState = useDeviceStore((s) => s.connectionState)
  const devices = useDeviceStore((s) => s.devices)

  const isConnected = connectionState === 'READY'
  const isError = connectionState === 'DISCONNECTED' || connectionState === 'ERROR'

  return (
    <div className="flex flex-col w-44 border-r border-border overflow-hidden" style={{ backgroundColor: colors.surfaceDark }}>
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-3 py-3">
        <img src={fluxliteIcon} className="w-7 h-7 flex-shrink-0" />
        <span className="text-sm font-semibold tracking-wide text-foreground">FluxDeluxe</span>
      </div>

      {/* Divider */}
      <div className="h-px bg-border mx-3" />

      {/* Nav items */}
      <nav className="flex flex-col gap-0.5 flex-1 mt-3 px-2">
        {NAV_ITEMS.map((item) => {
          const active = currentPage === item.id
          return (
            <button
              key={item.id}
              onClick={() => navigate(item.id)}
              className={`group flex items-center gap-3 py-2 px-2.5 text-sm rounded-md transition-all duration-150 ${
                active
                  ? 'bg-primary/12 text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
              }`}
            >
              <item.Icon
                size={18}
                strokeWidth={active ? 2 : 1.5}
                className={`flex-shrink-0 transition-colors ${active ? 'text-primary' : ''}`}
              />
              <span className="tracking-wide">{item.label}</span>
            </button>
          )
        })}
      </nav>

      {/* Status section */}
      <div className="h-px bg-border mx-3" />
      <div className="px-3 py-3">
        <div className="flex items-center gap-2.5">
          {isConnected ? (
            <Wifi size={14} className="text-success flex-shrink-0" />
          ) : isError ? (
            <WifiOff size={14} className="text-danger flex-shrink-0" />
          ) : (
            <Radio size={14} className="text-warning animate-pulse flex-shrink-0" />
          )}
          <span className="text-xs font-mono text-muted-foreground tracking-wide">
            {isConnected
              ? `${devices.length} device${devices.length !== 1 ? 's' : ''}`
              : connectionState.toLowerCase().replace('_', ' ')}
          </span>
        </div>
      </div>
    </div>
  )
}
