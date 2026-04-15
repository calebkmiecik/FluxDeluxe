# Live Test Dashboard & Persistence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist completed live test sessions to Supabase and build a Dashboard tab that surfaces aggregate accuracy metrics and a history of recent sessions.

**Architecture:** Renderer writes stay isolated from the DB — payloads travel through IPC to the Electron main process, which owns the Supabase service key. Failed saves go to a local file queue that retries on app start. The Dashboard reads are separate IPC handlers. Aggregates are precomputed per-session at save time and stored in a child table for fast rollup queries.

**Tech Stack:** TypeScript, React 19, Zustand, Electron 35, vitest, `@supabase/supabase-js` (new), Supabase/Postgres.

**Spec:** [docs/superpowers/specs/2026-04-15-live-test-dashboard-design.md](../specs/2026-04-15-live-test-dashboard-design.md)

---

## File manifest

**New:**
- `supabase/migrations/20260415000000_live_test.sql` — DDL + `save_live_session` RPC (run manually)
- `electron/liveTestRepo.ts` — Supabase client wrapper (read/write)
- `electron/liveTestQueue.ts` — local file queue
- `electron/ipc/liveTest.ts` — IPC handler registration
- `electron/liveTestRepo.test.ts` — integration tests (optional, env-gated)
- `electron/liveTestQueue.test.ts` — queue unit tests
- `src/lib/liveTestPayload.ts` — renderer payload builder
- `src/lib/liveTestPayload.test.ts`
- `src/lib/liveTestAggregates.ts` — pure aggregate math
- `src/lib/liveTestAggregates.test.ts`
- `src/lib/liveTestRepoTypes.ts` — shared read-path types (`SessionListRow`, `SessionDetail`, `OverviewResult`) so the renderer doesn't import from `electron/`
- `src/pages/fluxlite/DashboardPage.tsx`
- `src/pages/fluxlite/DashboardOverview.tsx`
- `src/pages/fluxlite/SessionList.tsx`
- `src/pages/fluxlite/SessionDetailModal.tsx`

**Modified:**
- `src/lib/liveTestTypes.ts` — add `signedErrorN` to `CellMeasurement`
- `src/lib/measurementEngine.ts` — compute `signedErrorN`
- `src/pages/fluxlite/ControlPanel.tsx` — replace the single "New Session" button on SUMMARY with **Complete** / **Discard**; wire `saveSession` IPC call. This is where the live-test summary UI actually lives (`SummaryBody` + action bar), **not** `SummaryView.tsx` (which is dead code and will be deleted).
- `src/pages/fluxlite/FluxLitePage.tsx` — swap `HistoryPage` import for `DashboardPage`
- `electron/main.ts` — register IPC + run `retryQueued()` on start
- `electron/preload.ts` — extend `electronAPI` with `liveTest` sub-object
- `src/global.d.ts` — extend the existing `ElectronAPI` interface with `liveTest` sub-object (do NOT create a new types file)
- `package.json` — add `@supabase/supabase-js`
- `.env` — add optional `SUPABASE_TEST_URL` / `SUPABASE_TEST_KEY` for integration tests

**Removed:**
- `src/pages/fluxlite/HistoryPage.tsx`
- `src/pages/fluxlite/SummaryView.tsx` — dead code; summary UI lives inside ControlPanel's `SummaryBody`

---

## Phase 1: Foundation

### Task 1: Apply Supabase schema

**Files:**
- Create: `supabase/migrations/20260415000000_live_test.sql`

This task produces the SQL and documents the manual apply step. The repo does not currently have Supabase CLI integration — the file is a durable source of truth and will need to be applied via the Supabase SQL Editor (dashboard) or `psql` against the project URL.

- [ ] **Step 1: Create the migrations directory and file**

Create `supabase/migrations/20260415000000_live_test.sql` with the full SQL below. The filename prefix matches Supabase CLI convention so a future `supabase db push` will pick it up.

```sql
-- 20260415000000_live_test.sql
-- Live test persistence: devices, sessions, session_cells, session_stage_aggregates + save RPC.

create extension if not exists "uuid-ossp";

-- ─────────────────────────────────────────────────────────────
-- devices
-- ─────────────────────────────────────────────────────────────
create table if not exists public.devices (
  device_id      text primary key,
  device_type    text not null,
  nickname       text,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- sessions
-- ─────────────────────────────────────────────────────────────
create table if not exists public.sessions (
  id                 uuid primary key,
  started_at         timestamptz not null,
  ended_at           timestamptz not null,
  device_id          text not null references public.devices(device_id),
  device_type        text not null,
  model_id           text,
  tester_name        text,
  body_weight_n      numeric,
  grid_rows          int  not null,
  grid_cols          int  not null,
  n_cells_captured   int  not null,
  n_cells_expected   int  not null,
  overall_pass_rate  numeric,
  app_version        text
);
create index if not exists sessions_started_at_desc
  on public.sessions (started_at desc);

-- ─────────────────────────────────────────────────────────────
-- session_cells
-- ─────────────────────────────────────────────────────────────
create table if not exists public.session_cells (
  id              uuid primary key default uuid_generate_v4(),
  session_id      uuid not null references public.sessions(id) on delete cascade,
  stage_index     int  not null,
  stage_name      text not null,
  stage_type      text not null check (stage_type in ('dumbbell','two_leg','one_leg')),
  stage_location  text not null check (stage_location in ('A','B')),
  target_n        numeric not null,
  tolerance_n     numeric not null,
  row             int  not null,
  col             int  not null,
  mean_fz_n       numeric not null,
  std_fz_n        numeric not null,
  error_n         numeric not null,
  signed_error_n  numeric not null,
  error_ratio     numeric not null,
  color_bin       text not null,
  pass            boolean not null,
  captured_at     timestamptz not null
);
create index if not exists session_cells_session_id
  on public.session_cells (session_id);
create index if not exists session_cells_session_stage_type
  on public.session_cells (session_id, stage_type);

-- ─────────────────────────────────────────────────────────────
-- session_stage_aggregates
-- ─────────────────────────────────────────────────────────────
create table if not exists public.session_stage_aggregates (
  session_id         uuid not null references public.sessions(id) on delete cascade,
  stage_type         text not null check (stage_type in ('dumbbell','two_leg','one_leg')),
  n_cells            int  not null,
  mae                numeric,
  signed_mean_error  numeric,
  std_error          numeric,
  pass_rate          numeric,
  primary key (session_id, stage_type)
);

-- ─────────────────────────────────────────────────────────────
-- RPC: save_live_session (atomic)
-- ─────────────────────────────────────────────────────────────
create or replace function public.save_live_session(payload jsonb)
returns uuid
language plpgsql
as $$
declare
  s uuid;
  inserted_id uuid;
begin
  -- Upsert device first
  insert into public.devices (device_id, device_type, last_seen_at)
  values (
    payload->'session'->>'device_id',
    payload->'session'->>'device_type',
    now()
  )
  on conflict (device_id) do update
    set device_type  = excluded.device_type,
        last_seen_at = excluded.last_seen_at;

  -- Insert session idempotently
  insert into public.sessions (
    id, started_at, ended_at, device_id, device_type, model_id, tester_name,
    body_weight_n, grid_rows, grid_cols, n_cells_captured, n_cells_expected,
    overall_pass_rate, app_version
  )
  values (
    (payload->'session'->>'id')::uuid,
    (payload->'session'->>'started_at')::timestamptz,
    (payload->'session'->>'ended_at')::timestamptz,
    payload->'session'->>'device_id',
    payload->'session'->>'device_type',
    payload->'session'->>'model_id',
    payload->'session'->>'tester_name',
    nullif(payload->'session'->>'body_weight_n','')::numeric,
    (payload->'session'->>'grid_rows')::int,
    (payload->'session'->>'grid_cols')::int,
    (payload->'session'->>'n_cells_captured')::int,
    (payload->'session'->>'n_cells_expected')::int,
    nullif(payload->'session'->>'overall_pass_rate','')::numeric,
    payload->'session'->>'app_version'
  )
  on conflict (id) do nothing
  returning id into inserted_id;

  -- If already existed, idempotent retry — nothing more to do
  if inserted_id is null then
    return (payload->'session'->>'id')::uuid;
  end if;

  s := inserted_id;

  -- Insert cells
  insert into public.session_cells (
    session_id, stage_index, stage_name, stage_type, stage_location,
    target_n, tolerance_n, row, col, mean_fz_n, std_fz_n, error_n,
    signed_error_n, error_ratio, color_bin, pass, captured_at
  )
  select
    s,
    (c->>'stage_index')::int,
    c->>'stage_name',
    c->>'stage_type',
    c->>'stage_location',
    (c->>'target_n')::numeric,
    (c->>'tolerance_n')::numeric,
    (c->>'row')::int,
    (c->>'col')::int,
    (c->>'mean_fz_n')::numeric,
    (c->>'std_fz_n')::numeric,
    (c->>'error_n')::numeric,
    (c->>'signed_error_n')::numeric,
    (c->>'error_ratio')::numeric,
    c->>'color_bin',
    (c->>'pass')::boolean,
    (c->>'captured_at')::timestamptz
  from jsonb_array_elements(payload->'cells') as t(c);

  -- Insert aggregates
  insert into public.session_stage_aggregates (
    session_id, stage_type, n_cells, mae, signed_mean_error, std_error, pass_rate
  )
  select
    s,
    a->>'stage_type',
    (a->>'n_cells')::int,
    nullif(a->>'mae','')::numeric,
    nullif(a->>'signed_mean_error','')::numeric,
    nullif(a->>'std_error','')::numeric,
    nullif(a->>'pass_rate','')::numeric
  from jsonb_array_elements(payload->'aggregates') as t(a);

  return s;
end;
$$;
```

