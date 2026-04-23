import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type {
  DynamoChannel,
  DynamoUpdaterConfig,
  DynamoActive,
  DynamoRelease,
  DynamoInstalled,
} from '../../global'

type TabKind = 'update' | 'branches' | 'installed'

function fmtTime(iso: string | undefined | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString() } catch { return iso }
}

function shortTag(tag: string): string {
  // beta-v20260423T130000Z → beta-v0423-1300
  const m = tag.match(/^(.+?-v)(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/)
  if (!m) return tag
  return `${m[1]}${m[3]}${m[4]}-${m[5]}${m[6]}`
}

export function BackendUpdaterModal({ onClose }: { onClose: () => void }) {
  const [config, setConfig] = useState<DynamoUpdaterConfig | null>(null)
  const [active, setActive] = useState<DynamoActive | null>(null)
  const [installed, setInstalled] = useState<DynamoInstalled[]>([])
  const [latest, setLatest] = useState<DynamoRelease | null>(null)
  const [branchDraft, setBranchDraft] = useState('')
  const [branches, setBranches] = useState<DynamoRelease[]>([])
  const [tab, setTab] = useState<TabKind>('update')
  const [checking, setChecking] = useState(false)
  const [installing, setInstalling] = useState(false)
  const api = window.electronAPI?.dynamoUpdater

  // Initial load
  useEffect(() => {
    if (!api) return
    let cancelled = false
    Promise.all([api.getConfig(), api.getActive(), api.listInstalled()]).then(([c, a, i]) => {
      if (cancelled) return
      setConfig(c)
      setActive(a)
      setInstalled(i)
      setBranchDraft(c.branch ?? '')
    })
    return () => { cancelled = true }
  }, [api])

  // Kick off a check whenever the config or branch changes
  useEffect(() => {
    if (!api || !config) return
    if (config.channel === 'other' && !config.branch) { setLatest(null); return }
    let cancelled = false
    setChecking(true)
    api.checkForUpdate({ channel: config.channel, branch: config.branch }).then((res) => {
      if (cancelled) return
      setChecking(false)
      if (res.ok) setLatest(res.release)
      else toast.error(`Update check failed: ${res.error}`)
    })
    return () => { cancelled = true }
  }, [api, config])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  if (!api) {
    return (
      <Shell onClose={onClose}>
        <p className="text-muted-foreground text-sm p-6">Electron IPC not available.</p>
      </Shell>
    )
  }

  const setChannel = async (channel: DynamoChannel) => {
    const next: DynamoUpdaterConfig = { channel, branch: channel === 'other' ? (config?.branch ?? null) : null }
    setConfig(next)
    await api.setConfig(next)
  }

  const applyBranchDraft = async () => {
    if (!config || config.channel !== 'other') return
    const b = branchDraft.trim()
    const next: DynamoUpdaterConfig = { channel: 'other', branch: b || null }
    setConfig(next)
    await api.setConfig(next)
  }

  const searchBranchReleases = async () => {
    if (!config || config.channel !== 'other' || !config.branch) return
    setChecking(true)
    const res = await api.listReleases({ channel: 'other', branch: config.branch })
    setChecking(false)
    if (!res.ok) { toast.error(res.error); return }
    setBranches(res.releases)
    if (res.releases.length === 0) toast.info('No releases found for that branch.')
  }

  const updateNow = async (tag: string) => {
    if (!config) return
    setInstalling(true)
    const res = await api.installAndActivate({ channel: config.channel, branch: config.branch, tag })
    setInstalling(false)
    if (!res.ok) { toast.error(`Update failed: ${res.error}`); return }
    toast.success(`Running ${tag}`)
    // Refresh state
    const [a, i] = await Promise.all([api.getActive(), api.listInstalled()])
    setActive(a); setInstalled(i)
  }

  const switchToInstalled = async (v: DynamoInstalled) => {
    if (!config) return
    setInstalling(true)
    // Switch purely locally, no download needed
    const res = await api.activate({ channel: config.channel, branch: config.branch, tag: v.tag })
    setInstalling(false)
    if (!res.ok) { toast.error(res.error); return }
    toast.success(`Activated ${shortTag(v.tag)}`)
    const [a, i] = await Promise.all([api.getActive(), api.listInstalled()])
    setActive(a); setInstalled(i)
  }

  const removeInstalled = async (tag: string) => {
    try {
      await api.removeInstalled(tag)
      const i = await api.listInstalled()
      setInstalled(i)
      toast.success('Removed')
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const resetToBundled = async () => {
    setInstalling(true)
    const res = await api.resetToBundled()
    setInstalling(false)
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Reset to bundled version')
    const [a, i] = await Promise.all([api.getActive(), api.listInstalled()])
    setActive(a); setInstalled(i)
  }

  return (
    <Shell onClose={onClose}>
      {/* Header strip */}
      <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border">
        <div>
          <div className="telemetry-label">Backend</div>
          <div className="text-lg font-semibold text-foreground">DynamoPy Updater</div>
          <div className="text-muted-foreground text-xs mt-1">
            Hot-update the Python backend from GitHub Releases without reinstalling the app.
          </div>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 px-2.5 py-1 text-xs tracking-[0.08em] uppercase border border-border rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
        >
          Close
        </button>
      </div>

      {/* Active version + channel row */}
      <div className="px-5 py-4 border-b border-border grid grid-cols-3 gap-4">
        <div>
          <div className="telemetry-label">Running now</div>
          <div className="text-sm text-foreground font-medium mt-1">
            {active ? shortTag(active.tag) : 'Bundled (shipped with app)'}
          </div>
          {active && (
            <div className="text-muted-foreground text-[11px] tracking-wider mt-0.5">
              {active.channel}{active.branch ? ` · ${active.branch}` : ''} · installed {fmtTime(active.installedAt)}
            </div>
          )}
        </div>
        <div className="col-span-2">
          <div className="telemetry-label mb-1.5">Update channel</div>
          <div className="flex items-center rounded-md border border-border overflow-hidden w-max">
            {(['stable', 'beta', 'other'] as const).map((c) => {
              const isActive = config?.channel === c
              return (
                <button
                  key={c}
                  onClick={() => setChannel(c)}
                  className={`px-3 py-1 text-[11px] tracking-[0.08em] uppercase transition-colors ${
                    isActive ? 'bg-white/[0.06] text-foreground' : 'text-muted-foreground hover:bg-white/[0.04]'
                  }`}
                >
                  {c === 'stable' ? 'Stable' : c === 'beta' ? 'Beta' : 'Other'}
                </button>
              )
            })}
          </div>
          {config?.channel === 'other' && (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="text"
                placeholder="Branch name (e.g. feature/foo)"
                value={branchDraft}
                onChange={(e) => setBranchDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') applyBranchDraft() }}
                className="flex-1 bg-white/[0.04] border border-border rounded-md text-sm px-2 py-1 text-foreground focus:border-primary focus:outline-none"
              />
              <button
                onClick={applyBranchDraft}
                disabled={branchDraft.trim() === (config.branch ?? '')}
                className="px-2.5 py-1 text-xs uppercase tracking-wider border border-border rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Use branch
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="px-5 pt-3 border-b border-border flex gap-4">
        <TabButton active={tab === 'update'} onClick={() => setTab('update')}>Latest</TabButton>
        {config?.channel === 'other' && (
          <TabButton active={tab === 'branches'} onClick={() => setTab('branches')}>Pick version</TabButton>
        )}
        <TabButton active={tab === 'installed'} onClick={() => setTab('installed')}>
          Installed ({installed.length})
        </TabButton>
      </div>

      {/* Tab bodies */}
      <div className="px-5 py-4 min-h-[180px]">
        {tab === 'update' && (
          <UpdateTab
            checking={checking}
            installing={installing}
            latest={latest}
            active={active}
            config={config}
            onUpdate={(tag) => updateNow(tag)}
          />
        )}
        {tab === 'branches' && config?.channel === 'other' && (
          <BranchesTab
            branches={branches}
            config={config}
            checking={checking}
            installing={installing}
            activeTag={active?.tag ?? null}
            onSearch={searchBranchReleases}
            onInstall={(tag) => updateNow(tag)}
          />
        )}
        {tab === 'installed' && (
          <InstalledTab
            installed={installed}
            activeTag={active?.tag ?? null}
            installing={installing}
            onSwitch={switchToInstalled}
            onRemove={removeInstalled}
            onResetToBundled={resetToBundled}
          />
        )}
      </div>
    </Shell>
  )
}

function Shell({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-[#1A1A1A] border border-border rounded-md max-w-3xl w-full max-h-[90vh] overflow-auto card-accent"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`pb-2 text-[11px] uppercase tracking-[0.08em] border-b-2 transition-colors ${
        active ? 'text-foreground border-primary' : 'text-muted-foreground border-transparent hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

function UpdateTab({ checking, installing, latest, active, config, onUpdate }: {
  checking: boolean
  installing: boolean
  latest: DynamoRelease | null
  active: DynamoActive | null
  config: DynamoUpdaterConfig | null
  onUpdate: (tag: string) => void
}) {
  if (config?.channel === 'other' && !config.branch) {
    return <p className="text-muted-foreground text-sm">Enter a branch name above to look for releases.</p>
  }
  if (checking) return <p className="text-muted-foreground text-sm">Checking for updates…</p>
  if (!latest) return <p className="text-muted-foreground text-sm">No releases found in this channel.</p>

  const alreadyActive = active?.tag === latest.tag
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="telemetry-label">Latest in channel</div>
        <div className="text-lg font-semibold text-foreground mt-1 truncate">{shortTag(latest.tag)}</div>
        <div className="text-muted-foreground text-xs mt-1">
          Released {fmtTime(latest.publishedAt)}
          {latest.zipSize && ` · ${(latest.zipSize / 1024 / 1024).toFixed(1)} MB`}
        </div>
      </div>
      <div className="shrink-0">
        {alreadyActive ? (
          <span className="text-success text-xs uppercase tracking-wider font-medium">Running</span>
        ) : (
          <button
            onClick={() => onUpdate(latest.tag)}
            disabled={installing}
            className="px-3 py-1.5 text-xs uppercase tracking-wider bg-primary text-white rounded-md hover:bg-primary-hover disabled:opacity-50 transition-colors"
          >
            {installing ? 'Updating…' : 'Update now'}
          </button>
        )}
      </div>
    </div>
  )
}

function BranchesTab({ branches, config, checking, installing, activeTag, onSearch, onInstall }: {
  branches: DynamoRelease[]
  config: DynamoUpdaterConfig
  checking: boolean
  installing: boolean
  activeTag: string | null
  onSearch: () => void
  onInstall: (tag: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="text-muted-foreground text-sm">
          {config.branch ? `Releases for branch "${config.branch}"` : 'No branch selected'}
        </div>
        <button
          onClick={onSearch}
          disabled={!config.branch || checking}
          className="px-2.5 py-1 text-xs uppercase tracking-wider border border-border rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {checking ? 'Searching…' : 'Search'}
        </button>
      </div>
      {branches.length === 0 && !checking && (
        <p className="text-muted-foreground text-xs">Click Search to list edge releases for this branch.</p>
      )}
      {branches.map((r) => {
        const isActive = activeTag === r.tag
        return (
          <div key={r.tag} className="flex items-center justify-between gap-2 py-1 border-b border-border/50">
            <div className="min-w-0">
              <div className="text-sm text-foreground truncate">{shortTag(r.tag)}</div>
              <div className="text-muted-foreground text-[11px] tracking-wider">{fmtTime(r.publishedAt)}</div>
            </div>
            {isActive ? (
              <span className="text-success text-xs uppercase tracking-wider font-medium">Running</span>
            ) : (
              <button
                onClick={() => onInstall(r.tag)}
                disabled={installing}
                className="px-2.5 py-1 text-xs uppercase tracking-wider border border-border rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {installing ? '…' : 'Install'}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function InstalledTab({ installed, activeTag, installing, onSwitch, onRemove, onResetToBundled }: {
  installed: DynamoInstalled[]
  activeTag: string | null
  installing: boolean
  onSwitch: (v: DynamoInstalled) => void
  onRemove: (tag: string) => void
  onResetToBundled: () => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="telemetry-label">Installed versions ({installed.length})</div>
        <button
          onClick={onResetToBundled}
          disabled={installing || activeTag === null}
          className="px-2.5 py-1 text-xs uppercase tracking-wider border border-border rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Use bundled
        </button>
      </div>
      {installed.length === 0 && (
        <p className="text-muted-foreground text-sm">No hot-update versions installed yet.</p>
      )}
      {installed.map((v) => {
        const isActive = activeTag === v.tag
        return (
          <div key={v.tag} className="flex items-center justify-between gap-2 py-1 border-b border-border/50">
            <div className="min-w-0">
              <div className="text-sm text-foreground truncate">{shortTag(v.tag)}</div>
              <div className="text-muted-foreground text-[11px] tracking-wider">Installed {fmtTime(v.installedAt)}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isActive ? (
                <span className="text-success text-xs uppercase tracking-wider font-medium">Running</span>
              ) : (
                <>
                  <button
                    onClick={() => onSwitch(v)}
                    disabled={installing}
                    className="px-2.5 py-1 text-xs uppercase tracking-wider border border-border rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Use
                  </button>
                  <button
                    onClick={() => onRemove(v.tag)}
                    disabled={installing}
                    className="px-2.5 py-1 text-xs uppercase tracking-wider text-muted-foreground hover:text-danger transition-colors"
                  >
                    Remove
                  </button>
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
