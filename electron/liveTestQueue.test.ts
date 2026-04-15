// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { LiveTestQueue } from './liveTestQueue'

const makeTmp = () => mkdtempSync(join(tmpdir(), 'lt-queue-'))

describe('LiveTestQueue', () => {
  let dir: string
  beforeEach(() => { dir = makeTmp() })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('enqueue writes a JSON file named <id>.json', async () => {
    const q = new LiveTestQueue(dir)
    await q.enqueue({ session: { id: 'abc' }, cells: [], aggregates: [] } as any)
    const files = readdirSync(dir)
    expect(files).toContain('abc.json')
  })

  it('remove deletes the queue file', async () => {
    const q = new LiveTestQueue(dir)
    await q.enqueue({ session: { id: 'abc' }, cells: [], aggregates: [] } as any)
    await q.remove('abc')
    expect(existsSync(join(dir, 'abc.json'))).toBe(false)
  })

  it('list returns all queued payload ids', async () => {
    const q = new LiveTestQueue(dir)
    await q.enqueue({ session: { id: '1' }, cells: [], aggregates: [] } as any)
    await q.enqueue({ session: { id: '2' }, cells: [], aggregates: [] } as any)
    const ids = await q.list()
    expect(ids.sort()).toEqual(['1', '2'])
  })

  it('read returns parsed payload', async () => {
    const q = new LiveTestQueue(dir)
    const payload = { session: { id: 'x' }, cells: [], aggregates: [] } as any
    await q.enqueue(payload)
    const readBack = await q.read('x')
    expect(readBack).toEqual(payload)
  })

  it('moveToPoison relocates the file under poison/', async () => {
    const q = new LiveTestQueue(dir)
    await q.enqueue({ session: { id: 'bad' }, cells: [], aggregates: [] } as any)
    await q.moveToPoison('bad', 'schema mismatch')
    expect(existsSync(join(dir, 'bad.json'))).toBe(false)
    expect(existsSync(join(dir, 'poison', 'bad.json'))).toBe(true)
    // error log is written next to the file
    expect(existsSync(join(dir, 'poison', 'bad.error.txt'))).toBe(true)
  })

  it('status returns queued and poison counts', async () => {
    const q = new LiveTestQueue(dir)
    await q.enqueue({ session: { id: 'a' }, cells: [], aggregates: [] } as any)
    await q.enqueue({ session: { id: 'b' }, cells: [], aggregates: [] } as any)
    await q.moveToPoison('b', 'err')
    const s = await q.status()
    expect(s.queued).toBe(1)
    expect(s.poison).toBe(1)
  })
})