- [ ] **Step 2: Apply migration to Supabase**

Manual step (not scripted):

1. Open the Supabase dashboard for the project referenced in `.env` (`SUPABASE_URL=https://fboiqvmipkmexzxlxmss.supabase.co`).
2. Go to **SQL Editor** → **New query**.
3. Paste the full contents of `20260415000000_live_test.sql`.
4. Click **Run**.
5. Verify in **Table Editor** that `devices`, `sessions`, `session_cells`, `session_stage_aggregates` all exist.
6. Verify in **Database → Functions** that `save_live_session` exists.

If a separate test project is in use, apply the same migration there too (see Task 7).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260415000000_live_test.sql
git commit -m "feat(db): add live test schema and save_live_session RPC"
```

---

### Task 2: Add signed error to the measurement engine

**Files:**
- Modify: `src/lib/liveTestTypes.ts` (add `signedErrorN` to `CellMeasurement`)
- Modify: `src/lib/measurementEngine.ts` (`captureCell` method)
- Test: `src/lib/measurementEngine.test.ts` (new — see Step 1)

- [ ] **Step 1: Write the failing test**

Create `src/lib/measurementEngine.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { MeasurementEngine } from './measurementEngine'
import type { StageDefinition } from './liveTestTypes'
import type { DeviceFrame } from './types'

// Helper: build a minimal DeviceFrame. Note the engine's internal window
// stores frame.fz verbatim (signed), but armaing uses |fz| >= 50N.
function frame(fz: number, copX = 0, copY = 0, t = 0): DeviceFrame {
  return {
    time: t,
    fx: 0, fy: 0, fz,
    mx: 0, my: 0, mz: 0,
    cop: { x: copX, y: copY },
  } as DeviceFrame
}

describe('MeasurementEngine signedErrorN', () => {
  it('records signed_error_n as (meanFz - target), preserving direction', () => {
    const engine = new MeasurementEngine()
    // target 100N; we feed fz=90 so meanFz≈90, signedError = 90 - 100 = -10
    const stage: StageDefinition = {
      index: 0, name: 'DB', type: 'dumbbell', location: 'A',
      targetN: 100, toleranceN: 10,
    }
    const captures: any[] = []
    engine.setCallbacks(() => {}, (m) => captures.push(m))
    engine.setDeviceType('07')

    // Positive Fz above the arming threshold (50N), stable enough to capture.
    // 10 ms cadence for 3s → 1s arming + 1s stability + margin.
    for (let t = 0; t < 3000; t += 10) {
      engine.processFrame(frame(90, 0, 0, t), stage)
    }

    expect(captures.length).toBeGreaterThan(0)
    const m = captures[0]
    expect(m.meanFzN).toBeCloseTo(90, 1)
    expect(m.signedErrorN).toBeCloseTo(-10, 1)      // direction preserved
    expect(m.errorN).toBeCloseTo(10, 1)             // magnitude
    expect(m.errorN).toBeCloseTo(Math.abs(m.signedErrorN), 5)
  })
})
```

Note: `MeasurementEngine.processFrame` computes `fz = Math.abs(frame.fz)` for threshold checks but stores `frame.fz` verbatim in the sample window. So using positive `fz = 90` yields `meanFz ≈ 90`. If the physics of your device emit negative Fz for downward force in production, that's consistent with the engine storing signed values — the test here just uses positive values for clarity.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/measurementEngine.test.ts`
Expected: FAIL — `m.signedErrorN` is undefined.

- [ ] **Step 3: Update `CellMeasurement` type**

In `src/lib/liveTestTypes.ts`, add `signedErrorN` to `CellMeasurement`:

```ts
export interface CellMeasurement {
  row: number
  col: number
  stageIndex: number
  meanFzN: number
  stdFzN: number
  errorN: number         // magnitude: |meanFz - target|
  signedErrorN: number   // directional: meanFz - target (NEW)
  errorRatio: number
  colorBin: string
  pass: boolean
  timestamp: number
}
```

- [ ] **Step 4: Update `captureCell` in the engine**

In `src/lib/measurementEngine.ts` `captureCell` method, add signed error computation and include it in the measurement:

```ts
private captureCell(cell: { row: number; col: number }, stage: StageDefinition) {
  const { fz } = this.window
  const meanFz = fz.reduce((a, b) => a + b, 0) / fz.length
  const variance = fz.reduce((a, b) => a + (b - meanFz) ** 2, 0) / fz.length
  const stdFz = Math.sqrt(variance)
  const signedErrorN = meanFz - stage.targetN   // NEW
  const errorN = Math.abs(signedErrorN)         // now derived from signed
  const errorRatio = stage.toleranceN > 0 ? errorN / stage.toleranceN : 0
  const colorBin = getColorBin(errorRatio)

  const measurement: CellMeasurement = {
    row: cell.row,
    col: cell.col,
    stageIndex: stage.index,
    meanFzN: meanFz,
    stdFzN: stdFz,
    errorN,
    signedErrorN,    // NEW
    errorRatio,
    colorBin,
    pass: errorRatio <= 1.0,
    timestamp: Date.now(),
  }

  this.onCapture?.(measurement)

  this.state = 'IDLE'
  this.currentCell = null
  this.window = { fz: [], copX: [], copY: [], timestamps: [] }
  this.emitStatus({ state: 'CAPTURED', cell, progressMs: STABILITY_DURATION_MS })
  setTimeout(() => {
    this.emitStatus({ state: 'IDLE', cell: null, progressMs: 0 })
  }, 500)
}
```

- [ ] **Step 5: Run tests, ensure all pass**

Run: `npm test`
Expected: all tests PASS (including existing `uiStore.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add src/lib/liveTestTypes.ts src/lib/measurementEngine.ts src/lib/measurementEngine.test.ts
git commit -m "feat(engine): record signed_error_n on CellMeasurement"
```

---

## Phase 2: Pure renderer logic

### Task 3: `liveTestAggregates.ts` — per-stage-type rollups

**Files:**
- Create: `src/lib/liveTestAggregates.ts`
- Create: `src/lib/liveTestAggregates.test.ts`

Pure functions. No React, no store, no I/O — easy to unit-test.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/liveTestAggregates.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeStageTypeAggregates, computeOverallPassRate } from './liveTestAggregates'
import type { CellMeasurement } from './liveTestTypes'

function cell(partial: Partial<CellMeasurement>): CellMeasurement {
  return {
    row: 0, col: 0, stageIndex: 0,
    meanFzN: 100, stdFzN: 1,
    errorN: 0, signedErrorN: 0, errorRatio: 0,
    colorBin: 'green', pass: true, timestamp: 0,
    ...partial,
  }
}

