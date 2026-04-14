import { useUiStore } from '../stores/uiStore'
import fluxliteIcon from '../assets/fluxlite-icon.svg'

const TOOLS = [
  { id: 'fluxlite', name: 'FluxLite', description: 'Live force plate testing' },
] as const

export function Launcher() {
  const navigate = useUiStore((s) => s.navigate)

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <h1 className="text-2xl font-bold tracking-tight mb-2">FluxDeluxe</h1>
      <p className="text-muted-foreground mb-8">Select a tool to get started</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            onClick={() => navigate('fluxlite')}
            className="flex flex-col items-center gap-3 bg-card border border-border rounded-lg p-6 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all duration-150"
          >
            <img src={fluxliteIcon} className="w-24 h-24" alt="FluxLite" />
            <span className="font-semibold text-foreground">{tool.name}</span>
            <span className="text-sm text-muted-foreground">{tool.description}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
