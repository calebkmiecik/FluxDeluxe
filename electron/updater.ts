import { autoUpdater } from 'electron-updater'
import { BrowserWindow } from 'electron'

const DYNAMO_REPO = 'Axioforce/AxioforceDynamoPy'

export function initUpdater(window: BrowserWindow): void {
  // --- Tier 1: Full app updates via electron-updater ---
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    window.webContents.send('updater:available', info)
  })

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err)
  })

  // Check for updates (silently fails if no internet or no releases)
  autoUpdater.checkForUpdates().catch(() => {})
}

export async function checkDynamoUpdate(currentVersion: string): Promise<{
  available: boolean
  tagName?: string
  zipUrl?: string
}> {
  // --- Tier 2: DynamoPy hot-update ---
  try {
    const response = await fetch(
      `https://api.github.com/repos/${DYNAMO_REPO}/releases/latest`,
      { signal: AbortSignal.timeout(5000) }
    )
    if (!response.ok) return { available: false }

    const release = await response.json()
    const latestTag = (release.tag_name || '').replace(/^v/, '')

    if (latestTag && latestTag !== currentVersion) {
      // Find the zip asset or fall back to zipball
      const zipAsset = release.assets?.find((a: any) => a.name.endsWith('.zip'))
      const zipUrl = zipAsset?.browser_download_url || release.zipball_url

      return { available: true, tagName: latestTag, zipUrl }
    }
  } catch {
    // Network error — skip update check
  }
  return { available: false }
}
