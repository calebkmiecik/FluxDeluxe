# FluxDeluxe UI Polish — Design Spec

## Overview

Apply Axioforce brand identity and visual polish to the FluxDeluxe Electron + React app. Transform the current skeleton UI into a cohesive, professional interface with aerospace-inspired visual language.

### Scope

- Rebrand color palette, typography, and spacing across all existing components
- Redesign sidebar from hover-expand to fixed narrow with labels
- Apply aerospace visual language (angled accents, telemetry-style readouts, directional glow)
- Context-adaptive density (spacious for launcher/idle, dense for live testing)
- No new features — polish only

### Out of scope

- Live testing flow redesign (separate effort)
- New pages or features
- MBF Acorne font integration (logo usage only, deferred)

---

## Brand Palette

### Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-background` | `#232323` | App background |
| `--color-surface` | `#2D2D2D` | Cards, panels, elevated surfaces |
| `--color-surface-dark` | `#1E1E1E` | Sidebar, deeply recessed areas |
| `--color-border` | `#3A3A3A` | Default borders, dividers |
| `--color-border-accent` | `#0051BA` | Active states, accent dividers |
| `--color-text` | `#CECECE` | Primary text |
| `--color-text-muted` | `#8E9FBC` | Secondary text, labels, placeholders |
| `--color-primary` | `#0051BA` | Buttons, active nav, links |
| `--color-primary-hover` | `#0063E0` | Button hover state |
| `--color-accent` | `#8E9FBC` | Selected states, secondary emphasis, icon tints |
| `--color-success` | `#00C853` | Healthy status, pass indicators |
| `--color-warning` | `#FFC107` | Caution, warmup states |
| `--color-danger` | `#FF5252` | Errors, stop buttons, fail indicators |

### Typography

- **Font family**: `'Geist Variable', system-ui, sans-serif` for all UI text
- **Logo font**: MBF Acorne (deferred — not used in this pass)
- **Scale**: 24px page titles, 16px section headers, 14px body, 12px labels/captions
- **Weights**: 400 (body), 500 (labels/emphasis), 600 (headings), 700 (page titles)
- **Letter-spacing**: `-0.01em` on headings for tighter, technical feel
- **Monospace**: `'Geist Mono', monospace` for data values, readouts, device IDs

### Spacing

4px base grid: `4 | 8 | 12 | 16 | 24 | 32 | 48`

| Context | Padding | Gap |
|---------|---------|-----|
| Page content | 24px | 16px |
| Cards | 16px | 12px |
| Sidebar items | 8px 12px | 4px |
| Buttons | 8px 16px | — |
| Inputs | 8px 12px | — |
| Dense panels (live) | 8px | 8px |

### Border radius

- Cards/panels: `8px`
- Buttons: `6px`
- Inputs: `6px`
- Small badges/dots: `4px` or `full`
- Modals: `12px`

---

## Sidebar

Fixed width ~160px, always visible with icon + label.

### Structure

```
┌─────────────────┐
│  [icon] FluxLite │  ← Logo mark + app name (top)
│                  │
│  ── divider ──   │
│                  │
│  ⊞  Home         │  ← Nav items
│  ⚡ FluxLite     │
│                  │
│                  │
│                  │
│  ── divider ──   │
│                  │
│  ● 1 device      │  ← Connection status (bottom)
│  ● Backend OK    │
└─────────────────┘
```

### Styling

- Background: `#1E1E1E` (darker than main content)
- Width: `160px` fixed
- Nav items: `14px` text, icon + label on same line
- Active item: `2px` left border in `#0051BA`, background `#0051BA/10`, text `#CECECE`
- Inactive item: text `#8E9FBC`, hover → text `#CECECE` + background `#ffffff/5`
- Dividers: `1px` solid `#3A3A3A`, horizontal, `8px` margin on each side
- Status section: `12px` text, monospace for values, green/yellow/red dots for status

---

## Aerospace Visual Language

Subtle cues throughout — the *feeling* of aerospace, not literal rockets.

### Accent lines

- Thin `1px` accent lines in `#0051BA` used as section dividers on important boundaries
- Example: below the sidebar logo, above the status section, left edge of active nav item

### Card treatment

- Default: `bg-surface`, `border border-border`, `rounded-lg` (8px)
- On important/hero cards: add a subtle top border in `#0051BA` (2px) — like a status bar indicator
- No heavy shadows — use border contrast for elevation

