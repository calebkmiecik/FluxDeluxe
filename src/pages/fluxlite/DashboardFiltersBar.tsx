import { useEffect, useState, useRef, type KeyboardEvent } from 'react'
import type { DashboardFilters, TimePreset } from '../../lib/dashboardFilters'
import { DEFAULT_FILTERS, isDefaultFilters } from '../../lib/dashboardFilters'
import { ALL_FAMILIES, familyLabel } from '../../lib/deviceFamily'
import type { FilterSuggestions } from '../../lib/liveTestRepoTypes'
import { liveTestClient } from '../../lib/liveTestClient'

interface Suggestion {
  value: string      // the literal string that becomes a search tag
  label: string      // display label (may include metadata like nickname)
  category: 'Device' | 'Tester' | 'Model' | 'Family'
}

const TIME_PRESETS: { value: TimePreset; label: string }[] = [
  { value: 'all',   label: 'All time' },
  { value: '7d',    label: '7 days' },
  { value: '30d',   label: '30 days' },
  { value: '90d',   label: '90 days' },
  { value: 'ytd',   label: 'YTD' },
  { value: 'custom', label: 'Custom' },
]

// Match ControlPanel input style
const inputClass =
  'bg-white/[0.04] border border-border rounded-md text-sm px-2 py-1 text-foreground focus:border-primary focus:outline-none transition-colors'

// Selects need a solid background so the native dropdown popup isn't white-on-white
const selectClass =
  'bg-background border border-border rounded-md text-sm px-2 py-1 text-foreground focus:border-primary focus:outline-none transition-colors'

// Date inputs inherit color-scheme: dark from html (set in index.css).
// accent-color tints the popup's selected date / today indicator in brand primary.
const dateClass =
  'bg-background border border-border rounded-md text-sm px-2 py-1 text-foreground focus:border-primary focus:outline-none transition-colors ' +
  '[accent-color:var(--color-primary)] ' +
  '[&::-webkit-calendar-picker-indicator]:opacity-70 [&::-webkit-calendar-picker-indicator]:hover:opacity-100 [&::-webkit-calendar-picker-indicator]:cursor-pointer'

