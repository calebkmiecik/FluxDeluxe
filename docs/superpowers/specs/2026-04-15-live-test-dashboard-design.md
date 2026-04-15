# Live Test Dashboard & Persistence — Design

**Status:** Draft
**Date:** 2026-04-15
**Scope:** Persist completed live test sessions to Supabase and build a Dashboard tab that surfaces aggregate accuracy metrics and a history of recent sessions.

---

## 1. Problem

The live test flow (measurement engine, 6 stages, per-cell captures) currently exists entirely in-memory in the renderer's Zustand store. When a session ends, all data is lost. Users want:

1. A **Dashboard** tab that shows aggregate rollup metrics (MAE, signed mean error, std error, pass rate) broken down by stage type (dumbbell / two-leg / one-leg).
2. A **session list** of recent live tests with drill-in to per-cell results.
3. Enough persisted detail per cell to reconstruct each cell's result for a session.

Device-health-over-time trends are explicitly **out of scope** for this iteration — insufficient data exists today. The schema will not preclude them.

## 2. Non-goals

- No raw force-frame CSVs are persisted. Only the engine's final `CellMeasurement` output plus session metadata.
- No auth / multi-tenancy. Internal tool, shared visibility.
- No device-over-time trend analysis (deferred).
- No editing of saved sessions or metadata after the fact.
- No incremental in-session writes. Saves happen only at session completion.

## 3. Architecture

Renderer never talks to Supabase. Supabase service key stays in the Electron main process. All writes and reads flow through a narrow IPC surface.

```
┌──────────────────┐       IPC         ┌─────────────────────┐       HTTPS       ┌──────────┐
│   Renderer       │ ───────────────►  │   Main process      │ ───────────────►  │ Supabase │
│ (React + stores) │                   │ (liveTestRepo.ts +  │                   │ (Postgres│
│                  │ ◄───────────────  │  local queue)       │ ◄───────────────  │  + REST) │
└──────────────────┘                   └─────────────────────┘                   └──────────┘
```

### 3.1 IPC surface

Exposed on `window.electronAPI.liveTest` via `contextBridge` from the existing preload script. Nested under the existing `electronAPI` namespace to follow the pattern already used for `dynamo`, `updater`, and `app` methods.

| Method | Purpose |
|---|---|
| `saveSession(payload)` | Persist one completed session. On network failure, queue locally. Returns `{ status: 'saved' \| 'queued', id }`. |
| `listSessions({ limit, offset, filter })` | Paginated session list for the Dashboard. Filter supports `device_id` and `tester_name`. |
| `getSession(id)` | Session row + all cells + 3 aggregate rows for drill-in. |
| `getOverview({ range })` | Rollup tiles: total counts + per-stage-type aggregates for the selected time range. `range: 'all' \| '30d' \| '7d'`. |
| `retryQueued()` | Flush local queue. Called on app start and from Dashboard "Retry failed uploads" button. Returns `{ uploaded, stillQueued, errors }`. |
| `queueStatus()` | Returns `{ queued: number, poison: number }` for Dashboard badge. |

### 3.2 Main-process modules

- `electron/liveTestRepo.ts` — Supabase client wrapper. Implements all DB operations. Uses `@supabase/supabase-js` with the service key from `.env`.
- `electron/liveTestQueue.ts` — Local file queue. Stores queued payloads as JSON files in `app.getPath('userData')/livetest-queue/<id>.json`. Poison folder at `livetest-queue/poison/`.
- `electron/ipc/liveTest.ts` — IPC handler registration. Thin wrappers around the repo/queue modules.
- `electron/preload.ts` — Exposes `liveTestApi` to the renderer.

### 3.3 Client library

`@supabase/supabase-js` (added as a dependency). Handles REST, bulk inserts, and RPC calls cleanly.

### 3.4 Atomicity

All four writes per session (upsert device, insert session, bulk insert cells, insert aggregates) are wrapped in a Postgres RPC function `save_live_session(payload jsonb)` so they commit atomically. No half-saved sessions.

