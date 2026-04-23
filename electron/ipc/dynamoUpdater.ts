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

  ipcMain.handle('dynamoUpdater:checkForUpdate', async (_e, opts: { channel: DynamoChannel; branch: string | null }) => {
    try {
      const release = await latestRelease(opts.channel, opts.branch)
      return { ok: true as const, release }
    } catch (err) {
      return { ok: false as const, error: (err as Error).message }
    }
  })

  ipcMain.handle('dynamoUpdater:listReleases', async (_e, opts: { channel: DynamoChannel; branch: string | null }) => {
    try {
      const releases = await listChannelReleases(opts.channel, opts.branch)
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
    branch: string | null
    tag: string
  }) => {
    try {
      // Re-fetch the release to get its download URL (client passes only the tag).
      const releases = await listChannelReleases(opts.channel, opts.branch)
      const release = releases.find((r) => r.tag === opts.tag)
      if (!release) return { ok: false as const, error: `Release ${opts.tag} not found in channel` }
      await downloadAndInstall(release, opts.channel, opts.branch)
      await activate(release.tag, opts.channel, opts.branch)
      await setConfig({ channel: opts.channel, branch: opts.branch })
      // Restart DynamoPy so the new version takes effect.
      await dynamo.restart()
      return { ok: true as const, tag: release.tag }
    } catch (err) {
      return { ok: false as const, error: (err as Error).message }
    }
  })

  /**
   * Switch to an already-installed version (rollback / forward between local copies).
   * Does not download anything.
   */
  ipcMain.handle('dynamoUpdater:activate', async (_e, opts: {
    channel: DynamoChannel
    branch: string | null
    tag: string
  }) => {
    try {
      await activate(opts.tag, opts.channel, opts.branch)
      await setConfig({ channel: opts.channel, branch: opts.branch })
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