export function DashboardFiltersBar({
  filters,
  onChange,
}: {
  filters: DashboardFilters
  onChange: (next: DashboardFilters) => void
}) {
  const set = <K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) => {
    onChange({ ...filters, [key]: value })
  }

  const [draft, setDraft] = useState('')
  const [focused, setFocused] = useState(false)
  const [highlightIdx, setHighlightIdx] = useState(0)
  const [suggestions, setSuggestions] = useState<FilterSuggestions>({ devices: [], testers: [], models: [] })
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    liveTestClient.getFilterSuggestions().then((s) => {
      if (!cancelled) setSuggestions(s)
    })
    return () => { cancelled = true }
  }, [])

  // Build a flat suggestion list from the vocab; filter by draft substring; exclude already-used.
  const matchingSuggestions: Suggestion[] = (() => {
    const q = draft.trim().toLowerCase()
    const used = new Set(filters.searchTags)
    const all: Suggestion[] = [
      ...suggestions.devices.map((d) => ({
        category: 'Device' as const,
        value: d.device_id.toLowerCase(),
        label: d.nickname ? `${d.device_id} — ${d.nickname}` : d.device_id,
      })),
      ...suggestions.testers.map((t) => ({ category: 'Tester' as const, value: t.toLowerCase(), label: t })),
      ...suggestions.models.map((m) => ({ category: 'Model' as const, value: m.toLowerCase(), label: m })),
      ...ALL_FAMILIES.map((f) => ({ category: 'Family' as const, value: f, label: familyLabel(f) })),
    ]
    const filtered = all.filter((s) => !used.has(s.value))
    if (!q) return filtered.slice(0, 12)
    return filtered
      .filter((s) => s.value.includes(q) || s.label.toLowerCase().includes(q))
      .slice(0, 12)
  })()

  // Reset highlight when suggestions shift
  useEffect(() => { setHighlightIdx(0) }, [draft, focused])

  const addTag = (text: string) => {
    const t = text.trim().toLowerCase()
    if (!t || filters.searchTags.includes(t)) return
    onChange({ ...filters, searchTags: [...filters.searchTags, t] })
    setDraft('')
  }

  const removeTag = (idx: number) => {
    onChange({ ...filters, searchTags: filters.searchTags.filter((_, i) => i !== idx) })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (focused && matchingSuggestions.length > 0 && highlightIdx < matchingSuggestions.length) {
        addTag(matchingSuggestions[highlightIdx].value)
      } else if (draft.trim()) {
        addTag(draft)
      }
    } else if (e.key === 'Backspace' && !draft && filters.searchTags.length > 0) {
      removeTag(filters.searchTags.length - 1)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIdx((i) => Math.min(i + 1, matchingSuggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Escape') {
      setFocused(false)
      inputRef.current?.blur()
    }
  }

  // Close the dropdown if user clicks outside
  useEffect(() => {
    if (!focused) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setFocused(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [focused])

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-1.5">
      {/* Time */}
      <FilterGroup label="Time">
        <select
          value={filters.timePreset}
          onChange={(e) => {
            const next = e.target.value as TimePreset
            onChange({ ...filters, timePreset: next, timeFrom: next === 'custom' ? filters.timeFrom : null, timeTo: next === 'custom' ? filters.timeTo : null })
          }}
          className={selectClass}
        >
          {TIME_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        {filters.timePreset === 'custom' && (
          <>
            <input
              type="date"
              value={filters.timeFrom ?? ''}
              onChange={(e) => set('timeFrom', e.target.value || null)}
              className={dateClass}
              aria-label="From"
            />
            <span className="text-muted-foreground/50 text-xs">to</span>
            <input
              type="date"
              value={filters.timeTo ?? ''}
              onChange={(e) => set('timeTo', e.target.value || null)}
              className={dateClass}
              aria-label="To"
            />
          </>
        )}
      </FilterGroup>

      <Sep />

      {/* Device */}
      <FilterGroup label="Device">
        <select
          value={filters.deviceFamily ?? ''}
          onChange={(e) => set('deviceFamily', (e.target.value || null) as DashboardFilters['deviceFamily'])}
          className={selectClass}
        >
          <option value="">All</option>
          {ALL_FAMILIES.map((f) => (
            <option key={f} value={f}>{familyLabel(f)}</option>
          ))}
        </select>
      </FilterGroup>

      <Sep />

      {/* Result toggle */}
      <div className="flex items-center rounded-md border border-border overflow-hidden">
        {(['all', 'pass', 'fail'] as const).map((v) => {
          const active = (v === 'all' && filters.passFilter === null) || filters.passFilter === v
          return (
            <button
              key={v}
              onClick={() => set('passFilter', v === 'all' ? null : v)}
              className={`px-2.5 py-1 telemetry-label uppercase transition-colors ${
                active
                  ? v === 'pass' ? 'bg-success/15 text-success' : v === 'fail' ? 'bg-danger/15 text-danger' : 'bg-white/[0.06] text-foreground'
                  : 'text-muted-foreground hover:bg-white/[0.04]'
              }`}
            >
              {v === 'all' ? 'All' : v === 'pass' ? 'Pass' : 'Fail'}
            </button>
          )
        })}
      </div>

      <Sep />

      {/* Weight */}
      <FilterGroup label="Weight">
        <input
          type="number"
          value={filters.weightMinN ?? ''}
          onChange={(e) => set('weightMinN', e.target.value === '' ? null : Number(e.target.value))}
          className={`${inputClass} w-16 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
          placeholder="min"
          min={0}
        />
        <span className="text-muted-foreground/50 text-xs">-</span>
        <input
          type="number"
          value={filters.weightMaxN ?? ''}
          onChange={(e) => set('weightMaxN', e.target.value === '' ? null : Number(e.target.value))}
          className={`${inputClass} w-16 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
          placeholder="max"
          min={0}
        />
        <span className="telemetry-label">N</span>
      </FilterGroup>

      <Sep />

      {/* Search tags with autocomplete */}
      <div ref={containerRef} className="relative flex-1 min-w-[220px]">
        <div
          className={`${inputClass} flex flex-wrap items-center gap-1 cursor-text`}
          onClick={() => inputRef.current?.focus()}
        >
          {filters.searchTags.map((tag, i) => (
            <span
              key={`${tag}-${i}`}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-white/[0.08] text-[11px] tracking-[0.02em] text-foreground"
            >
              {tag}
              <button
                onClick={(e) => { e.stopPropagation(); removeTag(i) }}
                className="text-muted-foreground hover:text-foreground ml-0.5"
                aria-label={`Remove ${tag}`}
              >
                x
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            placeholder={filters.searchTags.length === 0 ? 'Search device, tester, model, or type…' : ''}
            className="bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground/40 flex-1 min-w-[60px] py-0"
          />
        </div>

        {focused && matchingSuggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-background border border-border rounded-md shadow-lg max-h-64 overflow-auto">
            {matchingSuggestions.map((s, i) => (
              <button
                key={`${s.category}-${s.value}`}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); addTag(s.value) }}
                onMouseEnter={() => setHighlightIdx(i)}
                className={`w-full text-left px-2.5 py-1 flex items-center justify-between text-sm transition-colors ${
                  i === highlightIdx ? 'bg-white/[0.06] text-foreground' : 'text-foreground/90 hover:bg-white/[0.04]'
                }`}
              >
                <span className="truncate">{s.label}</span>
                <span className="telemetry-label ml-2 shrink-0">{s.category}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Clear */}
      {(!isDefaultFilters(filters) || draft) && (
        <button
          onClick={() => { onChange(DEFAULT_FILTERS); setDraft('') }}
          className="text-[11px] tracking-[0.06em] uppercase text-muted-foreground hover:text-foreground transition-colors"
        >
          Clear
        </button>
      )}
    </div>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="telemetry-label">{label}</span>
      {children}
    </div>
  )
}

function Sep() {
  return <span className="w-px h-4 bg-border/50" />
}
