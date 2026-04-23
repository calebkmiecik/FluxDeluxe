import { ipcMain } from 'electron'
import type { DynamoManager } from '../dynamo'
import type { DynamoChannel } from '../dynamoUpdater'
import {
  getConfig, setConfig,
  getActive,
  listInstalled, removeInstalled,
  latestRelease, listChannelReleases,
  downloadAndInstall, activate, deactivate,
} from '../dynamoUpdater'

export function registerDynamoUpdaterIpc(dynamo: DynamoManager): void {
  const channels = [
    'dynamoUpdater:getConfig',
    'dynamoUpdater:setConfig',
    'dynamoUpdater:getActive',
    'dynamoUpdater:listInstalled',
    'dynamoUpdater:removeInstalled',
    'dynamoUpdater:checkForUpdate',
    'dynamoUpdater:listReleases',
    'dynamoUpdater:installAndActivate',
    'dynamoUpdater:activate',
    'dynamoUpdater:resetToBundled',
  ]
  for (const c of channels) ipcMain.removeHandler(c)

  ipcMain.handle('dynamoUpdater:getConfig', () => getConfig())
  ipcMain.handle('dynamoUpdater:setConfig', (_e, cfg) => setConfig(cfg))
  ipcMain.handle('dynamoUpdater:getActive', () => getActive())
  ipcMain.handle('dynamoUpdater:listInstalled', () => listInstalled())
  ipcMain.handle('dynamoUpdater:removeInstalled', (_e, tag: string) => removeInstalled(tag))

  ipcMain.handle('dynamoUpdater:checkForUpdate', async (_e, opts: { channel: DynamoChannel }) => {
    try {
      const release = await latestRelease(opts.channel)
      return { ok: true as const, release }
    } catch (err) {
      return { ok: false as const, error: (err as Error).message }
    }
  })

  ipcMain.handle('dynamoUpdater:listReleases', async (_e, opts: { channel: DynamoChannel }) => {
    try {
      const releases = await listChannelReleases(opts.channel)
      return { ok: true as const, releases }
    } catch (err) {
      return { ok: false as const, error: (err as Error).message }
    }
  })

  /**
   * Full happy-path: download + extract + activate + restart DynamoPy.
   * Client shows "Update now" button which calls this.
   */
  ipcMain.handle('dynamoUpdater:installAndActivate', async (_e, opts: {
    channel: DynamoChannel
    tag: string
  }) => {
    try {
      console.log('[installAndActivate] start', opts)
      const releases = await listChannelReleases(opts.channel)
      console.log('[installAndActivate] found releases:', releases.map(r => r.tag))
      const release = releases.find((r) => r.tag === opts.tag)
      if (!release) return { ok: false as const, error: `Release ${opts.tag} not found in channel` }
      console.log('[installAndActivate] downloading', release.zipUrl, 'size', release.zipSize)
      await downloadAndInstall(release, opts.channel)
      console.log('[installAndActivate] download + extract complete')
      await activate(release.tag, opts.channel)
      console.log('[installAndActivate] activated')
      await setConfig({ channel: opts.channel })
      console.log('[installAndActivate] config saved, restarting dynamo')
      await dynamo.restart()
      console.log('[installAndActivate] dynamo restarted — done')
      return { ok: true as const, tag: release.tag }
    } catch (err) {
      console.error('[installAndActivate] FAILED:', err)
      return { ok: false as const, error: (err as Error).message }
    }
  })

  /**
   * Switch to an already-installed version (rollback / forward between local copies).
   * Does not download anything.
   */
  ipcMain.handle('dynamoUpdater:activate', async (_e, opts: {
    channel: DynamoChannel
    tag: string
  }) => {
    try {
      await activate(opts.tag, opts.channel)
      await setConfig({ channel: opts.channel })
      await dynamo.restart()
      return { ok: true as const, tag: opts.tag }
    } catch (err) {
      return { ok: false as const, error: (err as Error).message }
    }
  })

  /** Clear active.json — DynamoPy falls back to the version bundled with the app. */
  ipcMain.handle('dynamoUpdater:resetToBundled', async () => {
    try {
      await deactivate()
      await dynamo.restart()
      return { ok: true as const }
    } catch (err) {
      return { ok: false as const, error: (err as Error).message }
    }
  })
}
