import type { DataMode } from '../../lib/dataMode'

interface DataModeToggleProps {
  mode: DataMode
  onChange: (mode: DataMode) => void
}

const OPTIONS: { value: DataMode; label: string }[] = [
  { value: 'forces', label: 'Forces' },
  { value: 'moments', label: 'Moments' },
]

export function DataModeToggle({ mode, onChange }: DataModeToggleProps) {
  return (
    <div className="inline-flex items-center rounded-md border border-border bg-surface-dark/90 backdrop-blur p-0.5">
      {OPTIONS.map((opt) => {
        const active = mode === opt.value
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              active
                ? 'bg-white/10 text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