### Data readouts

Status values styled as telemetry:
```
FORCE
  247.3 N
```
- Label: `12px`, `#8E9FBC`, uppercase, `letter-spacing: 0.05em`
- Value: `16px`, `Geist Mono`, `#CECECE`
- Compact vertical layout, label above value

### Button styles

**Primary**: `bg-primary`, `text-white`, `rounded-md` (6px). Hover: `bg-primary-hover` + subtle `box-shadow: 2px 2px 8px rgba(0, 81, 186, 0.3)` (directional glow, light comes from top-left).

**Secondary/ghost**: `bg-transparent`, `border border-border`, `text-text-muted`. Hover: `bg-white/5`, `text-text`.

**Danger**: `bg-danger`, `text-white`. Hover: brighter + glow.

### Status indicators

- Connection dots: `8px` circles, `bg-success` / `bg-warning` / `bg-danger`
- Active session: pulsing dot animation (CSS `animate-pulse`)
- Phase labels: uppercase, `12px`, monospace, `letter-spacing: 0.05em`

---

## Component-Specific Polish

### Launcher page

- Spacious layout, centered content
- FluxLite icon SVG displayed large (96px) in the tool card
- Tool card: `bg-surface`, hover lifts with subtle shadow + `border-primary/30`
- "FluxDeluxe" title in `24px`, `font-weight: 700`
- Subtitle in `#8E9FBC`

### Idle view (FluxLite home)

- "Start Testing" card with `#0051BA` top border accent
- Device count shown as telemetry readout
- "Begin Session" button is primary blue, prominent
- Recent tests section: clean table or card list with muted styling

### Gate views (Warmup / Tare)

- Centered card, `max-w-md`
- Phase name as uppercase label above the card
- Progress or status indicator
- Single action button, primary blue

### Live view

- Dense layout, minimal chrome
- Phase indicator bar: dark background, monospace phase label, colored dot
- Control buttons (Stop, Cancel) compact, right-aligned
- Canvas areas get the full remaining space — no unnecessary padding

### Summary view

- Card centered, `max-w-lg`
- Metrics section uses telemetry readout style
- Action buttons: "Test Again" (secondary), "Done" (primary)

### Toast notifications

- Bottom-right, `max-w-sm`
- Left border accent colored by type (success=green, error=red, warning=amber, info=blue)
- Background: `#2D2D2D` with slight transparency
- Auto-dismiss 5s, click to dismiss

### Device picker dialog

- Modal overlay with `bg-black/60` backdrop
- Card: `bg-surface`, `rounded-xl` (12px), subtle shadow
- Device items: clickable rows with status dot, hover highlight

### Model packager dialog

- Same modal treatment as device picker
- Form inputs: `bg-background`, `border border-border`, `rounded-md`
- Labels: `12px`, `#8E9FBC`, above inputs

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/index.css` | Replace `@theme` color tokens with new palette |
| `src/components/shared/Sidebar.tsx` | Rewrite: fixed 160px, icon+label, accent borders, logo |
| `src/components/shared/Toast.tsx` | Update colors, add border accent |
| `src/components/shared/DevicePicker.tsx` | Modal styling, device row polish |
| `src/pages/Launcher.tsx` | Spacious layout, icon integration, card hover |
| `src/pages/fluxlite/FluxLitePage.tsx` | Tab styling update |
| `src/pages/fluxlite/IdleView.tsx` | Telemetry readouts, card accents |
| `src/pages/fluxlite/GateView.tsx` | Centered card polish, phase labels |
| `src/pages/fluxlite/LiveView.tsx` | Dense layout, phase bar polish |
| `src/pages/fluxlite/SummaryView.tsx` | Card polish, telemetry metrics style |
| `src/pages/fluxlite/ModelsPage.tsx` | Card list styling |
| `src/pages/fluxlite/ModelPackager.tsx` | Modal/form styling |
| `src/pages/fluxlite/HistoryPage.tsx` | Table styling |
| `src/components/canvas/ForcePlot.tsx` | Background color update to `#232323` |
| `src/components/canvas/COPVisualization.tsx` | Background color update |
| `src/components/canvas/PlateCanvas.tsx` | Background color update |
| `src/App.tsx` | Remove any inline styling that conflicts |
