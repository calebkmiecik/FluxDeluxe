import { useState, useRef, type KeyboardEvent } from 'react'
import type { DashboardFilters, TimePreset } from '../../lib/dashboardFilters'
import { DEFAULT_FILTERS, isDefaultFilters } from '../../lib/dashboardFilters'
import { ALL_FAMILIES, familyLabel } from '../../lib/deviceFamily'

const TIME_PRESETS: { value: TimePreset; label: string }[] = [
  { value: 'all',   label: 'All time' },
  { value: '7d',    label: 'Last 7 days' },
  { value: '30d',   label: 'Last 30 days' },
  { value: '90d',   label: 'Last 90 days' },
  { value: 'ytd',   label: 'Year to date' },
  { value: 'custom', label: 'Custom...' },
]

const inputClass =
  'bg-background border border-border rounded-md text-sm px-2 py-1 text-foreground'

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

  // Tag input state
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

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
    if (e.key === 'Enter' && draft.trim()) {
      e.preventDefault()
      addTag(draft)
    } else if (e.key === 'Backspace' && !draft && filters.searchTags.length > 0) {
      removeTag(filters.searchTags.length - 1)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 bg-card border border-border rounded-md px-3 py-2">
      {/* Time */}
      <label className="flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground">
        Time
      </label>
      <select
        value={filters.timePreset}
        onChange={(e) => {
          const next = e.target.value as TimePreset
          onChange({ ...filters, timePreset: next, timeFrom: next === 'custom' ? filters.timeFrom : null, timeTo: next === 'custom' ? filters.timeTo : null })
        }}
        className={inputClass}
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
            className={inputClass}
            aria-label="From"
          />
          <span className="text-muted-foreground text-xs">to</span>
          <input
            type="date"
            value={filters.timeTo ?? ''}
            onChange={(e) => set('timeTo', e.target.value || null)}
            className={inputClass}
            aria-label="To"
          />
        </>
      )}

      <span className="w-px h-5 bg-border mx-1" />

      {/* Device family */}
      <label className="flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground">
        Device
      </label>
      <select
        value={filters.deviceFamily ?? ''}
        onChange={(e) => set('deviceFamily', (e.target.value || null) as DashboardFilters['deviceFamily'])}
        className={inputClass}
      >
        <option value="">All</option>
        {ALL_FAMILIES.map((f) => (
          <option key={f} value={f}>{familyLabel(f)}</option>
        ))}
      </select>

      <span className="w-px h-5 bg-border mx-1" />

      {/* Pass / Fail toggle */}
      <div className="flex items-center rounded-md border border-border overflow-hidden text-xs">
        {(['all', 'pass', 'fail'] as const).map((v) => {
          const active = (v === 'all' && filters.passFilter === null) || filters.passFilter === v
          return (
            <button
              key={v}
              onClick={() => set('passFilter', v === 'all' ? null : v)}
              className={`px-2.5 py-1 transition-colors ${
                active
                  ? v === 'pass' ? 'bg-success/20 text-success' : v === 'fail' ? 'bg-danger/20 text-danger' : 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-white/5'
              }`}
            >
              {v === 'all' ? 'All' : v === 'pass' ? 'Pass' : 'Fail'}
            </button>
          )
        })}
      </div>

      <span className="w-px h-5 bg-border mx-1" />

      {/* Weight range */}
      <label className="flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground">
        Weight
      </label>
      <input
        type="number"
        value={filters.weightMinN ?? ''}
        onChange={(e) => set('weightMinN', e.target.value === '' ? null : Number(e.target.value))}
        className={`${inputClass} w-20`}
        placeholder="min"
        min={0}
      />
      <span className="text-muted-foreground text-xs">-</span>
      <input
        type="number"
        value={filters.weightMaxN ?? ''}
        onChange={(e) => set('weightMaxN', e.target.value === '' ? null : Number(e.target.value))}
        className={`${inputClass} w-20`}
        placeholder="max"
        min={0}
      />
      <span className="text-muted-foreground text-xs">N</span>

      <span className="w-px h-5 bg-border mx-1" />

      {/* Tag search */}
      <div
        className={`${inputClass} flex flex-wrap items-center gap-1 flex-1 min-w-[200px] cursor-text`}
        onClick={() => inputRef.current?.focus()}
      >
        {filters.searchTags.map((tag, i) => (
          <span
            key={`${tag}-${i}`}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs bg-muted text-foreground"
          >
            {tag}
            <button
              onClick={(e) => { e.stopPropagation(); removeTag(i) }}
              className="hover:text-foreground ml-0.5"
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
          placeholder={filters.searchTags.length === 0 ? 'Search... (type + Enter)' : ''}
          className="bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground flex-1 min-w-[80px] py-0"
        />
      </div>

      {/* Clear */}
      <button
        onClick={() => { onChange(DEFAULT_FILTERS); setDraft('') }}
        disabled={isDefaultFilters(filters) && !draft}
        className="px-2.5 py-1 text-xs uppercase tracking-wider border border-border rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Clear
      </button>
    </div>
  )
}
