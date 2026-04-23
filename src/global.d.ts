import type { SaveSessionPayload } from './lib/liveTestPayload'
import type { SessionListRow, SessionDetail, OverviewResult, TimeSeriesPoint, TimeSeriesGranularity, FilterSuggestions } from './lib/liveTestRepoTypes'
import type { DashboardFilters } from './lib/dashboardFilters'

export type DynamoChannel = 'stable' | 'beta'

export interface DynamoUpdaterConfig {
  channel: DynamoChannel
}

export interface DynamoActive {
  channel: DynamoChannel
  tag: string
  installedAt: string
}

export interface DynamoRelease {
  tag: string
  name: string
  publishedAt: string
  zipUrl: string
  zipName: string
  zipSize: number | null
  prerelease: boolean
}

export interface DynamoInstalled {
  tag: string
  path: string
  installedAt: string
  isActive: boolean
}

type Result<T> = { ok: true } & T | { ok: false; error: string }

export interface ElectronDynamoUpdaterApi {
  getConfig(): Promise<DynamoUpdaterConfig>
  setConfig(cfg: DynamoUpdaterConfig): Promise<void>
  getActive(): Promise<DynamoActive | null>
  listInstalled(): Promise<DynamoInstalled[]>
  removeInstalled(tag: string): Promise<void>
  checkForUpdate(opts: { channel: DynamoChannel }): Promise<Result<{ release: DynamoRelease | null }>>
  listReleases(opts: { channel: DynamoChannel }): Promise<Result<{ releases: DynamoRelease[] }>>
  installAndActivate(opts: { channel: DynamoChannel; tag: string }): Promise<Result<{ tag: string }>>
  activate(opts: { channel: DynamoChannel; tag: string }): Promise<Result<{ tag: string }>>
  resetToBundled(): Promise<Result<object>>
}

export interface ElectronLiveTestApi {
  saveSession(payload: SaveSessionPayload): Promise<{ status: 'saved' | 'queued'; id: string; error?: string }>
  listSessions(opts: { limit: number; offset: number; filter: DashboardFilters }): Promise<SessionListRow[]>
  getSession(id: string): Promise<SessionDetail | null>
  getOverview(opts: { filter: DashboardFilters }): Promise<OverviewResult | null>
  getTimeSeries(opts: { filter: DashboardFilters; granularity: TimeSeriesGranularity }): Promise<TimeSeriesPoint[]>
  getFilterSuggestions(): Promise<FilterSuggestions>
  retryQueued(): Promise<{ uploaded: number; stillQueued: number; errors: Array<{ id: string; error: string }> }>
  queueStatus(): Promise<{ queued: number; poison: number }>
}

declare global {
  interface ElectronAPI {
    getDynamoStatus: () => Promise<string>
    getDynamoLogs: () => Promise<string[]>
    restartDynamo: () => Promise<void>
    getAppVersion: () => Promise<string>
    openDirectoryDialog: (title?: string) => Promise<string | null>
    onDynamoLog: (callback: (log: string) => void) => void
    onDynamoStatusChange: (callback: (status: string) => void) => void
    onUpdateAvailable: (callback: (info: unknown) => void) => void
    liveTest: ElectronLiveTestApi
    dynamoUpdater: ElectronDynamoUpdaterApi
  }

  interface Window {
    electronAPI?: ElectronAPI
  }
}
export {}
