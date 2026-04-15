# Live Test Control Panel — Stepper Redesign

**Date:** 2026-04-15
**Scope:** `src/pages/fluxlite/ControlPanel.tsx` (presentation only — no store, socket, or measurement-engine changes)

## Motivation

Today the right-hand Control Panel swaps out its entire body for each session phase (`IDLE → WARMUP → TARE → TESTING → SUMMARY`). Each phase gets a full-panel takeover, which produces three problems the user has called out:

1. **Visual discontinuity** — you can't see where you are in the overall flow; each phase feels like a separate screen.
2. **Wasted vertical space** — the warmup and tare panels render a large instrument-style card for a single countdown number.
3. **No navigation** — you can't peek back at metadata once the session has started, and stage navigation is hidden behind chevron arrows that only surface one stage at a time.

The redesign replaces the phase-takeover with an **accordion stepper**: five rows always visible, one expanded at a time, inline countdowns, and all six test stages on-screen simultaneously.

## Layout

```
┌─ CONTROL PANEL ────────────────────────────────┐
│ ● PHASE BADGE                                  │  ← unchanged header
├────────────────────────────────────────────────┤
│ ● Meta Data    John D · 800N · 07.abc123   ▸  │  ← row 1 (collapsed)
│ ● Warmup       [━━━━━━░░░░] 14s remaining  ▾  │  ← row 2 (expanded)
│ ○ Tare         pending                     ▸  │  ← row 3 (collapsed)
│ ○ Test         pending                     ▸  │  ← row 4
│ ○ Summary      —                           ▸  │  ← row 5
├────────────────────────────────────────────────┤
│              [ End Session ]                   │  ← persistent action bar
└────────────────────────────────────────────────┘
```

### Row anatomy

Every row has the same shell:

- **Status dot** (left) — `○` pending · `●` active (blue breathing) · `●` complete (green) · `●` error (red)
- **Label** — `Meta Data`, `Warmup`, `Tare`, `Test`, `Summary`
- **Collapsed summary** (right-aligned, one line) — terse status text (see per-row specs below)
- **Chevron** (`▸` collapsed / `▾` expanded)
- **Expanded body** — row-specific UI (below)

The row header is a clickable button that toggles expansion. Clicking a row **does not change `phase`** — it only changes local `expandedRow` UI state. The phase still advances through its existing state machine.

### Accordion behavior

- Exactly one row expanded at a time (strict accordion).
- `expandedRow` is local component state, initialized to the row matching the current `phase`.
- When `phase` changes (auto-advance, e.g. warmup timer completes), `expandedRow` auto-follows to the new phase's row.
- User clicks override auto-follow for the current phase; the next phase change resets to following again.

**Phase → row mapping:**

| Phase | Row |
|---|---|
| `IDLE` | `meta` |
| `WARMUP` | `warmup` |
| `TARE` | `tare` |
| `TESTING` | `test` |
| `STAGE_SWITCH` | `test` |
| `SUMMARY` | `summary` |

## Per-row behavior

### Row 1 — Meta Data

| State | Collapsed summary | Expanded body |
|---|---|---|
| `IDLE`, fields empty | `Fill out metadata to begin` | Plate / Model / Name / Weight inputs (existing grid) |
| `IDLE`, fields valid | `{name} · {weightN}N · {plateId}` | Same inputs, editable |
| Session running (`WARMUP`/`TARE`/`TESTING`/`SUMMARY`) | `{name} · {weightN}N · {plateId}` | Same four rows **read-only** — no inputs, just `telemetry-value` text |

- Status dot: `●` green complete once fields are valid (whether IDLE or running).
- Start button is **not** inside this row — it lives in the persistent action bar.
- No mid-session edits. Meta data locks the moment `startSession` is called.

### Row 2 — Warmup

| Phase state | Collapsed summary | Expanded body |
|---|---|---|
| Not reached (phase ∈ IDLE before start) | `Pending` | Empty state: "Warmup starts after you begin the session" |
| Active, untriggered | `Waiting for load…` | Inline progress bar (`0%`) + "Jump on the plate to begin" copy + `[Skip Warmup]` |
| Active, triggered + running | `{n}s remaining` | Inline progress bar + "Keep jumping — {n}s remaining" + `[Skip Warmup]` |
| Complete | `✓ Complete` | Same inline bar filled 100%, dimmed |

