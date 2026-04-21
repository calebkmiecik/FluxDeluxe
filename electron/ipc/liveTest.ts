import { app, ipcMain } from 'electron'
import { join } from 'path'
import { LiveTestRepo } from '../liveTestRepo'
import { LiveTestQueue } from '../liveTestQueue'
import type { SaveSessionPayload } from '../../src/lib/liveTestPayload'

const MAX_RETRIES = 3

export interface LiveTestIpcDeps {
  repo: LiveTestRepo | null  // null if env is missing
  queue: LiveTestQueue
  retryAttempts: Map<string, number>
}

export function createLiveTestDeps(): LiveTestIpcDeps {
  const queueDir = join(app.getPath('userData'), 'livetest-queue')
  const queue = new LiveTestQueue(queueDir)
  let repo: LiveTestRepo | null = null
  try {
    repo = LiveTestRepo.fromEnv()
  } catch (err) {
    console.warn('[liveTest] Supabase not configured:', (err as Error).message)
  }
  return { repo, queue, retryAttempts: new Map() }
}

export function registerLiveTestIpc(deps: LiveTestIpcDeps): void {
  ipcMain.removeHandler('liveTest:saveSession')
  ipcMain.removeHandler('liveTest:listSessions')
  ipcMain.removeHandler('liveTest:getSession')
  ipcMain.removeHandler('liveTest:getOverview')
  ipcMain.removeHandler('liveTest:getTimeSeries')
  ipcMain.removeHandler('liveTest:retryQueued')
  ipcMain.removeHandler('liveTest:queueStatus')

  ipcMain.handle('liveTest:saveSession', async (_e, payload: SaveSessionPayload) => {
    // First: write to queue (durable)
    await deps.queue.enqueue(payload)
    if (!deps.repo) {
      return { status: 'queued', id: payload.session.id, error: 'Supabase not configured' }
    }
    try {
      await deps.repo.saveSession(payload)
      await deps.queue.remove(payload.session.id)
      return { status: 'saved', id: payload.session.id }
    } catch (err) {
      return { status: 'queued', id: payload.session.id, error: (err as Error).message }
    }
  })

  ipcMain.handle('liveTest:listSessions', async (_e, opts) => {
    if (!deps.repo) return []
    return deps.repo.listSessions(opts)
  })

  ipcMain.handle('liveTest:getSession', async (_e, id: string) => {
    if (!deps.repo) return null
    return deps.repo.getSession(id)
  })

  ipcMain.handle('liveTest:getOverview', async (_e, opts: { filter: import('../../src/lib/dashboardFilters').DashboardFilters }) => {
    if (!deps.repo) return null
    return deps.repo.getOverview(opts.filter)
  })

  ipcMain.handle('liveTest:getTimeSeries', async (_e, opts: { filter: import('../../src/lib/dashboardFilters').DashboardFilters; granularity: 'day' | 'week' }) => {
    if (!deps.repo) return []
    return deps.repo.getTimeSeries(opts)
  })

  ipcMain.handle('liveTest:queueStatus', async () => deps.queue.status())

  ipcMain.handle('liveTest:retryQueued', async () => {
    const ids = await deps.queue.list()
    let uploaded = 0
    const errors: Array<{ id: string; error: string }> = []
    for (const id of ids) {
      if (!deps.repo) {
        errors.push({ id, error: 'Supabase not configured' })
        continue
      }
      try {
        const payload = await deps.queue.read(id)
        await deps.repo.saveSession(payload)
        await deps.queue.remove(id)
        deps.retryAttempts.delete(id)
        uploaded++
      } catch (err) {
        const n = (deps.retryAttempts.get(id) ?? 0) + 1
        deps.retryAttempts.set(id, n)
        if (n >= MAX_RETRIES) {
          await deps.queue.moveToPoison(id, (err as Error).message)
          deps.retryAttempts.delete(id)
        }
        errors.push({ id, error: (err as Error).message })
      }
    }
    const status = await deps.queue.status()
    return { uploaded, stillQueued: status.queued, errors }
  })
}

export async function runRetryOnStart(deps: LiveTestIpcDeps): Promise<void> {
  if (!deps.repo) return
  const ids = await deps.queue.list()
  for (const id of ids) {
    try {
      const payload = await deps.queue.read(id)
      await deps.repo.saveSession(payload)
      await deps.queue.remove(id)
    } catch (err) {
      console.warn(`[liveTest] retry on start failed for ${id}:`, (err as Error).message)
      // Don't move to poison here — let user trigger retry from UI
    }
  }
}
