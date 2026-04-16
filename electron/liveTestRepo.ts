import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { SaveSessionPayload } from '../src/lib/liveTestPayload'
import type { SessionListRow, SessionDetail, OverviewResult } from '../src/lib/liveTestRepoTypes'
import type { DashboardFilters } from '../src/lib/dashboardFilters'
import { effectiveTimeRange, effectiveDeviceTypes } from '../src/lib/dashboardFilters'

export type { SessionListRow, SessionDetail, OverviewResult }  // re-export for main-process callers

export class LiveTestRepo {
  constructor(private readonly client: SupabaseClient) {}

  static fromEnv(env?: { url: string; key: string }): LiveTestRepo {
    const url = env?.url ?? process.env.SUPABASE_URL
    const key = env?.key ?? process.env.SUPABASE_KEY
    if (!url || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_KEY must be set')
    }
    return new LiveTestRepo(createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }))
  }

  async saveSession(payload: SaveSessionPayload): Promise<void> {
    const { error } = await this.client.rpc('save_live_session', { payload })
    if (error) throw new Error(`saveSession failed: ${error.message}`)
  }

  async listSessions(opts: {
    limit: number
    offset: number
    filter: DashboardFilters
  }): Promise<SessionListRow[]> {
    let q = this.client
      .from('sessions')
      .select('id, started_at, device_id, device_type, tester_name, model_id, body_weight_n, n_cells_captured, n_cells_expected, overall_pass_rate, devices(nickname)')
      .order('started_at', { ascending: false })
      .range(opts.offset, opts.offset + opts.limit - 1)

    const { fromIso, toIso } = effectiveTimeRange(opts.filter)
    if (fromIso) q = q.gte('started_at', fromIso)
    if (toIso)   q = q.lte('started_at', toIso)

    const types = effectiveDeviceTypes(opts.filter)
    if (types && types.length > 0) q = q.in('device_type', types)

    if (opts.filter.weightMinN !== null) q = q.gte('body_weight_n', opts.filter.weightMinN)
    if (opts.filter.weightMaxN !== null) q = q.lte('body_weight_n', opts.filter.weightMaxN)

    const searchTerm = opts.filter.search.trim()
    if (searchTerm) {
      // Match device_id, tester_name, device_type, model_id, or joined devices.nickname
      const escaped = searchTerm.replace(/[%_]/g, '\\$&')
      q = q.or(
        `device_id.ilike.%${escaped}%,tester_name.ilike.%${escaped}%,device_type.ilike.%${escaped}%,model_id.ilike.%${escaped}%`,
      )
    }

    const { data, error } = await q
    if (error) throw new Error(`listSessions failed: ${error.message}`)
    return (data ?? []).map((r: any) => ({
      id: r.id,
      started_at: r.started_at,
      device_id: r.device_id,
      device_type: r.device_type,
      tester_name: r.tester_name,
      model_id: r.model_id,
      body_weight_n: r.body_weight_n,
      n_cells_captured: r.n_cells_captured,
      n_cells_expected: r.n_cells_expected,
      overall_pass_rate: r.overall_pass_rate,
      device_nickname: r.devices?.nickname ?? null,
    }))
  }

  async getSession(id: string): Promise<SessionDetail> {
    const [sessionRes, cellsRes, aggRes] = await Promise.all([
      this.client.from('sessions').select('*').eq('id', id).single(),
      this.client.from('session_cells').select('*').eq('session_id', id).order('stage_index').order('row').order('col'),
      this.client.from('session_stage_aggregates').select('*').eq('session_id', id),
    ])
    if (sessionRes.error) throw new Error(`getSession failed: ${sessionRes.error.message}`)
    if (cellsRes.error) throw new Error(`getSession cells failed: ${cellsRes.error.message}`)
    if (aggRes.error) throw new Error(`getSession aggregates failed: ${aggRes.error.message}`)
    return {
      session: sessionRes.data as Record<string, unknown>,
      cells: (cellsRes.data ?? []) as Array<Record<string, unknown>>,
      aggregates: (aggRes.data ?? []) as Array<Record<string, unknown>>,
    }
  }

  async getOverview(filter: DashboardFilters): Promise<OverviewResult> {
    let sessQuery = this.client.from('sessions').select('id, device_id, n_cells_captured, overall_pass_rate')

    const { fromIso, toIso } = effectiveTimeRange(filter)
    if (fromIso) sessQuery = sessQuery.gte('started_at', fromIso)
    if (toIso)   sessQuery = sessQuery.lte('started_at', toIso)

    const types = effectiveDeviceTypes(filter)
    if (types && types.length > 0) sessQuery = sessQuery.in('device_type', types)

    if (filter.weightMinN !== null) sessQuery = sessQuery.gte('body_weight_n', filter.weightMinN)
    if (filter.weightMaxN !== null) sessQuery = sessQuery.lte('body_weight_n', filter.weightMaxN)

    const searchTerm = filter.search.trim()
    if (searchTerm) {
      const escaped = searchTerm.replace(/[%_]/g, '\\$&')
      sessQuery = sessQuery.or(
        `device_id.ilike.%${escaped}%,tester_name.ilike.%${escaped}%,device_type.ilike.%${escaped}%,model_id.ilike.%${escaped}%`,
      )
    }

    const { data: sessions, error: sErr } = await sessQuery
    if (sErr) throw new Error(`getOverview sessions failed: ${sErr.message}`)
    const ids = (sessions ?? []).map((s: any) => s.id)

    let aggRows: any[] = []
    if (ids.length > 0) {
      const { data, error } = await this.client
        .from('session_stage_aggregates')
        .select('*')
        .in('session_id', ids)
      if (error) throw new Error(`getOverview aggregates failed: ${error.message}`)
      aggRows = data ?? []
    }

    const per_stage_type = (['dumbbell', 'two_leg', 'one_leg'] as const).map((stage_type) => {
      const rows = aggRows.filter((r) => r.stage_type === stage_type && r.n_cells > 0)
      const avg = (key: string) => rows.length === 0 ? null : rows.reduce((s, r) => s + Number(r[key]), 0) / rows.length
      return {
        stage_type,
        mae: avg('mae'),
        signed_mean_error: avg('signed_mean_error'),
        std_error: avg('std_error'),
        pass_rate: avg('pass_rate'),
      }
    })

    const cells_captured = (sessions ?? []).reduce((s: number, r: any) => s + (r.n_cells_captured ?? 0), 0)
    const passRates = (sessions ?? []).map((r: any) => r.overall_pass_rate).filter((x: any) => x !== null && x !== undefined)
    const overall_pass_rate = passRates.length === 0 ? null : passRates.reduce((a: number, b: number) => a + b, 0) / passRates.length
    const device_count = new Set((sessions ?? []).map((r: any) => r.device_id)).size

    return {
      session_count: sessions?.length ?? 0,
      cells_captured,
      device_count,
      overall_pass_rate,
      mae_pct: null,           // TODO: compute from session_cells once schema adds % fields
      signed_error_pct: null,  // TODO: compute from session_cells once schema adds % fields
      per_stage_type,
    }
  }

  /** Delete all rows with `app_version LIKE 'test-%'`. Used by integration test cleanup. */
  async deleteTestSessions(): Promise<void> {
    const { error } = await this.client.from('sessions').delete().like('app_version', 'test-%')
    if (error) throw new Error(`deleteTestSessions failed: ${error.message}`)
  }
}
