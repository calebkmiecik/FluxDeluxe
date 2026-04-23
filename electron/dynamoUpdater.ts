/**
 * DynamoPy hot-update manager.
 *
 * Responsibilities:
 *  - Track which version of DynamoPy the app should run (active.json)
 *  - Check GitHub Releases on Axioforce/AxioforceDynamoPy for newer versions
 *    in a configurable channel (stable / beta / other)
 *  - Download + extract release zips into userData/dynamopy/<tag>/
 *  - Expose a minimal API consumed by IPC handlers
 *
 * Version tag format (produced by the DynamoPy release workflow):
 *   stable-v<timestamp>
 *   beta-v<timestamp>
 *   edge-<branch-slug>-v<timestamp>
 *
 * Client filtering by channel:
 *   stable channel → tags starting with 'stable-v'
 *   beta   channel → tags starting with 'beta-v'
 *   other  channel + branch 'foo' → tags starting with 'edge-<slug(foo)>-v'
 *
 * "Latest" = release with alphabetically-greatest tag within the channel prefix.
 * (Timestamps are ISO-style UTC so they sort lexicographically.)
 */

import { promises as fsp, existsSync, mkdirSync } from 'fs'
import path from 'path'
import { app } from 'electron'
import AdmZip from 'adm-zip'

const DYNAMO_REPO = 'Axioforce/AxioforceDynamoPy'

export type DynamoChannel = 'stable' | 'beta' | 'other'

export interface UpdaterConfig {
  channel: DynamoChannel
  /** Only used when channel === 'other'. Free-form branch name typed by operator. */
  branch: string | null
}

export interface ActiveDynamo {
  channel: DynamoChannel
  branch: string | null
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

// ── Config (persistent channel + branch selection) ────────────────
const DEFAULT_CONFIG: UpdaterConfig = { channel: 'stable', branch: null }

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
/** Produces the tag prefix used to filter releases for a channel+branch. */
export function tagPrefix(channel: DynamoChannel, branch: string | null): string {
  if (channel === 'stable') return 'stable-v'
  if (channel === 'beta')   return 'beta-v'
  // 'other': match workflow's slug rules (lowercase, non-alnum → '-')
  const slug = (branch ?? '').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return slug ? `edge-${slug}-v` : 'edge-'
}

interface GhRelease {
  tag_name: string
  name: string
  published_at: string
  prerelease: boolean
  assets: Array<{ name: string; browser_download_url: string; size: number }>
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
        headers: { 'Accept': 'application/vnd.github+json' },
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
  if (asset) return { url: asset.browser_download_url, name: asset.name, size: asset.size }
  // Fallback: GitHub's autogenerated zipball
  return { url: r.zipball_url, name: `${r.tag_name}.zip`, size: null }
}

function toDynamoRelease(r: GhRelease, channel: DynamoChannel, branch: string | null): DynamoRelease {
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

/** Lists releases matching the channel (+ branch for 'other'), newest first. */
export async function listChannelReleases(channel: DynamoChannel, branch: string | null): Promise<DynamoRelease[]> {
  const prefix = tagPrefix(channel, branch)
  const all = await fetchReleases()
  const matches = all.filter((r) => r.tag_name.startsWith(prefix))
  matches.sort((a, b) => b.tag_name.localeCompare(a.tag_name))
  return matches.map((r) => toDynamoRelease(r, channel, branch))
}

/** Returns the latest release in the channel, or null if none match. */
export async function latestRelease(channel: DynamoChannel, branch: string | null): Promise<DynamoRelease | null> {
  const list = await listChannelReleases(channel, branch)
  return list[0] ?? null
}

// ── Download + install ───────────────────────────────────────────
export async function downloadAndInstall(
  release: DynamoRelease,
  channel: DynamoChannel,
  branch: string | null,
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
    headers: { 'Accept': 'application/octet-stream' },
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

  // Persist channel+branch on the install for reference (so rollback knows where it came from)
  await fsp.writeFile(
    path.join(destDir, '.source.json'),
    JSON.stringify({ channel, branch, tag: release.tag, installedAt: new Date().toISOString() }, null, 2),
    'utf8',
  )

  const stat = await fsp.stat(destDir)
  return { tag: release.tag, path: destDir, installedAt: stat.mtime.toISOString(), isActive: false }
}

export async function activate(tag: string, channel: DynamoChannel, branch: string | null): Promise<void> {
  const dir = INSTALL_DIR(tag)
  if (!existsSync(dir)) throw new Error(`Version ${tag} is not installed`)
  await setActive({
    channel,
    branch,
    tag,
    installedAt: new Date().toISOString(),
  })
}

/** Clears active.json, so DynamoManager falls back to the bundled version. */
export async function deactivate(): Promise<void> {
  const p = ACTIVE_FILE()
  if (existsSync(p)) await fsp.unlink(p)
}