## 4. Schema

Four tables. UUID ids, all timestamps `timestamptz`. DDL lives in a Supabase migration (`supabase/migrations/<timestamp>_live_test.sql` — layout matches the existing Supabase project's convention once we inspect it).

### 4.1 `devices`

The one long-lived entity. Upserted on session save so new devices appear automatically.

| Column | Type | Notes |
|---|---|---|
| `device_id` | `text` PK | e.g. `"AXF-07-0123"` — matches `SessionMetadata.deviceId` |
| `device_type` | `text` | e.g. `"07"` — hardware family |
| `nickname` | `text` null | optional friendly name, editable later via UI (not in this iteration) |
| `first_seen_at` | `timestamptz` | set on first session |
| `last_seen_at` | `timestamptz` | updated on every session |

### 4.2 `sessions`

One row per completed live test.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | **client-generated** in main before insert — makes queue idempotent |
| `started_at` | `timestamptz` | from `SessionMetadata.startedAt` |
| `ended_at` | `timestamptz` | wall clock at save time |
| `device_id` | `text` FK → `devices.device_id` | |
| `device_type` | `text` | denormalized (survives future device renames) |
| `model_id` | `text` | free-form string for now |
| `tester_name` | `text` | free-form string |
| `body_weight_n` | `numeric` | |
| `grid_rows` | `int` | |
| `grid_cols` | `int` | |
| `n_cells_captured` | `int` | total across all stages |
| `n_cells_expected` | `int` | `grid_rows * grid_cols * 6` |
| `overall_pass_rate` | `numeric` | captured cells with `pass = true` / captured, `null` if 0 captured |
| `app_version` | `text` | from `package.json` — useful when debugging regressions |

Index: `(started_at DESC)` for the session list.

### 4.3 `session_cells`

One row per captured cell. Source of truth — aggregates are recomputable from this.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `session_id` | `uuid` FK → `sessions(id)` ON DELETE CASCADE | |
| `stage_index` | `int` | 0..5 |
| `stage_name` | `text` | denormalized (e.g. `"45 lb Dumbbell"`) |
| `stage_type` | `text` | `'dumbbell' \| 'two_leg' \| 'one_leg'` — grouping key |
| `stage_location` | `text` | `'A' \| 'B'` |
| `target_n` | `numeric` | |
| `tolerance_n` | `numeric` | |
| `row` | `int` | |
| `col` | `int` | |
| `mean_fz_n` | `numeric` | |
| `std_fz_n` | `numeric` | |
| `error_n` | `numeric` | `abs(mean_fz - target)` |
| `signed_error_n` | `numeric` | `mean_fz - target` (**new field**; not in `CellMeasurement` today) |
| `error_ratio` | `numeric` | `error_n / tolerance_n` |
| `color_bin` | `text` | |
| `pass` | `bool` | |
| `captured_at` | `timestamptz` | |

Indexes: `(session_id)`, `(session_id, stage_type)`.

**Engine change required:** `MeasurementEngine.captureCell` and the `CellMeasurement` type (in `src/lib/liveTestTypes.ts` and `src/lib/measurementEngine.ts`) will be updated to also compute and store `signedErrorN = meanFz - stage.targetN`. The existing `errorN` keeps its magnitude-only semantics (UI already uses it).

### 4.4 `session_stage_aggregates`

Precomputed at save time. 3 rows per session (one per `stage_type`).

| Column | Type | Notes |
|---|---|---|
| `session_id` | `uuid` FK → `sessions(id)` ON DELETE CASCADE | |
| `stage_type` | `text` | `dumbbell` / `two_leg` / `one_leg` |
| `n_cells` | `int` | captured cells of this type |
| `mae` | `numeric` null | mean absolute error; null if `n_cells = 0` |
| `signed_mean_error` | `numeric` null | mean signed error (directional bias) |
| `std_error` | `numeric` null | std of signed errors across cells |
| `pass_rate` | `numeric` null | pass count / n_cells |

Primary key: `(session_id, stage_type)`.

Rows are written even when `n_cells = 0` (all metrics null) so the Dashboard can render "—" consistently. This keeps the "did the user skip 1-leg?" answer in one query.

## 5. Data flow

### 5.1 Save (user clicks Complete on SummaryView)

1. Renderer builds a `SaveSessionPayload` via `buildSessionPayload(storeState)` in `src/lib/liveTestPayload.ts`:
   - Client-generated UUID for `session.id`.
   - `ended_at = Date.now()`.
   - Per-stage-type aggregates computed from the cells (pure function, also unit-tested).
2. Renderer calls `window.electronAPI.liveTest.saveSession(payload)`, shows a "Saving…" state on the button.
3. Main process:
   - **First**, writes the payload to `livetest-queue/<id>.json`. This ensures a crash during upload still leaves the file on disk.
   - Calls `save_live_session(payload)` RPC on Supabase.
   - On success: deletes the queue file, returns `{ status: 'saved', id }`.
   - On failure: leaves the queue file, returns `{ status: 'queued', id, error }`.
4. Renderer:
   - `saved` → toast "Session saved", reset store to `IDLE`.
   - `queued` → toast "Network issue — saved locally, will retry", reset store to `IDLE`.

### 5.2 Discard (user clicks Discard on SummaryView)

Reset store to `IDLE`. No save, no queue, no DB write. Confirmation dialog before reset.

### 5.3 Retry queued

- On app start: main scans `livetest-queue/*.json`, attempts each sequentially. Each file's name is the session UUID; the RPC uses `ON CONFLICT (id) DO NOTHING` on the sessions insert, so an acknowledged-but-retried upload is a no-op.
- Manual: Dashboard "Retry failed uploads" button calls `retryQueued()`.
- After 3 consecutive failed attempts on the same file, move it to `livetest-queue/poison/` and surface in the Dashboard with the last error message. Stops infinite retry loops on 4xx errors (schema drift, bad payload).

### 5.4 Read (Dashboard)

- **Overview tiles:** `getOverview({ range })` — aggregates across selected sessions' `session_stage_aggregates` rows. Uses average-of-averages for MAE and signed mean error; this is a weak statistic when sessions have varying `n_cells` but matches what the user sees per-session and avoids joining back to `session_cells`. If this proves misleading we can switch to weighted averages in a later iteration (pure view change, no schema impact).
- **Session list:** `listSessions({ limit, offset, filter })` — paginated `sessions` left-joined to `devices` for nickname. Ordered by `started_at DESC`. Default page size 50.
- **Session detail:** `getSession(id)` — returns session + cells + aggregates. Drill-in modal reconstructs the 6-stage grid from cells.

### 5.5 Payload shape (IPC)

```ts
interface SaveSessionPayload {
  session: {
    id: string           // uuid, client-generated
    started_at: string   // ISO
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
  cells: Array<{
    stage_index: number
    stage_name: string
    stage_type: 'dumbbell' | 'two_leg' | 'one_leg'
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
  }>
  aggregates: Array<{
    stage_type: 'dumbbell' | 'two_leg' | 'one_leg'
    n_cells: number
    mae: number | null
    signed_mean_error: number | null
    std_error: number | null
    pass_rate: number | null
  }>
}
```

## 6. Dashboard UI

Layout (desktop-first, single scrollable column inside the existing Dashboard tab; replaces the current `HistoryPage` at the `activeLitePage === 'history'` slot — keeping the `'history'` id to avoid store churn):

```
┌──────────────────────────────────────────────────────────────┐
│ Dashboard                                  [Range: All  ▼]   │
├──────────────────────────────────────────────────────────────┤
│ ┌─────────────┬─────────────┬─────────────┬─────────────┐    │
│ │  Sessions   │   Cells     │  Pass rate  │  Devices    │    │
│ │    142      │   4,823     │    87.3%    │      6      │    │
│ └─────────────┴─────────────┴─────────────┴─────────────┘    │
├──────────────────────────────────────────────────────────────┤
│  Accuracy by stage type                                      │
│ ┌────────────┬────────────┬────────────┐                     │
│ │ Dumbbell   │ Two-leg    │ One-leg    │                     │
│ │ MAE 4.2N   │ MAE 8.1N   │ MAE 11.3N  │                     │
│ │ ± 1.8N     │ ± 3.4N     │ ± 5.2N     │                     │
│ │ bias −0.3N │ bias +1.1N │ bias −0.7N │                     │
│ │ pass 94%   │ pass 88%   │ pass 79%   │                     │
│ └────────────┴────────────┴────────────┘                     │
├──────────────────────────────────────────────────────────────┤
│  Recent sessions           [Filter: device ▼] [tester ▼]  ↻  │
│ ┌────────────────────────────────────────────────────────┐   │
│ │ Date       Device      Tester    Model   Pass  Cells  │   │
│ │ 04-15 14:32  AXF-07-0123  caleb    v2.1    89%   54/54│   │
│ │ 04-15 13:10  AXF-11-0045  jane     v2.0    76%   48/54│   │
│ │ 04-14 16:45  AXF-07-0123  caleb    v2.1    94%   54/54│   │
│ └────────────────────────────────────────────────────────┘   │
│              [Load more]                                     │
└──────────────────────────────────────────────────────────────┘
```

Drill-in modal:

```
┌──────────────────────────────────────────────────────────────┐
│ Session • 2026-04-15 14:32 • AXF-07-0123 • caleb      [×]    │
├──────────────────────────────────────────────────────────────┤
│ Summary   MAE 5.1N  bias −0.2N  pass 89%                     │
│ By stage: DB 4.2N / 2L 8.1N / 1L 11.3N                       │
├──────────────────────────────────────────────────────────────┤
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐             │
│  │ Stage 0     │ │ Stage 1     │ │ Stage 2     │             │
│  │ DB @ A      │ │ 2L @ A      │ │ 1L @ A      │             │
│  │ [3×3 grid]  │ │ [3×3 grid]  │ │ [3×3 grid]  │             │
│  └─────────────┘ └─────────────┘ └─────────────┘             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐             │
│  │ Stage 3     │ │ Stage 4     │ │ Stage 5     │             │
│  │ DB @ B      │ │ 2L @ B      │ │ 1L @ B      │             │
│  └─────────────┘ └─────────────┘ └─────────────┘             │
└──────────────────────────────────────────────────────────────┘
```

New components:

- `src/pages/fluxlite/DashboardPage.tsx` — replaces `HistoryPage` at the same slot.
- `src/pages/fluxlite/DashboardOverview.tsx` — tiles.
- `src/pages/fluxlite/SessionList.tsx` — paginated list.
- `src/pages/fluxlite/SessionDetailModal.tsx` — drill-in.

Existing `HistoryPage.tsx` is removed.

### SummaryView changes

`src/pages/fluxlite/SummaryView.tsx` changes from **Test Again / Done** to **Complete / Discard**:

- **Complete** — calls `saveSession`, shows saving state, resets to IDLE on success.
- **Discard** — confirmation dialog, resets to IDLE without saving.

## 7. Error handling

| Failure | Behavior |
|---|---|
| Network down at save | Queue file written first, upload fails, toast "Saved locally — will retry" |
| Supabase 5xx | Same — queue and retry |
| Supabase 4xx (schema drift, bad payload) | Queue with retry cap (3 attempts) → move to poison folder, surface in Dashboard |
| Partial RPC failure | Transaction inside RPC — all or nothing |
| Corrupt queue file | Move to poison folder, log |
| App crash mid-session | Session lost (by design; save only on Complete) |
| App crash between queue-write and upload | Next app start's `retryQueued()` finds the file and uploads |
| Duplicate save | UUID + `ON CONFLICT (id) DO NOTHING` — idempotent |

## 8. Edge cases

- **0 cells captured for a stage type** — aggregate row inserted with nulls; Dashboard renders "—".
- **Incomplete session** (user saved with some cells missing) — allowed; session list shows `n_cells_captured/n_cells_expected` (e.g. "48/54").
- **Schema evolution** — new columns must be nullable; no destructive migrations without a migration plan.
- **Clock skew** — `started_at` is the device's wall clock. Fine for ordering within a machine; do not use for strict cross-machine ordering.
- **Service key presence** — `SUPABASE_URL` / `SUPABASE_KEY` are read from `.env` by main only. If missing at app start, `saveSession` returns `{ status: 'queued' }` with a "Supabase not configured" error, which surfaces in the Dashboard retry panel. App remains usable.

## 9. Testing

### 9.1 Unit (vitest, renderer)

- `src/lib/liveTestPayload.test.ts` — `buildSessionPayload()` from a fake store state: correct UUID shape, correct counts, `signed_error_n` sign preserved, correct aggregate math (MAE, signed mean, std), 0-cell stage-type case.
- `src/lib/liveTestAggregates.test.ts` — pure aggregate functions isolated.
- Existing `src/__tests__/uiStore.test.ts` updated for any renamed tab ids (no rename planned; `'history'` id stays).

### 9.2 Integration (main)

- `electron/liveTestRepo.test.ts` — against a dedicated Supabase test project. Tests end-to-end save + read back. Cleanup step deletes rows with `app_version LIKE 'test-%'`.
- `electron/liveTestQueue.test.ts` — queue file lifecycle with a mocked supabase client: queue-on-failure, delete-on-success, poison-after-N-retries.

### 9.3 Manual smoke

1. Run a live test → Complete → appears in Dashboard.
2. Disable network, run a live test → Complete → toast says queued, file present in `livetest-queue/`.
3. Re-enable network, restart app → queued file uploads and disappears; session appears in Dashboard.
4. Open a session detail → grid matches captured data.
5. Discard path: run a partial test → Discard → no DB write.

### 9.4 Not tested

- Exhaustive Dashboard UI rendering. A few sanity tests (tile shows correct number, row renders correct session) but not comprehensive UI coverage — matches existing repo convention for the Electron rewrite.

## 10. Out of scope (future work)

- Editing device nicknames in the Dashboard.
- Device-health-over-time view (requires more data).
- Weighted aggregate averages across sessions (currently average-of-averages).
- Per-user auth and RLS.
- Raw force-frame persistence for post-hoc analysis.
- CSV export of sessions.

## 11. File manifest

New:
- `electron/liveTestRepo.ts`
- `electron/liveTestQueue.ts`
- `electron/ipc/liveTest.ts`
- `src/lib/liveTestPayload.ts`
- `src/lib/liveTestAggregates.ts`
- `src/pages/fluxlite/DashboardPage.tsx`
- `src/pages/fluxlite/DashboardOverview.tsx`
- `src/pages/fluxlite/SessionList.tsx`
- `src/pages/fluxlite/SessionDetailModal.tsx`
- `supabase/migrations/<timestamp>_live_test.sql` — the DDL + `save_live_session` RPC
- Tests per section 9.

Modified:
- `src/lib/liveTestTypes.ts` — add `signedErrorN` to `CellMeasurement`.
- `src/lib/measurementEngine.ts` — compute `signedErrorN`.
- `src/pages/fluxlite/SummaryView.tsx` — Complete / Discard buttons; wire save. Note: adds a `useLiveTestStore` dependency (session metadata + stages + measurements live there, not in `useSessionStore`) to feed `buildSessionPayload`.
- `src/pages/fluxlite/FluxLitePage.tsx` — swap `HistoryPage` import for `DashboardPage`.
- `electron/main.ts` — register IPC handlers under `liveTest:*`, run `retryQueued()` on start.
- `electron/preload.ts` — extend the existing `electronAPI` object with a `liveTest: { saveSession, listSessions, getSession, getOverview, retryQueued, queueStatus }` sub-object.
- `package.json` — add `@supabase/supabase-js`.

Removed:
- `src/pages/fluxlite/HistoryPage.tsx`