- **Inline progress bar** replaces the existing `panel-inset` countdown card. Full bar width of the row body, `h-1.5`, same warning color.
- `[Skip Warmup]` button remains (secondary style, same as today) — it's the only way to advance phase manually from this row.

### Row 3 — Tare

| Phase state | Collapsed summary | Expanded body |
|---|---|---|
| Not reached | `Pending` | Empty state |
| Active, on plate | `Step off to tare` | Inline progress bar (empty) + current `Fz` readout (`{n}N`, red) + `[Skip & Tare Now]` |
| Active, off plate + counting | `{n}s countdown` | Inline progress bar filling + `Fz` readout (green, below threshold) + `[Skip & Tare Now]` |
| Complete | `✓ Tared` | Same inline bar filled 100%, dimmed |

- Same inline progress bar pattern as Warmup.
- The existing `Force / Countdown` grid card is replaced by a single line: `Fz: 4.2N   ·   Countdown: 12s`.

### Row 4 — Test

The most complex row. Expanded body has three sections stacked vertically:

**A. Stage grid (2×3)**

```
          Dumbbell          Two Leg           One Leg
LOC A   ┌─────────┐       ┌─────────┐       ┌─────────┐
        │ DB·A  ✓ │       │ 2L·A  ● │       │ 1L·A    │
        │ 15/15 done │    │ 8/15 done │     │ 0/15 done │
        │ 13/15 pass │    │ 6/8  pass │     │    —     │
        └─────────┘       └─────────┘       └─────────┘
LOC B   ┌─────────┐       ┌─────────┐       ┌─────────┐
        │ DB·B    │       │ 2L·B    │       │ 1L·B    │
        │ 0/15 done │     │ 0/15 done │     │ 0/15 done │
        │    —     │      │    —     │      │    —     │
        └─────────┘       └─────────┘       └─────────┘
```

Each cell displays:
- Stage short label (e.g. `DB·A`, `2L·B`, `1L·A`)
- Status dot in top-right: `✓` complete · `●` active (breathing) · nothing when pending
- `{tested}/{totalCells} done` — how many cells have been measured out of the grid total for this device type
- `{passed}/{tested} pass` — how many of the tested cells passed (shown as `—` when `tested === 0`)

Click behavior:
- Clicking any cell sets `activeStageIndex` via `setActiveStage(stage.index)`.
- Currently-active cell has a blue border (`border-primary`) + subtle glow.
- Replaces the current chevron-left / chevron-right stage navigation entirely.

Total cells per stage = `gridRows * gridCols` (read from `useLiveTestStore`). Tested and passed counts derived from `measurements` Map filtered by `stageIndex`.

**B. Active stage detail**

One-line summary of the currently-active stage:

```
Active: A · Two Leg    Target 800N ± 12N    8/15 cells
```

No separate card — just an inline row of labeled values.

**C. Measurement status**

The existing measurement status (`Waiting for load…` / `Arming…` / `Measuring…` / `Captured!`) — kept as a single-line indicator with the colored dot, cell coordinate, and thin progress bar underneath when arming or measuring. This is the only `panel-inset` element that survives — it's genuinely instrumentation readout.

**Collapsed summary (when another row is expanded):**

| Phase state | Summary |
|---|---|
| Not reached | `Pending` |
| Active | `{stagesStartedCount}/6 stages · {totalTested}/{totalCells} cells tested` |
| All complete | `✓ All stages complete` |

`stagesStartedCount` is derived — count distinct `stageIndex` values in the `measurements` map that have at least one entry. No new store field.

### Row 5 — Summary

| Phase state | Collapsed summary | Expanded body |
|---|---|---|
| Not reached | `—` | Empty state |
| `SUMMARY` | `{totalTested} tested · {totalPassed} passing` | Existing SummaryPanel content: overall Tested/Passed/Total grid + per-stage breakdown |