describe('computeStageTypeAggregates', () => {
  it('returns 3 rows — one per stage_type — even when empty', () => {
    const result = computeStageTypeAggregates([], new Map([
      [0, { index: 0, name: 'DB', type: 'dumbbell', location: 'A', targetN: 100, toleranceN: 10 }],
    ]))
    expect(result).toHaveLength(3)
    const types = result.map((r) => r.stage_type).sort()
    expect(types).toEqual(['dumbbell', 'one_leg', 'two_leg'])
    for (const r of result) {
      expect(r.n_cells).toBe(0)
      expect(r.mae).toBeNull()
      expect(r.signed_mean_error).toBeNull()
      expect(r.std_error).toBeNull()
      expect(r.pass_rate).toBeNull()
    }
  })

  it('computes MAE, signed mean, and std across cells of one stage_type', () => {
    const stageMap = new Map([
      [0, { index: 0, name: 'DB-A', type: 'dumbbell' as const, location: 'A' as const, targetN: 100, toleranceN: 10 }],
      [3, { index: 3, name: 'DB-B', type: 'dumbbell' as const, location: 'B' as const, targetN: 100, toleranceN: 10 }],
    ])
    const cells: CellMeasurement[] = [
      cell({ stageIndex: 0, errorN: 4, signedErrorN: -4, pass: true  }),
      cell({ stageIndex: 0, errorN: 6, signedErrorN:  6, pass: true  }),
      cell({ stageIndex: 3, errorN: 8, signedErrorN: -8, pass: false }),
    ]
    const result = computeStageTypeAggregates(cells, stageMap)
    const db = result.find((r) => r.stage_type === 'dumbbell')!
    expect(db.n_cells).toBe(3)
    // MAE = mean(|error|) = (4+6+8)/3 = 6.0
    expect(db.mae).toBeCloseTo(6.0, 5)
    // signed mean = (-4 + 6 + -8) / 3 = -2.0
    expect(db.signed_mean_error).toBeCloseTo(-2.0, 5)
    // std of signed errors (population std)
    // mean -2; deviations -2,8,-6; squares 4,64,36 → var 34.666 → std ≈ 5.888
    expect(db.std_error).toBeCloseTo(5.888, 2)
    expect(db.pass_rate).toBeCloseTo(2 / 3, 5)
  })
})

