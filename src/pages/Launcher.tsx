import { useUiStore } from '../stores/uiStore'

const TOOLS = [
  { id: 'fluxlite', name: 'FluxLite', description: 'Live force plate testing', icon: '⚡' },
] as const

export function Launcher() {
  const navigate = useUiStore((s) => s.navigate)

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <h1 className="text-3xl font-bold mb-2">FluxDeluxe</h1>
      <p className="text-zinc-400 mb-8">Select a tool to get started</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            onClick={() => navigate('fluxlite')}
            className="flex flex-col items-center gap-3 p-6 rounded-lg bg-surface border border-border hover:border-primary/50 transition-colors"
          >
            <span className="text-3xl">{tool.icon}</span>
            <span className="font-semibold">{tool.name}</span>
            <span className="text-sm text-zinc-400">{tool.description}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
