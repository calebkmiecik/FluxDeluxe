// @vitest-environment node
import { describe, it, expect, vi, afterAll } from 'vitest'
import { LiveTestRepo } from './liveTestRepo'
import type { SaveSessionPayload } from '../src/lib/liveTestPayload'

function makePayload(id = 'test-id'): SaveSessionPayload {
  return {
    session: {
      id, started_at: new Date().toISOString(), ended_at: new Date().toISOString(),
      device_id: 'DEV-1', device_type: '07', model_id: 'v1', tester_name: 't',
      body_weight_n: 800, grid_rows: 3, grid_cols: 3,
      n_cells_captured: 0, n_cells_expected: 54,
      overall_pass_rate: null, app_version: 'test-0',
    },
    cells: [],
    aggregates: [
      { stage_type: 'dumbbell', n_cells: 0, mae: null, signed_mean_error: null, std_error: null, pass_rate: null },
      { stage_type: 'two_leg',  n_cells: 0, mae: null, signed_mean_error: null, std_error: null, pass_rate: null },
      { stage_type: 'one_leg',  n_cells: 0, mae: null, signed_mean_error: null, std_error: null, pass_rate: null },
    ],
  }
}

describe('LiveTestRepo (mocked client)', () => {
  it('saveSession calls the save_live_session RPC with the payload', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'test-id', error: null })
    const client = { rpc } as any
    const repo = new LiveTestRepo(client)
    await repo.saveSession(makePayload())
    expect(rpc).toHaveBeenCalledWith('save_live_session', { payload: expect.anything() })
  })

  it('saveSession rejects when rpc returns an error', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } })
    const client = { rpc } as any
    const repo = new LiveTestRepo(client)
    await expect(repo.saveSession(makePayload())).rejects.toThrow(/boom/)
  })
})

const hasTestEnv = !!(process.env.SUPABASE_TEST_URL && process.env.SUPABASE_TEST_KEY)
describe.skipIf(!hasTestEnv)('LiveTestRepo (integration against test project)', () => {
  it('saves and reads back a session end-to-end', async () => {
    const repo = LiveTestRepo.fromEnv({
      url: process.env.SUPABASE_TEST_URL!,
      key: process.env.SUPABASE_TEST_KEY!,
    })
    const payload = makePayload(`test-${Date.now()}`)
    await repo.saveSession(payload)

    const read = await repo.getSession(payload.session.id)
    expect(read.session.id).toBe(payload.session.id)
    expect(read.cells).toEqual([])
    expect(read.aggregates).toHaveLength(3)

    // Idempotent retry: second save must not throw
    await repo.saveSession(payload)
  })

  // Suite-level cleanup of `test-*` rows left by prior runs
  afterAll(async () => {
    const repo = LiveTestRepo.fromEnv({
      url: process.env.SUPABASE_TEST_URL!,
      key: process.env.SUPABASE_TEST_KEY!,
    })
    await repo.deleteTestSessions()
  })
})