describe('computeOverallPassRate', () => {
  it('returns null when no captured cells', () => {
    expect(computeOverallPassRate([])).toBeNull()
  })
  it('returns passed / total', () => {
    expect(computeOverallPassRate([
      cell({ pass: true  }),
      cell({ pass: true  }),
      cell({ pass: false }),
    ])).toBeCloseTo(2 / 3, 5)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/liveTestAggregates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `liveTestAggregates.ts`**

Create `src/lib/liveTestAggregates.ts`:

```ts
import type { CellMeasurement, StageDefinition, StageType } from './liveTestTypes'

export interface StageTypeAggregate {
  stage_type: StageType
  n_cells: number
  mae: number | null
  signed_mean_error: number | null
  std_error: number | null
  pass_rate: number | null
}

const ALL_TYPES: StageType[] = ['dumbbell', 'two_leg', 'one_leg']

export function computeStageTypeAggregates(
  cells: CellMeasurement[],
  stagesByIndex: Map<number, StageDefinition>,
): StageTypeAggregate[] {
  return ALL_TYPES.map((stage_type) => {
    const bucket = cells.filter((c) => stagesByIndex.get(c.stageIndex)?.type === stage_type)
    const n_cells = bucket.length
    if (n_cells === 0) {
      return { stage_type, n_cells: 0, mae: null, signed_mean_error: null, std_error: null, pass_rate: null }
    }
    const mae = bucket.reduce((s, c) => s + c.errorN, 0) / n_cells
    const signedMean = bucket.reduce((s, c) => s + c.signedErrorN, 0) / n_cells
    const variance = bucket.reduce((s, c) => s + (c.signedErrorN - signedMean) ** 2, 0) / n_cells
    const std = Math.sqrt(variance)
    const passed = bucket.filter((c) => c.pass).length
    return {
      stage_type,
      n_cells,
      mae,
      signed_mean_error: signedMean,
      std_error: std,
      pass_rate: passed / n_cells,
    }
  })
}

export function computeOverallPassRate(cells: CellMeasurement[]): number | null {
  if (cells.length === 0) return null
  const passed = cells.filter((c) => c.pass).length
  return passed / cells.length
}
```

Note: also add `export type StageType = 'dumbbell' | 'two_leg' | 'one_leg'` to `liveTestTypes.ts` if it's not already exported — it already exists as a type alias in the current file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/liveTestAggregates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/liveTestAggregates.ts src/lib/liveTestAggregates.test.ts
git commit -m "feat: pure aggregate functions for live test cells"
```

---

### Task 4: `liveTestPayload.ts` — build the save payload

**Files:**
- Create: `src/lib/liveTestPayload.ts`
- Create: `src/lib/liveTestPayload.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/liveTestPayload.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildSessionPayload } from './liveTestPayload'
import type { CellMeasurement, SessionMetadata, StageDefinition } from './liveTestTypes'

function cell(p: Partial<CellMeasurement>): CellMeasurement {
  return {
    row: 0, col: 0, stageIndex: 0,
    meanFzN: 100, stdFzN: 1,
    errorN: 0, signedErrorN: 0, errorRatio: 0,
    colorBin: 'green', pass: true, timestamp: 1700000000000,
    ...p,
  }
}

const meta: SessionMetadata = {
  testerName: 'caleb',
  bodyWeightN: 800,
  deviceId: 'AXF-07-0123',
  deviceType: '07',
  modelId: 'v2.1',
  startedAt: 1700000000000,
}

const stages: StageDefinition[] = [
  { index: 0, name: 'DB A',  type: 'dumbbell', location: 'A', targetN: 206.3, toleranceN: 6 },
  { index: 1, name: '2L A',  type: 'two_leg',  location: 'A', targetN: 800,   toleranceN: 12 },
  { index: 2, name: '1L A',  type: 'one_leg',  location: 'A', targetN: 800,   toleranceN: 12 },
  { index: 3, name: 'DB B',  type: 'dumbbell', location: 'B', targetN: 206.3, toleranceN: 6 },
  { index: 4, name: '2L B',  type: 'two_leg',  location: 'B', targetN: 800,   toleranceN: 12 },
  { index: 5, name: '1L B',  type: 'one_leg',  location: 'B', targetN: 800,   toleranceN: 12 },
]

describe('buildSessionPayload', () => {
  it('produces a valid payload with all required fields', () => {
    const measurements = new Map<string, CellMeasurement>()
    measurements.set('0:0,0', cell({ stageIndex: 0, pass: true,  errorN: 4, signedErrorN: 4 }))
    measurements.set('0:0,1', cell({ stageIndex: 0, pass: false, errorN: 8, signedErrorN: -8 }))

    const payload = buildSessionPayload({
      metadata: meta,
      stages,
      measurements,
      gridRows: 3,
      gridCols: 3,
      appVersion: '2.0.0',
      endedAt: 1700000060000,
    })

    // uuid
    expect(payload.session.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(payload.session.device_id).toBe('AXF-07-0123')
    expect(payload.session.started_at).toBe(new Date(1700000000000).toISOString())
    expect(payload.session.ended_at).toBe(new Date(1700000060000).toISOString())
    expect(payload.session.n_cells_captured).toBe(2)
    expect(payload.session.n_cells_expected).toBe(54)
    expect(payload.session.overall_pass_rate).toBeCloseTo(0.5, 5)

    expect(payload.cells).toHaveLength(2)
    expect(payload.cells[0].stage_type).toBe('dumbbell')
    expect(payload.cells[0].stage_location).toBe('A')
    expect(payload.cells[0].signed_error_n).toBe(4)

    expect(payload.aggregates).toHaveLength(3)
    const db = payload.aggregates.find((a) => a.stage_type === 'dumbbell')!
    expect(db.n_cells).toBe(2)
    expect(db.mae).toBeCloseTo(6, 5)
  })

  it('overall_pass_rate is null when no cells captured', () => {
    const payload = buildSessionPayload({
      metadata: meta,
      stages,
      measurements: new Map(),
      gridRows: 3,
      gridCols: 3,
      appVersion: '2.0.0',
      endedAt: 1700000060000,
    })
    expect(payload.session.overall_pass_rate).toBeNull()
    expect(payload.cells).toHaveLength(0)
    // aggregates still present, all null
    expect(payload.aggregates).toHaveLength(3)
    expect(payload.aggregates.every((a) => a.n_cells === 0 && a.mae === null)).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/liveTestPayload.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `liveTestPayload.ts`**

Create `src/lib/liveTestPayload.ts`:

```ts
import type { CellMeasurement, SessionMetadata, StageDefinition, StageType } from './liveTestTypes'
import { computeStageTypeAggregates, computeOverallPassRate } from './liveTestAggregates'

export interface SessionRow {
  id: string
  started_at: string
  ended_at: string
  device_id: string
  device_type: string
  model_id: string
  tester_name: string
  body_weight_n: number
  grid_rows: number
  grid_cols: number
  n_cells_captured: number
  n_cells_expected: number
  overall_pass_rate: number | null
  app_version: string
}

export interface CellRow {
  stage_index: number
  stage_name: string
  stage_type: StageType
  stage_location: 'A' | 'B'
  target_n: number
  tolerance_n: number
  row: number
  col: number
  mean_fz_n: number
  std_fz_n: number
  error_n: number
  signed_error_n: number
  error_ratio: number
  color_bin: string
  pass: boolean
  captured_at: string
}

export interface AggregateRow {
  stage_type: StageType
  n_cells: number
  mae: number | null
  signed_mean_error: number | null
  std_error: number | null
  pass_rate: number | null
}

export interface SaveSessionPayload {
  session: SessionRow
  cells: CellRow[]
  aggregates: AggregateRow[]
}

export interface BuildPayloadInput {
  metadata: SessionMetadata
  stages: StageDefinition[]
  measurements: Map<string, CellMeasurement>
  gridRows: number
  gridCols: number
  appVersion: string
  endedAt: number
  // optional, for deterministic tests
  id?: string
}

function uuid(): string {
  // crypto.randomUUID is available in Node 19+ and browsers; Electron renderer supports it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = globalThis
  if (g.crypto?.randomUUID) return g.crypto.randomUUID()
  // Fallback (unlikely path): simple RFC4122 v4
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function buildSessionPayload(input: BuildPayloadInput): SaveSessionPayload {
  const { metadata, stages, measurements, gridRows, gridCols, appVersion, endedAt } = input
  const id = input.id ?? uuid()

  const stageByIndex = new Map(stages.map((s) => [s.index, s]))
  const cellsArr = Array.from(measurements.values())

  const cells: CellRow[] = cellsArr.map((c) => {
    const stage = stageByIndex.get(c.stageIndex)
    if (!stage) {
      throw new Error(`Measurement references unknown stageIndex ${c.stageIndex}`)
    }
    return {
      stage_index: c.stageIndex,
      stage_name: stage.name,
      stage_type: stage.type,
      stage_location: stage.location,
      target_n: stage.targetN,
      tolerance_n: stage.toleranceN,
      row: c.row,
      col: c.col,
      mean_fz_n: c.meanFzN,
      std_fz_n: c.stdFzN,
      error_n: c.errorN,
      signed_error_n: c.signedErrorN,
      error_ratio: c.errorRatio,
      color_bin: c.colorBin,
      pass: c.pass,
      captured_at: new Date(c.timestamp).toISOString(),
    }
  })

  const aggregates = computeStageTypeAggregates(cellsArr, stageByIndex)
  const overallPass = computeOverallPassRate(cellsArr)

  const session: SessionRow = {
    id,
    started_at: new Date(metadata.startedAt).toISOString(),
    ended_at: new Date(endedAt).toISOString(),
    device_id: metadata.deviceId,
    device_type: metadata.deviceType,
    model_id: metadata.modelId,
    tester_name: metadata.testerName,
    body_weight_n: metadata.bodyWeightN,
    grid_rows: gridRows,
    grid_cols: gridCols,
    n_cells_captured: cellsArr.length,
    n_cells_expected: gridRows * gridCols * 6,
    overall_pass_rate: overallPass,
    app_version: appVersion,
  }

  return { session, cells, aggregates }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/liveTestPayload.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/liveTestPayload.ts src/lib/liveTestPayload.test.ts
git commit -m "feat: buildSessionPayload for live test persistence"
```

---

## Phase 3: Main process

### Task 5: Install `@supabase/supabase-js`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install**

Run: `npm install @supabase/supabase-js`

- [ ] **Step 2: Verify install**

Check `package.json` contains `@supabase/supabase-js` under `dependencies`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @supabase/supabase-js dependency"
```

---

### Task 6: `liveTestQueue.ts` — local file queue

**Files:**
- Create: `electron/liveTestQueue.ts`
- Create: `electron/liveTestQueue.test.ts`

The queue is a pure-filesystem module. No Supabase, no Electron dependencies (take the base dir as a constructor arg so tests can use a temp dir).

- [ ] **Step 1: Write the failing tests**

Create `electron/liveTestQueue.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- electron/liveTestQueue.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `liveTestQueue.ts`**

Create `electron/liveTestQueue.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- electron/liveTestQueue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/liveTestQueue.ts electron/liveTestQueue.test.ts
git commit -m "feat(main): LiveTestQueue for offline-queued session saves"
```

---

### Task 7: `liveTestRepo.ts` — Supabase client wrapper

**Files:**
- Create: `src/lib/liveTestRepoTypes.ts` — shared read-path type definitions
- Create: `electron/liveTestRepo.ts`
- Create: `electron/liveTestRepo.test.ts`

The repo takes a Supabase client as an injected dependency so tests can use a mock. A static factory `LiveTestRepo.fromEnv()` constructs the real one from `SUPABASE_URL` / `SUPABASE_KEY`.

**Shared types:** the read-path types (`SessionListRow`, `SessionDetail`, `OverviewResult`) are needed by both the main process (to return them) and the renderer (to consume them). To avoid having the renderer import from `electron/*` (which the electron-vite build separates), put the types in `src/lib/liveTestRepoTypes.ts` and have both sides import from there.

Integration tests are **env-gated**: they run only when `SUPABASE_TEST_URL` and `SUPABASE_TEST_KEY` are set. Otherwise the describe block is skipped. This keeps CI usable without a test project and lets developers opt in by setting those vars locally.

- [ ] **Step 0: Create the shared types file**

Create `src/lib/liveTestRepoTypes.ts`:

```ts
import type { StageType } from './liveTestTypes'

export interface SessionListRow {
  id: string
  started_at: string
  device_id: string
  tester_name: string
  model_id: string
  n_cells_captured: number
  n_cells_expected: number
  overall_pass_rate: number | null
  device_nickname: string | null
}

export interface SessionDetail {
  session: Record<string, unknown>
  cells: Array<Record<string, unknown>>
  aggregates: Array<Record<string, unknown>>
}

export interface OverviewResult {
  session_count: number
  cells_captured: number
  device_count: number
  overall_pass_rate: number | null
  per_stage_type: Array<{
    stage_type: StageType
    mae: number | null
    signed_mean_error: number | null
    std_error: number | null
    pass_rate: number | null
  }>
}
```

- [ ] **Step 1: Write the failing tests (mocked client)**

Create `electron/liveTestRepo.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
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
```

Note: `afterAll` needs `import { afterAll } from 'vitest'`.

- [ ] **Step 2: Run tests to verify the mocked ones fail**

Run: `npm test -- electron/liveTestRepo.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `liveTestRepo.ts`**

Create `electron/liveTestRepo.ts`:

```ts
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { SaveSessionPayload } from '../src/lib/liveTestPayload'
import type { SessionListRow, SessionDetail, OverviewResult } from '../src/lib/liveTestRepoTypes'

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
    filterDeviceId?: string
    filterTesterName?: string
  }): Promise<SessionListRow[]> {
    let q = this.client
      .from('sessions')
      .select('id, started_at, device_id, tester_name, model_id, n_cells_captured, n_cells_expected, overall_pass_rate, devices(nickname)')
      .order('started_at', { ascending: false })
      .range(opts.offset, opts.offset + opts.limit - 1)
    if (opts.filterDeviceId)   q = q.eq('device_id', opts.filterDeviceId)
    if (opts.filterTesterName) q = q.eq('tester_name', opts.filterTesterName)
    const { data, error } = await q
    if (error) throw new Error(`listSessions failed: ${error.message}`)
    return (data ?? []).map((r: any) => ({
      id: r.id,
      started_at: r.started_at,
      device_id: r.device_id,
      tester_name: r.tester_name,
      model_id: r.model_id,
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
    return {
      session: sessionRes.data as Record<string, unknown>,
      cells: (cellsRes.data ?? []) as Array<Record<string, unknown>>,
      aggregates: (aggRes.data ?? []) as Array<Record<string, unknown>>,
    }
  }

  async getOverview(range: 'all' | '30d' | '7d'): Promise<OverviewResult> {
    const since = range === 'all' ? null
      : range === '30d' ? new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
      : new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()

    let sessQuery = this.client.from('sessions').select('id, device_id, n_cells_captured, overall_pass_rate')
    if (since) sessQuery = sessQuery.gte('started_at', since)
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
      per_stage_type,
    }
  }

  /** Delete all rows with `app_version LIKE 'test-%'`. Used by integration test cleanup. */
  async deleteTestSessions(): Promise<void> {
    const { error } = await this.client.from('sessions').delete().like('app_version', 'test-%')
    if (error) throw new Error(`deleteTestSessions failed: ${error.message}`)
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- electron/liveTestRepo.test.ts`
Expected: PASS for mocked-client tests. Integration tests should be **skipped** (no test env vars set).

- [ ] **Step 5: Commit**

```bash
git add src/lib/liveTestRepoTypes.ts electron/liveTestRepo.ts electron/liveTestRepo.test.ts
git commit -m "feat(main): LiveTestRepo for Supabase reads/writes"
```

---

### Task 8: IPC handlers + preload exposure + wiring in main.ts

**Files:**
- Create: `electron/ipc/liveTest.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Create the IPC handler module**

Create `electron/ipc/liveTest.ts`:

```ts
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

  ipcMain.handle('liveTest:getOverview', async (_e, opts: { range: 'all' | '30d' | '7d' }) => {
    if (!deps.repo) return null
    return deps.repo.getOverview(opts.range)
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
```

- [ ] **Step 2: Wire into main.ts**

Modify `electron/main.ts` — add the imports and calls:

```ts
import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { DynamoManager } from './dynamo'
import { initUpdater } from './updater'
import { createLiveTestDeps, registerLiveTestIpc, runRetryOnStart } from './ipc/liveTest'

let mainWindow: BrowserWindow | null = null
let dynamo: DynamoManager | null = null

function createWindow(): void {
  // ... existing code unchanged ...

  dynamo = new DynamoManager(mainWindow)
  dynamo.start()

  initUpdater(mainWindow)

  ipcMain.removeHandler('app:version')
  ipcMain.handle('app:version', () => app.getVersion())

  // Live test persistence
  const liveTestDeps = createLiveTestDeps()
  registerLiveTestIpc(liveTestDeps)
  // Fire-and-forget retry on start
  runRetryOnStart(liveTestDeps).catch((err) => console.warn('[liveTest] retry failed:', err))
}
```

- [ ] **Step 3: Expose liveTest on preload**

Modify `electron/preload.ts`:

```ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  getDynamoStatus: () => ipcRenderer.invoke('dynamo:status'),
  getDynamoLogs: () => ipcRenderer.invoke('dynamo:get-logs'),
  restartDynamo: () => ipcRenderer.invoke('dynamo:restart'),
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  onDynamoLog: (callback: (log: string) => void) =>
    ipcRenderer.on('dynamo:log', (_event, log) => callback(log)),
  onDynamoStatusChange: (callback: (status: string) => void) =>
    ipcRenderer.on('dynamo:status-change', (_event, status) => callback(status)),
  onUpdateAvailable: (callback: (info: unknown) => void) =>
    ipcRenderer.on('updater:available', (_event, info) => callback(info)),

  // Live test persistence
  liveTest: {
    saveSession: (payload: unknown) => ipcRenderer.invoke('liveTest:saveSession', payload),
    listSessions: (opts: unknown) => ipcRenderer.invoke('liveTest:listSessions', opts),
    getSession: (id: string) => ipcRenderer.invoke('liveTest:getSession', id),
    getOverview: (opts: unknown) => ipcRenderer.invoke('liveTest:getOverview', opts),
    retryQueued: () => ipcRenderer.invoke('liveTest:retryQueued'),
    queueStatus: () => ipcRenderer.invoke('liveTest:queueStatus'),
  },
})
```

- [ ] **Step 4: Extend the existing ElectronAPI type**

The project already declares `ElectronAPI` in `src/global.d.ts`. **Do not create a new file** — modify the existing one:

```ts
import type { SaveSessionPayload } from './lib/liveTestPayload'
import type { SessionListRow, SessionDetail, OverviewResult } from './lib/liveTestRepoTypes'

export interface ElectronLiveTestApi {
  saveSession(payload: SaveSessionPayload): Promise<{ status: 'saved' | 'queued'; id: string; error?: string }>
  listSessions(opts: { limit: number; offset: number; filterDeviceId?: string; filterTesterName?: string }): Promise<SessionListRow[]>
  getSession(id: string): Promise<SessionDetail | null>
  getOverview(opts: { range: 'all' | '30d' | '7d' }): Promise<OverviewResult | null>
  retryQueued(): Promise<{ uploaded: number; stillQueued: number; errors: Array<{ id: string; error: string }> }>
  queueStatus(): Promise<{ queued: number; poison: number }>
}

interface ElectronAPI {
  getDynamoStatus: () => Promise<string>
  getDynamoLogs: () => Promise<string[]>
  restartDynamo: () => Promise<void>
  getAppVersion: () => Promise<string>
  onDynamoLog: (callback: (log: string) => void) => void
  onDynamoStatusChange: (callback: (status: string) => void) => void
  onUpdateAvailable: (callback: (info: unknown) => void) => void
  liveTest: ElectronLiveTestApi
}

interface Window {
  electronAPI?: ElectronAPI
}
```

Note: because `src/global.d.ts` now uses `import` it becomes a module rather than an ambient script. If the existing file was an ambient script that relied on implicit global merge behavior, switching to module form may break callsites that used `ElectronAPI` as a global type. In that case, use `declare global { interface ElectronAPI { … } }` inside the file, with an `export {}` at the end to keep it a module. Verify by running `npx tsc --noEmit` after the change — if there are "Cannot find name 'ElectronAPI'" errors in renderer code, switch to the `declare global` form.

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev`
Expected: app starts, no errors about IPC handlers. Open devtools console, run `window.electronAPI.liveTest.queueStatus()` → returns `{ queued: 0, poison: 0 }`.

- [ ] **Step 6: Commit**

```bash
git add electron/ipc/liveTest.ts electron/main.ts electron/preload.ts src/global.d.ts
git commit -m "feat(main): IPC handlers + preload for live test persistence"
```

---

## Phase 4: Summary-phase UI wiring

### Task 9: ControlPanel — replace "New Session" on SUMMARY with Complete / Discard

**Files:**
- Modify: `src/pages/fluxlite/ControlPanel.tsx`
- Delete: `src/pages/fluxlite/SummaryView.tsx`

**Why ControlPanel, not SummaryView:** the live-test summary UI is rendered inside `ControlPanel.tsx` via `SummaryBody` (see `ControlPanel.tsx` around line 557) and the persistent action bar (around line 198–213). The standalone `SummaryView.tsx` is **not imported anywhere** and is effectively dead code. The Complete/Discard flow must be wired into the ControlPanel's action bar.

- [ ] **Step 1: Delete the dead SummaryView**

```bash
git rm src/pages/fluxlite/SummaryView.tsx
```

- [ ] **Step 2: Add a save helper hook in ControlPanel**

At the top of `ControlPanel.tsx`, add these imports if not already present:

```tsx
import { useState } from 'react'
import { toast } from 'sonner'
import { buildSessionPayload } from '../../lib/liveTestPayload'
```

- [ ] **Step 3: Replace the action bar for the SUMMARY phase**

In `ControlPanel.tsx`, find the action bar (around lines 198–213). Currently:

```tsx
<button onClick={handleActionBar} …>
  {phase === 'IDLE' && (<><Play size={16} fill="currentColor" /> Start Session</>)}
  {phase === 'SUMMARY' && 'New Session'}
  {phase !== 'IDLE' && phase !== 'SUMMARY' && (<><Square size={14} /> End Session</>)}
</button>
```

Replace it so SUMMARY renders two buttons (Complete + Discard), while IDLE and active phases keep their single-button behavior.

First, add inside the `ControlPanel` component (above the existing `handleActionBar`):

```tsx
const metadata = useLiveTestStore((s) => s.metadata)
const measurements = useLiveTestStore((s) => s.measurements)
const gridRows = useLiveTestStore((s) => s.gridRows)
const gridCols = useLiveTestStore((s) => s.gridCols)
const [saving, setSaving] = useState(false)
const [confirmDiscard, setConfirmDiscard] = useState(false)

const handleComplete = async () => {
  if (!metadata) { toast.error('No session metadata'); return }
  if (!window.electronAPI?.liveTest) { toast.error('Persistence not available'); return }
  setSaving(true)
  try {
    const appVersion = await window.electronAPI.getAppVersion()
    const payload = buildSessionPayload({
      metadata,
      stages,
      measurements,
      gridRows,
      gridCols,
      appVersion: String(appVersion ?? '0.0.0'),
      endedAt: Date.now(),
    })
    const result = await window.electronAPI.liveTest.saveSession(payload)
    if (result.status === 'saved') toast.success('Session saved')
    else toast.warning('Saved locally — will retry')
    setPhase('IDLE')
    setConfirmDiscard(false)
  } catch (err) {
    toast.error(`Save failed: ${(err as Error).message}`)
  } finally {
    setSaving(false)
  }
}

const handleDiscard = () => {
  if (!confirmDiscard) { setConfirmDiscard(true); return }
  setPhase('IDLE')
  setConfirmDiscard(false)
}
```

Then replace the persistent action bar block:

```tsx
<div className="border-t border-border px-4 py-3">
  {phase === 'SUMMARY' ? (
    <div className="flex gap-2">
      <button
        onClick={handleDiscard}
        disabled={saving}
        className="flex-1 px-4 py-3 text-sm font-medium tracking-wide rounded-md bg-transparent border border-border text-muted-foreground hover:bg-white/5 hover:text-foreground transition-colors"
      >
        {confirmDiscard ? 'Click again to confirm' : 'Discard'}
      </button>
      <button
        onClick={handleComplete}
        disabled={saving}
        className="flex-1 px-4 py-3 text-sm font-medium tracking-wide rounded-md bg-primary text-white btn-glow transition-colors disabled:opacity-60"
      >
        {saving ? 'Saving…' : 'Complete'}
      </button>
    </div>
  ) : (
    <button
      onClick={handleActionBar}
      disabled={phase === 'IDLE' && (!metadataValid || connectionState !== 'READY')}
      className={`w-full flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium tracking-wide rounded-md transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
        phase === 'IDLE'
          ? 'bg-primary text-white btn-glow'
          : 'bg-transparent border border-border text-muted-foreground hover:bg-white/5 hover:text-foreground'
      }`}
    >
      {phase === 'IDLE' && (<><Play size={16} fill="currentColor" /> Start Session</>)}
      {phase !== 'IDLE' && (<><Square size={14} /> End Session</>)}
    </button>
  )}
</div>
```

Also update `handleActionBar` so the `phase === 'SUMMARY'` branch is removed (it's no longer reachable — the SUMMARY case renders a different button set):

```tsx
const handleActionBar = () => {
  if (phase === 'IDLE') handleStart()
  else endSession()
}
```

- [ ] **Step 4: Manual test**

Run: `npm run dev`
1. Start a live test, capture some cells, let it reach SUMMARY. The action bar now shows **Discard** and **Complete** side-by-side.
2. Click **Discard** → label changes to "Click again to confirm". Click again → resets to IDLE. No DB write.
3. Start another, click **Complete** → button shows "Saving…", toast "Session saved", resets to IDLE. Verify a row appears in `sessions` via the Supabase dashboard.
4. If Supabase is unconfigured or offline, the toast says "Saved locally — will retry" and the payload appears in `%APPDATA%/FluxDeluxe/livetest-queue/<uuid>.json`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/fluxlite/ControlPanel.tsx
git rm src/pages/fluxlite/SummaryView.tsx
git commit -m "feat(ui): ControlPanel action bar Complete/Discard on SUMMARY, delete dead SummaryView"
```

---

## Phase 5: Dashboard UI

### Task 10: DashboardPage scaffold + FluxLitePage swap

**Files:**
- Create: `src/pages/fluxlite/DashboardPage.tsx` (scaffold)
- Modify: `src/pages/fluxlite/FluxLitePage.tsx`
- Delete: `src/pages/fluxlite/HistoryPage.tsx`

Swap the import and delete the old page. Keep the tab id as `'history'` to avoid store churn (documented in the spec).

- [ ] **Step 1: Create the scaffold**

Create `src/pages/fluxlite/DashboardPage.tsx`:

```tsx
export function DashboardPage() {
  return (
    <div className="flex-1 flex flex-col p-4 gap-4 overflow-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Dashboard</h2>
      </div>
      <p className="text-muted-foreground text-sm">
        Overview and recent sessions will appear here.
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Swap import in FluxLitePage**

In `src/pages/fluxlite/FluxLitePage.tsx`, change:

```tsx
import { HistoryPage } from './HistoryPage'
```

to:

```tsx
import { DashboardPage } from './DashboardPage'
```

And change the render:

```tsx
{activeLitePage === 'history' && <DashboardPage />}
```

- [ ] **Step 3: Delete HistoryPage**

Delete `src/pages/fluxlite/HistoryPage.tsx`.

- [ ] **Step 4: Smoke test**

Run: `npm run dev`
Click the **Dashboard** tab → renders the placeholder. No console errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/fluxlite/DashboardPage.tsx src/pages/fluxlite/FluxLitePage.tsx
git rm src/pages/fluxlite/HistoryPage.tsx
git commit -m "feat(ui): DashboardPage scaffold, remove HistoryPage"
```

---

### Task 11: DashboardOverview — top tiles

**Files:**
- Create: `src/pages/fluxlite/DashboardOverview.tsx`
- Modify: `src/pages/fluxlite/DashboardPage.tsx`

- [ ] **Step 1: Implement the component**

Create `src/pages/fluxlite/DashboardOverview.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { OverviewResult } from '../../lib/liveTestRepoTypes'

type Range = 'all' | '30d' | '7d'

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-card border border-border rounded-md p-3">
      <div className="text-muted-foreground text-xs uppercase tracking-wider">{label}</div>
      <div className="text-xl font-semibold text-foreground">{value}</div>
      {sub && <div className="text-muted-foreground text-xs mt-1">{sub}</div>}
    </div>
  )
}

function fmtN(n: number | null | undefined, digits = 1, suffix = 'N'): string {
  if (n === null || n === undefined) return '—'
  return `${n.toFixed(digits)}${suffix}`
}
function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return `${(n * 100).toFixed(1)}%`
}

export function DashboardOverview() {
  const [range, setRange] = useState<Range>('all')
  const [data, setData] = useState<OverviewResult | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.electronAPI.liveTest.getOverview({ range }).then((res) => {
      if (!cancelled) {
        setData(res)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [range])

  const stageTile = (type: 'dumbbell' | 'two_leg' | 'one_leg', label: string) => {
    const r = data?.per_stage_type.find((p) => p.stage_type === type)
    return (
      <div className="bg-card border border-border rounded-md p-3">
        <div className="text-muted-foreground text-xs uppercase tracking-wider">{label}</div>
        <div className="text-lg font-semibold text-foreground">MAE {fmtN(r?.mae ?? null)}</div>
        <div className="text-xs text-muted-foreground mt-1">± {fmtN(r?.std_error ?? null)}</div>
        <div className="text-xs text-muted-foreground">bias {fmtN(r?.signed_mean_error ?? null)}</div>
        <div className="text-xs text-muted-foreground mt-1">pass {fmtPct(r?.pass_rate ?? null)}</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm uppercase tracking-wider text-muted-foreground">Overview</h3>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value as Range)}
          className="bg-background border border-border rounded-md text-sm px-2 py-1 text-foreground"
        >
          <option value="all">All time</option>
          <option value="30d">Last 30 days</option>
          <option value="7d">Last 7 days</option>
        </select>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Tile label="Sessions" value={loading ? '…' : String(data?.session_count ?? 0)} />
        <Tile label="Cells"    value={loading ? '…' : String(data?.cells_captured ?? 0)} />
        <Tile label="Pass rate" value={loading ? '…' : fmtPct(data?.overall_pass_rate ?? null)} />
        <Tile label="Devices"  value={loading ? '…' : String(data?.device_count ?? 0)} />
      </div>

      <h3 className="text-sm uppercase tracking-wider text-muted-foreground mt-2">Accuracy by stage type</h3>
      <div className="grid grid-cols-3 gap-2">
        {stageTile('dumbbell', 'Dumbbell')}
        {stageTile('two_leg',  'Two-leg')}
        {stageTile('one_leg',  'One-leg')}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire into DashboardPage**

Update `src/pages/fluxlite/DashboardPage.tsx`:

```tsx
import { DashboardOverview } from './DashboardOverview'

export function DashboardPage() {
  return (
    <div className="flex-1 flex flex-col p-4 gap-4 overflow-auto">
      <h2 className="text-lg font-semibold">Dashboard</h2>
      <DashboardOverview />
    </div>
  )
}
```

- [ ] **Step 3: Smoke test**

Run: `npm run dev`, open Dashboard. If at least one session exists in Supabase, the tiles populate. If none, tiles show 0 / "—".

- [ ] **Step 4: Commit**

```bash
git add src/pages/fluxlite/DashboardOverview.tsx src/pages/fluxlite/DashboardPage.tsx
git commit -m "feat(ui): DashboardOverview tiles with range picker"
```

---

### Task 12: SessionList — recent sessions table

**Files:**
- Create: `src/pages/fluxlite/SessionList.tsx`
- Modify: `src/pages/fluxlite/DashboardPage.tsx`

- [ ] **Step 1: Implement the component**

Create `src/pages/fluxlite/SessionList.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { SessionListRow } from '../../lib/liveTestRepoTypes'

const PAGE = 50

export function SessionList({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<SessionListRow[]>([])
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.electronAPI.liveTest.listSessions({ limit: PAGE, offset: 0 }).then((r) => {
      if (cancelled) return
      setRows(r)
      setOffset(r.length)
      setDone(r.length < PAGE)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const loadMore = async () => {
    setLoading(true)
    const more = await window.electronAPI.liveTest.listSessions({ limit: PAGE, offset })
    setRows((prev) => [...prev, ...more])
    setOffset(offset + more.length)
    if (more.length < PAGE) setDone(true)
    setLoading(false)
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm uppercase tracking-wider text-muted-foreground">Recent sessions</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b border-border">
            <th className="pb-2 pr-4 text-muted-foreground text-xs uppercase tracking-wider">Date</th>
            <th className="pb-2 pr-4 text-muted-foreground text-xs uppercase tracking-wider">Device</th>
            <th className="pb-2 pr-4 text-muted-foreground text-xs uppercase tracking-wider">Tester</th>
            <th className="pb-2 pr-4 text-muted-foreground text-xs uppercase tracking-wider">Model</th>
            <th className="pb-2 pr-4 text-muted-foreground text-xs uppercase tracking-wider">Pass</th>
            <th className="pb-2 text-muted-foreground text-xs uppercase tracking-wider">Cells</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              onClick={() => onOpen(r.id)}
              className="border-b border-border/50 hover:bg-white/5 transition-colors cursor-pointer"
            >
              <td className="py-2 pr-4 text-muted-foreground">{new Date(r.started_at).toLocaleString()}</td>
              <td className="py-2 pr-4 text-foreground">{r.device_nickname ?? r.device_id}</td>
              <td className="py-2 pr-4 text-muted-foreground">{r.tester_name || '—'}</td>
              <td className="py-2 pr-4 text-muted-foreground">{r.model_id || '—'}</td>
              <td className="py-2 pr-4 text-muted-foreground">
                {r.overall_pass_rate === null ? '—' : `${(r.overall_pass_rate * 100).toFixed(0)}%`}
              </td>
              <td className="py-2 text-muted-foreground">{r.n_cells_captured}/{r.n_cells_expected}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {loading && <p className="text-muted-foreground text-sm">Loading…</p>}
      {!loading && !done && (
        <button onClick={loadMore} className="self-center mt-2 px-3 py-1.5 text-sm border border-border rounded-md hover:bg-white/5">
          Load more
        </button>
      )}
      {!loading && rows.length === 0 && (
        <p className="text-muted-foreground text-sm">No sessions yet.</p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire into DashboardPage**

Update `src/pages/fluxlite/DashboardPage.tsx`:

```tsx
import { useState } from 'react'
import { DashboardOverview } from './DashboardOverview'
import { SessionList } from './SessionList'
import { SessionDetailModal } from './SessionDetailModal'  // stubbed in Task 13

export function DashboardPage() {
  const [openId, setOpenId] = useState<string | null>(null)
  return (
    <div className="flex-1 flex flex-col p-4 gap-6 overflow-auto">
      <h2 className="text-lg font-semibold">Dashboard</h2>
      <DashboardOverview />
      <SessionList onOpen={setOpenId} />
      {openId && <SessionDetailModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}
```

Temporarily stub `SessionDetailModal` in the next task — for now, create an empty component so imports don't fail:

Create `src/pages/fluxlite/SessionDetailModal.tsx`:

```tsx
export function SessionDetailModal({ id: _id, onClose }: { id: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-card border border-border rounded-md p-6" onClick={(e) => e.stopPropagation()}>
        <p className="text-muted-foreground">Session detail — coming next.</p>
        <button onClick={onClose} className="mt-4 px-3 py-1.5 text-sm border border-border rounded-md">Close</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Smoke test**

Run: `npm run dev`. Open Dashboard. Recent sessions list renders (empty or populated). Clicking a row opens the stub modal.

- [ ] **Step 4: Commit**

```bash
git add src/pages/fluxlite/SessionList.tsx src/pages/fluxlite/SessionDetailModal.tsx src/pages/fluxlite/DashboardPage.tsx
git commit -m "feat(ui): SessionList table with pagination and modal stub"
```

---

### Task 13: SessionDetailModal — drill-in

**Files:**
- Modify: `src/pages/fluxlite/SessionDetailModal.tsx`

- [ ] **Step 1: Implement the full modal**

Replace `src/pages/fluxlite/SessionDetailModal.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { SessionDetail } from '../../lib/liveTestRepoTypes'

function fmtN(n: unknown, digits = 1): string {
  if (n === null || n === undefined) return '—'
  const num = typeof n === 'number' ? n : Number(n)
  return Number.isFinite(num) ? num.toFixed(digits) : '—'
}
function fmtPct(n: unknown): string {
  if (n === null || n === undefined) return '—'
  const num = typeof n === 'number' ? n : Number(n)
  return Number.isFinite(num) ? `${(num * 100).toFixed(0)}%` : '—'
}

export function SessionDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    window.electronAPI.liveTest.getSession(id).then((d) => {
      if (!cancelled) {
        setData(d)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [id])

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-md p-6 max-w-4xl w-full max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {loading && <p className="text-muted-foreground">Loading…</p>}
        {!loading && !data && <p className="text-muted-foreground">Session not found.</p>}
        {!loading && data && <SessionDetailBody data={data} onClose={onClose} />}
      </div>
    </div>
  )
}

function SessionDetailBody({ data, onClose }: { data: SessionDetail; onClose: () => void }) {
  const s = data.session as any
  const aggByType = new Map<string, any>()
  for (const a of data.aggregates) aggByType.set((a as any).stage_type, a)

  const cellsByStage = new Map<number, any[]>()
  for (const c of data.cells) {
    const arr = cellsByStage.get((c as any).stage_index) ?? []
    arr.push(c)
    cellsByStage.set((c as any).stage_index, arr)
  }

  return (
    <>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">
            Session • {new Date(s.started_at).toLocaleString()} • {s.device_id} • {s.tester_name || '—'}
          </h3>
          <p className="text-muted-foreground text-sm">
            Model {s.model_id || '—'} • {s.n_cells_captured}/{s.n_cells_expected} cells • pass {fmtPct(s.overall_pass_rate)}
          </p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground px-2">×</button>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        {(['dumbbell', 'two_leg', 'one_leg'] as const).map((t) => {
          const a = aggByType.get(t)
          const label = t === 'dumbbell' ? 'Dumbbell' : t === 'two_leg' ? 'Two-leg' : 'One-leg'
          return (
            <div key={t} className="bg-background border border-border rounded-md p-3">
              <div className="text-xs text-muted-foreground uppercase">{label}</div>
              <div className="text-foreground">MAE {fmtN(a?.mae)}</div>
              <div className="text-xs text-muted-foreground">bias {fmtN(a?.signed_mean_error)}  ± {fmtN(a?.std_error)}</div>
              <div className="text-xs text-muted-foreground">pass {fmtPct(a?.pass_rate)}</div>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[0, 1, 2, 3, 4, 5].map((stageIndex) => {
          const cells = cellsByStage.get(stageIndex) ?? []
          const stageName = cells[0]?.stage_name ?? `Stage ${stageIndex}`
          const stageLoc = cells[0]?.stage_location ?? '—'
          return (
            <div key={stageIndex} className="bg-background border border-border rounded-md p-3">
              <div className="text-xs text-muted-foreground uppercase mb-2">
                Stage {stageIndex} — {stageName} @ {stageLoc}
              </div>
              <CellGrid rows={s.grid_rows} cols={s.grid_cols} cells={cells} />
            </div>
          )
        })}
      </div>
    </>
  )
}

function CellGrid({ rows, cols, cells }: { rows: number; cols: number; cells: any[] }) {
  const byRC = new Map<string, any>()
  for (const c of cells) byRC.set(`${c.row},${c.col}`, c)
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
      {Array.from({ length: rows * cols }).map((_, i) => {
        const r = Math.floor(i / cols)
        const c = i % cols
        const cell = byRC.get(`${r},${c}`)
        const color = cell ? colorFromBin(cell.color_bin) : 'rgb(40,40,40)'
        const title = cell
          ? `err ${fmtN(cell.error_n)}N  (${fmtN(cell.signed_error_n)})  pass ${cell.pass ? 'yes' : 'no'}`
          : 'Not captured'
        return (
          <div
            key={i}
            title={title}
            className="aspect-square rounded-sm flex items-center justify-center text-xs text-white/90"
            style={{ background: color }}
          >
            {cell ? fmtN(cell.error_n, 0) : ''}
          </div>
        )
      })}
    </div>
  )
}

function colorFromBin(bin: string): string {
  switch (bin) {
    case 'green':       return '#2e7d32'
    case 'light_green': return '#558b2f'
    case 'yellow':      return '#f9a825'
    case 'orange':      return '#ef6c00'
    case 'red':         return '#c62828'
    default:            return 'rgb(60,60,60)'
  }
}
```

- [ ] **Step 2: Smoke test**

Run: `npm run dev`. Open Dashboard, click a session row. Modal opens with aggregates and 6 stage grids. Click outside → closes.

- [ ] **Step 3: Commit**

```bash
git add src/pages/fluxlite/SessionDetailModal.tsx
git commit -m "feat(ui): SessionDetailModal with per-stage grids"
```

---

### Task 14: Retry queued uploads button + badge

**Files:**
- Modify: `src/pages/fluxlite/DashboardPage.tsx`

- [ ] **Step 1: Add the queued-retry control**

Add a small header row with a badge + button in the Dashboard. Update `src/pages/fluxlite/DashboardPage.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { DashboardOverview } from './DashboardOverview'
import { SessionList } from './SessionList'
import { SessionDetailModal } from './SessionDetailModal'
import { toast } from 'sonner'

export function DashboardPage() {
  const [openId, setOpenId] = useState<string | null>(null)
  const [queued, setQueued] = useState(0)
  const [poison, setPoison] = useState(0)
  const [retrying, setRetrying] = useState(false)

  const refreshStatus = async () => {
    const s = await window.electronAPI.liveTest.queueStatus()
    setQueued(s.queued)
    setPoison(s.poison)
  }

  useEffect(() => { refreshStatus() }, [])

  const retry = async () => {
    setRetrying(true)
    const result = await window.electronAPI.liveTest.retryQueued()
    await refreshStatus()
    setRetrying(false)
    if (result.uploaded > 0) toast.success(`Uploaded ${result.uploaded} session(s)`)
    if (result.errors.length > 0) toast.warning(`${result.errors.length} still failing — see logs`)
  }

  return (
    <div className="flex-1 flex flex-col p-4 gap-6 overflow-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Dashboard</h2>
        <div className="flex items-center gap-2">
          {queued > 0 && (
            <span className="text-xs text-muted-foreground">
              {queued} queued{poison > 0 ? `, ${poison} failed permanently` : ''}
            </span>
          )}
          <button
            onClick={retry}
            disabled={retrying || queued === 0}
            className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-white/5 disabled:opacity-50"
          >
            {retrying ? 'Retrying…' : 'Retry failed uploads'}
          </button>
        </div>
      </div>
      <DashboardOverview />
      <SessionList onOpen={setOpenId} />
      {openId && <SessionDetailModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}
```

- [ ] **Step 2: Smoke test**

Run: `npm run dev`. With no queued items, the retry button is disabled. Disable network, run a live test, Complete → toast "Saved locally". Return to Dashboard → queued count shows. Reenable network, click **Retry failed uploads** → count drops to 0, session shows up in the list.

- [ ] **Step 3: Commit**

```bash
git add src/pages/fluxlite/DashboardPage.tsx
git commit -m "feat(ui): Dashboard retry failed uploads control"
```

---

## Phase 6: End-to-end verification

### Task 15: Full manual verification + docs update

**Files:**
- (No code changes — verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 2: Run the smoke test plan from the spec (Section 9.3)**

1. Run a live test → click **Complete** → toast "Session saved". Refresh Dashboard. Session row appears.
2. Disconnect network (e.g. airplane mode) → run a live test → Complete → toast "Saved locally — will retry". Check `%APPDATA%/FluxDeluxe/livetest-queue/` (Windows) has a `<uuid>.json` file.
3. Reconnect network, restart app. Queue file should disappear and session appears in Dashboard.
4. Click a session row → modal shows 6 stage grids matching what was captured.
5. Run a partial session (skip some cells) → click **Discard** → confirm → no DB write.

- [ ] **Step 3: Verify Supabase data looks right**

In the Supabase dashboard → Table Editor:
- `devices` — one row per unique device, `last_seen_at` up to date.
- `sessions` — rows in insertion order.
- `session_cells` — ~N captured rows per session, `signed_error_n` has correct sign (negative for under-target, positive for over).
- `session_stage_aggregates` — 3 rows per session, null where `n_cells = 0`.

- [ ] **Step 4: No orphan tasks — close out**

Run: `git status`
Expected: clean working tree (aside from unrelated WIP on this branch).

No commit for this task; it's verification only.

---

## Out of scope (explicitly deferred, not in this plan)

Per spec Section 10 — the following are intentionally not implemented:

- Device nickname editing UI
- Device-health-over-time trend view
- Weighted aggregate averages across sessions
- Per-user auth / RLS
- Raw force-frame persistence
- CSV export
- Making the `electronAPI.liveTest` namespace reusable for future domains (generalize later when a second domain needs it)
