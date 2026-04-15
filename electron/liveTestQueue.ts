import { promises as fsp, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { SaveSessionPayload } from '../src/lib/liveTestPayload'

export class LiveTestQueue {
  private readonly dir: string
  private readonly poisonDir: string

  constructor(baseDir: string) {
    this.dir = baseDir
    this.poisonDir = join(baseDir, 'poison')
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
    if (!existsSync(this.poisonDir)) mkdirSync(this.poisonDir, { recursive: true })
  }

  private pathFor(id: string, poison = false): string {
    return join(poison ? this.poisonDir : this.dir, `${id}.json`)
  }

  async enqueue(payload: SaveSessionPayload): Promise<void> {
    const id = payload.session.id
    await fsp.writeFile(this.pathFor(id), JSON.stringify(payload), 'utf8')
  }

  async remove(id: string): Promise<void> {
    const p = this.pathFor(id)
    if (existsSync(p)) await fsp.unlink(p)
  }

  async list(): Promise<string[]> {
    const entries = await fsp.readdir(this.dir)
    return entries
      .filter((n) => n.endsWith('.json'))
      .map((n) => n.slice(0, -'.json'.length))
  }

  async read(id: string): Promise<SaveSessionPayload> {
    const content = await fsp.readFile(this.pathFor(id), 'utf8')
    return JSON.parse(content) as SaveSessionPayload
  }

  async moveToPoison(id: string, error: string): Promise<void> {
    const src = this.pathFor(id)
    const dst = this.pathFor(id, true)
    if (existsSync(src)) {
      await fsp.rename(src, dst)
    }
    await fsp.writeFile(
      join(this.poisonDir, `${id}.error.txt`),
      `${new Date().toISOString()}\n${error}\n`,
      'utf8',
    )
  }

  async status(): Promise<{ queued: number; poison: number }> {
    const queued = (await fsp.readdir(this.dir)).filter((n) => n.endsWith('.json')).length
    const poison = (await fsp.readdir(this.poisonDir)).filter((n) => n.endsWith('.json')).length
    return { queued, poison }
  }
}
