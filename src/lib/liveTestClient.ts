/**
 * Client wrapper for the live-test IPC surface.
 *
 * Reasons for this indirection:
 *  - `window.electronAPI` is exposed via Electron's `contextBridge`, which
 *    returns a frozen, read-only copy. We cannot mutate its methods.
 *  - We want a dummy-data toggle in the Dashboard for UI previews.
 *
 * Solution: components call `liveTestClient.*` instead of
 * `window.electronAPI.liveTest.*`. When a dummy implementation is installed
 * via `setDummyImpl`, the client routes reads through it. Saves always go
 * to the real IPC — enabling dummy mode must never swallow a real save.
 */

import type { SaveSessionPayload } from './liveTestPayload'
import type { SessionListRow, SessionDetail, OverviewResult } from './liveTestRepoTypes'

type Api = NonNullable<Window['electronAPI']>['liveTest']

let dummyImpl: Partial<Api> | null = null

export function setDummyImpl(impl: Partial<Api> | null): void {
  dummyImpl = impl
}

export function isDummyActive(): boolean {
  return dummyImpl !== null
}

function real(): Api | null {
  return window.electronAPI?.liveTest ?? null
}

export const liveTestClient = {
  /** Saves always go to real IPC. Dummy mode never intercepts writes. */
  saveSession(payload: SaveSessionPayload): Promise<{ status: 'saved' | 'queued'; id: string; error?: string }> {
    const api = real()
    if (!api) return Promise.resolve({ status: 'queued', id: payload.session.id, error: 'electronAPI not available' })
    return api.saveSession(payload)
  },

  getOverview(opts: { range: 'all' | '30d' | '7d' }): Promise<OverviewResult | null> {
    if (dummyImpl?.getOverview) return dummyImpl.getOverview(opts)
    return real()?.getOverview(opts) ?? Promise.resolve(null)
  },

  listSessions(opts: { limit: number; offset: number; filterDeviceId?: string; filterTesterName?: string }): Promise<SessionListRow[]> {
    if (dummyImpl?.listSessions) return dummyImpl.listSessions(opts)
    return real()?.listSessions(opts) ?? Promise.resolve([])
  },

  getSession(id: string): Promise<SessionDetail | null> {
    if (dummyImpl?.getSession) return dummyImpl.getSession(id)
    return real()?.getSession(id) ?? Promise.resolve(null)
  },

  queueStatus(): Promise<{ queued: number; poison: number }> {
    if (dummyImpl?.queueStatus) return dummyImpl.queueStatus()
    return real()?.queueStatus() ?? Promise.resolve({ queued: 0, poison: 0 })
  },

  retryQueued(): Promise<{ uploaded: number; stillQueued: number; errors: Array<{ id: string; error: string }> }> {
    if (dummyImpl?.retryQueued) return dummyImpl.retryQueued()
    return real()?.retryQueued() ?? Promise.resolve({ uploaded: 0, stillQueued: 0, errors: [] })
  },
}
