/**
 * DynamoPy hot-update manager.
 *
 * Responsibilities:
 *  - Track which version of DynamoPy the app should run (active.json)
 *  - Check GitHub Releases on Axioforce/AxioforceDynamoPy for newer versions
 *    in a configurable channel (stable / beta)
 *  - Download + extract release zips into userData/dynamopy/<tag>/
 *  - Expose a minimal API consumed by IPC handlers
 *
 * Version tag format (produced by the DynamoPy release workflow):
 *   stable-v<timestamp>
 *   beta-v<timestamp>
 *
 * The DynamoPy-side release workflow decides which branch maps to which
 * channel (via GitHub repo variables STABLE_BRANCH / BETA_BRANCH). From the
 * client's perspective we just pick a channel and consume its tagged releases.
 *
 * "Latest" = release with alphabetically-greatest tag within the channel prefix.
 * (Timestamps are ISO-style UTC so they sort lexicographically.)
 */

import { promises as fsp, existsSync, mkdirSync } from 'fs'
import path from 'path'
import { app } from 'electron'
import AdmZip from 'adm-zip'

const DYNAMO_REPO = 'Axioforce/AxioforceDynamoPy'

// Baked in at build time via .env. Required because the DynamoPy repo is private.
// Must use the MAIN_VITE_ prefix so electron-vite exposes it to the main process.
const GITHUB_TOKEN =
  (import.meta as unknown as { env?: Record<string, string> }).env?.MAIN_VITE_GITHUB_TOKEN ??
  process.env.MAIN_VITE_GITHUB_TOKEN ??
  ''

function ghApiHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Accept': 'application/vnd.github+json' }
  if (GITHUB_TOKEN) h['Authorization'] = `Bearer ${GITHUB_TOKEN}`
  return h
}

function ghDownloadHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Accept': 'application/octet-stream' }
  if (GITHUB_TOKEN) h['Authorization'] = `Bearer ${GITHUB_TOKEN}`
  return h
}

export type DynamoChannel = 'stable' | 'beta'

export interface UpdaterConfig {
  channel: DynamoChannel
}

export interface ActiveDynamo {
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
  /** Bytes */
  zipSize: number | null
  prerelease: boolean
}

export interface InstalledVersion {
  tag: string
  path: string
  installedAt: string
  isActive: boolean
}

// ── Path helpers ──────────────────────────────────────────────────
const USER_DYNAMO_ROOT = () => path.join(app.getPath('userData'), 'dynamopy')
const ACTIVE_FILE      = () => path.join(USER_DYNAMO_ROOT(), 'active.json')
const CONFIG_FILE      = () => path.join(USER_DYNAMO_ROOT(), 'config.json')
const INSTALL_DIR      = (tag: string) => path.join(USER_DYNAMO_ROOT(), sanitizeTag(tag))

function sanitizeTag(tag: string): string {
  // Tags are GitHub-safe already but double-check no path traversal sneaks in.
  return tag.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function ensureRoot(): void {
  const root = USER_DYNAMO_ROOT()
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
}

// ── Config (persistent channel selection) ─────────────────────────
const DEFAULT_CONFIG: UpdaterConfig = { channel: 'stable' }

export async function getConfig(): Promise<UpdaterConfig> {
  ensureRoot()
  try {
    const raw = await fsp.readFile(CONFIG_FILE(), 'utf8')
    const parsed = JSON.parse(raw) as UpdaterConfig
    return { ...DEFAULT_CONFIG, ...parsed }
  } catch {
    return DEFAULT_CONFIG
  }
}

export async function setConfig(cfg: UpdaterConfig): Promise<void> {
  ensureRoot()
  await fsp.writeFile(CONFIG_FILE(), JSON.stringify(cfg, null, 2), 'utf8')
}

// ── Active version (which install to run) ─────────────────────────
export async function getActive(): Promise<ActiveDynamo | null> {
  ensureRoot()
  try {
    const raw = await fsp.readFile(ACTIVE_FILE(), 'utf8')
    return JSON.parse(raw) as ActiveDynamo
  } catch {
    return null
  }
}

export async function setActive(a: ActiveDynamo): Promise<void> {
  ensureRoot()
  await fsp.writeFile(ACTIVE_FILE(), JSON.stringify(a, null, 2), 'utf8')
}

/**
 * Returns the filesystem root of the DynamoPy install the manager should use.
 * If active.json points to a valid install, returns that directory; otherwise
 * returns null and callers fall back to the bundled DynamoPy shipped in the
 * app resources.
 */
export async function getActiveInstallPath(): Promise<string | null> {
  const a = await getActive()
  if (!a) return null
  const dir = INSTALL_DIR(a.tag)
  if (!existsSync(dir)) return null
  // The zip has been extracted into this dir. The DynamoPy workflow zips a
  // `bundle/` subfolder, so resolve one level deeper when present.
  const bundleDir = path.join(dir, 'bundle')
  return existsSync(bundleDir) ? bundleDir : dir
}

// ── Installed versions on disk ────────────────────────────────────
export async function listInstalled(): Promise<InstalledVersion[]> {
  ensureRoot()
  const active = await getActive()
  const root = USER_DYNAMO_ROOT()
  const entries = await fsp.readdir(root, { withFileTypes: true })
  const versions: InstalledVersion[] = []
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const tag = ent.name
    const dir = path.join(root, tag)
    try {
      const stat = await fsp.stat(dir)
      versions.push({
        tag,
        path: dir,
        installedAt: stat.mtime.toISOString(),
        isActive: active?.tag === tag,
      })
    } catch {
      // ignore unreadable entries
    }
  }
  // Newest first
  versions.sort((a, b) => b.installedAt.localeCompare(a.installedAt))
  return versions
}