## Persistent action bar

A single row pinned to the bottom of the panel, always present, containing one button whose identity follows phase:

| Phase | Button | Style | Disabled when |
|---|---|---|---|
| `IDLE` | `Start Session` | primary | metadata invalid or `connectionState !== 'READY'` |
| `WARMUP` / `TARE` / `TESTING` / `STAGE_SWITCH` | `End Session` | muted/secondary border (not destructive red) | never |
| `SUMMARY` | `New Session` | primary | never |

This replaces the per-panel buttons that exist today inside the IDLE form, the TESTING panel, and the SUMMARY panel.

## Component structure

Inside the existing `ControlPanel` component:

```
ControlPanel
├── PhaseBadge (unchanged)
├── StepperRow "Meta Data"       ← new generic StepperRow component
│   └── MetaDataBody (expanded / editable / read-only)
├── StepperRow "Warmup"
│   └── WarmupBody (inline progress + skip)
├── StepperRow "Tare"
│   └── TareBody (inline progress + force readout + skip)
├── StepperRow "Test"
│   └── TestBody
│       ├── StageGrid (2×3 stage cards)
│       ├── ActiveStageLine
│       └── MeasurementStatus (kept)
├── StepperRow "Summary"
│   └── SummaryBody (existing SummaryPanel content)
└── ActionBar (Start / End / New)
```

`StepperRow` is a small presentational component: `{ label, status, summary, expanded, onToggle, children }`. It renders the header row with status dot + label + summary + chevron, and the collapsed/expanded body.

## State

All new state is local to `ControlPanel`:

```ts
const [expandedRow, setExpandedRow] = useState<'meta' | 'warmup' | 'tare' | 'test' | 'summary'>(
  () => rowForPhase(phase)
)

useEffect(() => { setExpandedRow(rowForPhase(phase)) }, [phase])
```

Status per row (`pending` | `active` | `complete`) is derived from `phase`, not stored. No changes to any Zustand store, socket listener, measurement engine, or session metadata shape.

## What is explicitly NOT changing

- All phase-transition logic (warmup trigger, tare countdown, stage-switch handoff).
- `liveTestStore`, `liveDataStore`, `deviceStore`, `uiStore` — no state or action changes.
- Socket events, measurement engine, session metadata type.
- Main visualization area (PlateCanvas, ForcePlot, ForceGauges, MomentsStrip, TempGauge, DeviceList).
- Existing Skip Warmup and Skip & Tare Now buttons — same text, same behavior, just rendered inside their row bodies.
- Color palette — the surface-contrast question the user originally raised is expected to resolve via the new row-dense structure (status dots, dividers, inline progress bars) rather than a palette change. If the panel still feels muddy after this refactor, that's a follow-up.

## Files changed

| File | Change |
|---|---|
| `src/pages/fluxlite/ControlPanel.tsx` | Complete refactor of the component body. The `IdlePanel`, `WarmupPanel`, `TarePanel`, `TestingPanel`, `SummaryPanel` sub-components collapse into row-body components with the same underlying logic. `Section` helper is replaced by `StepperRow`. |

No other files touched.

## Open questions / risks

- **Narrow panel width.** The 2×3 stage grid will be tight if the panel gets narrower than ~280px. If we see clipping, the grid can fall back to a 1-column list at narrow widths via a CSS grid breakpoint. Not solving upfront — validate during implementation.
- **Hardcoded 2×3 shape.** The stage grid assumes exactly 6 stages structured as 3 types × 2 locations, matching `STAGE_TEMPLATES` today. If the template ever changes (more stage types, more locations, different counts), the grid layout will need to adapt. Acceptable now since `STAGE_TEMPLATES` is stable; flag if it changes.
- **"Breathing" status dot.** The existing `.status-live` class animates opacity. We'll reuse it on active row dots to maintain consistency with the phase badge and active device LED.
- **`completed` detection for Warmup/Tare.** Neither the store nor phase distinguishes "warmup ran to completion" from "warmup was skipped." Both end up as `phase === TARE`. For the status dot, treat "phase has passed this row" as complete regardless of skip. No new state needed.
