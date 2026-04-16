import type { SaveSessionPayload } from './lib/liveTestPayload'
import type { SessionListRow, SessionDetail, OverviewResult } from './lib/liveTestRepoTypes'
import type { DashboardFilters } from './lib/dashboardFilters'

export interface ElectronLiveTestApi {
  saveSession(payload: SaveSessionPayload): Promise<{ status: 'saved' | 'queued'; id: string; error?: string }>
  listSessions(opts: { limit: number; offset: number; filter: DashboardFilters }): Promise<SessionListRow[]>
  getSession(id: string): Promise<SessionDetail | null>
  getOverview(opts: { filter: DashboardFilters }): Promise<OverviewResult | null>
  retryQueued(): Promise<{ uploaded: number; stillQueued: number; errors: Array<{ id: string; error: string }> }>
  queueStatus(): Promise<{ queued: number; poison: number }>
}

declare global {
  interface ElectronAPI {
    getDynamoStatus: () => Promise<string>
    getDynamoLogs: () => Promise<string[]>
    restartDynamo: () => Promise<void>
    getAppVersion: () => Promise<string>
    onDynamoLog: (callback: (log: string) => void) => void
    onDynamoStatusChange: (callback: (status: string) => void) => void
    onUpdateAvailable: (callback: (info: unknown) => void) => void
    liveTest: ElectronLiveTestApi
  }

  interface Window {
    electronAPI?: ElectronAPI
  }
}
export {}