export async function removeInstalled(tag: string): Promise<void> {
  const active = await getActive()
  if (active?.tag === tag) {
    throw new Error('Cannot remove the currently active version')
  }
  const dir = INSTALL_DIR(tag)
  if (existsSync(dir)) {
    await fsp.rm(dir, { recursive: true, force: true })
  }
}

// ── GitHub release discovery ─────────────────────────────────────
/** Produces the tag prefix used to filter releases for a channel. */
export function tagPrefix(channel: DynamoChannel): string {
  return channel === 'stable' ? 'stable-v' : 'beta-v'
}

interface GhRelease {
  tag_name: string
  name: string
  published_at: string
  prerelease: boolean
  assets: Array<{ id: number; name: string; browser_download_url: string; url: string; size: number }>
  zipball_url: string
}

async function fetchReleases(): Promise<GhRelease[]> {
  // GitHub paginates; 100 per page is the max. DynamoPy should rarely exceed
  // this in active channels — we page up to 3 times just in case.
  const out: GhRelease[] = []
  for (let page = 1; page <= 3; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${DYNAMO_REPO}/releases?per_page=100&page=${page}`,
      {
        headers: ghApiHeaders(),
        signal: AbortSignal.timeout(8000),
      },
    )
    if (!res.ok) throw new Error(`GitHub API ${res.status}`)
    const batch = (await res.json()) as GhRelease[]
    out.push(...batch)
    if (batch.length < 100) break
  }
  return out
}

function pickZipAsset(r: GhRelease): { url: string; name: string; size: number | null } {
  const asset = r.assets?.find((a) => a.name.toLowerCase().endsWith('.zip'))
  // For private repos we must use the API asset URL with Accept: application/octet-stream,
  // not browser_download_url (which redirects to S3 and drops the Authorization header).
  if (asset) return { url: asset.url, name: asset.name, size: asset.size }
  // Fallback: GitHub's autogenerated zipball
  return { url: r.zipball_url, name: `${r.tag_name}.zip`, size: null }
}

function toDynamoRelease(r: GhRelease): DynamoRelease {
  const { url, name, size } = pickZipAsset(r)
  return {
    tag: r.tag_name,
    name: r.name || r.tag_name,
    publishedAt: r.published_at,
    zipUrl: url,
    zipName: name,
    zipSize: size,
    prerelease: r.prerelease,
  }
}

/** Lists releases matching the channel, newest first. */
export async function listChannelReleases(channel: DynamoChannel): Promise<DynamoRelease[]> {
  const prefix = tagPrefix(channel)
  const all = await fetchReleases()
  const matches = all.filter((r) => r.tag_name.startsWith(prefix))
  matches.sort((a, b) => b.tag_name.localeCompare(a.tag_name))
  return matches.map(toDynamoRelease)
}

/** Returns the latest release in the channel, or null if none match. */
export async function latestRelease(channel: DynamoChannel): Promise<DynamoRelease | null> {
  const list = await listChannelReleases(channel)
  return list[0] ?? null
}

// ── Download + install ───────────────────────────────────────────
export async function downloadAndInstall(
  release: DynamoRelease,
  channel: DynamoChannel,
): Promise<InstalledVersion> {
  ensureRoot()
  const destDir = INSTALL_DIR(release.tag)
  // Already installed? Skip download.
  if (existsSync(destDir)) {
    const stat = await fsp.stat(destDir)
    const active = await getActive()
    return { tag: release.tag, path: destDir, installedAt: stat.mtime.toISOString(), isActive: active?.tag === release.tag }
  }

  // Download to a temp file
  const tmp = path.join(USER_DYNAMO_ROOT(), `.download-${release.tag.replace(/[^a-zA-Z0-9]/g, '_')}.zip`)
  const res = await fetch(release.zipUrl, {
    headers: ghDownloadHeaders(),
    // no timeout — downloads can be large
  })
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await fsp.writeFile(tmp, buf)

  // Extract
  mkdirSync(destDir, { recursive: true })
  try {
    const zip = new AdmZip(tmp)
    zip.extractAllTo(destDir, /* overwrite */ true)
  } catch (err) {
    // Clean up on failure
    await fsp.rm(destDir, { recursive: true, force: true }).catch(() => {})
    throw new Error(`Extraction failed: ${(err as Error).message}`)
  } finally {
    await fsp.unlink(tmp).catch(() => {})
  }

  // Persist channel on the install for reference (so rollback knows where it came from)
  await fsp.writeFile(
    path.join(destDir, '.source.json'),
    JSON.stringify({ channel, tag: release.tag, installedAt: new Date().toISOString() }, null, 2),
    'utf8',
  )

  const stat = await fsp.stat(destDir)
  return { tag: release.tag, path: destDir, installedAt: stat.mtime.toISOString(), isActive: false }
}

export async function activate(tag: string, channel: DynamoChannel): Promise<void> {
  const dir = INSTALL_DIR(tag)
  if (!existsSync(dir)) throw new Error(`Version ${tag} is not installed`)
  await setActive({
    channel,
    tag,
    installedAt: new Date().toISOString(),
  })
}

/** Clears active.json, so DynamoManager falls back to the bundled version. */
export async function deactivate(): Promise<void> {
  const p = ACTIVE_FILE()
  if (existsSync(p)) await fsp.unlink(p)
}
