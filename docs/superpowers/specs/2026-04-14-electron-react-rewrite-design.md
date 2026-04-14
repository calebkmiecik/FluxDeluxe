# FluxDeluxe Electron + React Rewrite — Design Spec

## Overview

Rewrite the FluxDeluxe desktop application from Python/Qt (PySide6) to Electron + React (TypeScript). The goal is a cleaner, more modern UI while keeping the existing DynamoPy Python backend unchanged. The React frontend connects to DynamoPy over the same Socket.IO protocol used today.

### Scope

**In scope (v1):**
- Electron app shell with tool launcher
- FluxLite: live testing workflow (connect, warmup, tare, arm, capture, summary)
- FluxLite: model packaging
- DynamoPy subprocess management
- Two-tier update system (full app + DynamoPy hot-update)

**Out of scope:**
- Temperature testing (complete, does not need porting)
- Metrics Editor (future phase)
- AxioDash (external web tool, future phase)
- DynamoPy backend changes (none required)
- Calibration (future feature)

### Branch Strategy

Work happens on an `electron` branch off `master` in the existing FluxDeluxe repo. `master` remains the production Qt app. When the React version is ready to ship, `electron` merges to `master` and replaces the Qt code. Old code stays in git history.

---

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Desktop shell | Electron | Proven, full OS access, good packaging/update ecosystem |
| UI framework | React (TypeScript) | Largest ecosystem, mature tooling for complex stateful UIs |
| Components | shadcn/ui + Tailwind CSS | Pre-built Radix-based components, code lives in repo, full customization |
| State management | Zustand | Lightweight, slice-based stores, handles high-frequency updates well |
| Live visualization | HTML5 Canvas (custom) | Required for 500Hz data stream; SVG-based charting can't keep up |
| Static charts | Recharts | Declarative, React-native, fine for post-capture/analytics displays |
| Bundler | Vite + electron-vite | Fast dev server, hot reload, good Electron integration |
| Packaging | electron-builder | Windows installer (NSIS), auto-update support |
| Backend | DynamoPy (unchanged) | Python subprocess, Socket.IO server on port 3000 |

---

## Project Structure

```
FluxDeluxe/
├── electron/                    # Electron main process
│   ├── main.ts                  # App entry, window creation
│   ├── dynamo.ts                # DynamoPy subprocess manager
│   ├── updater.ts               # electron-updater + DynamoPy hot-update
│   └── preload.ts               # Context bridge (IPC to renderer)
├── src/                         # React renderer (the UI)
│   ├── App.tsx
│   ├── pages/
│   │   ├── Launcher.tsx         # Tool launcher home page
│   │   └── fluxlite/
│   │       ├── FluxLitePage.tsx  # Main FluxLite shell
│   │       ├── LiveTesting.tsx   # Live testing workspace
│   │       └── ModelPackager.tsx # Model packaging dialog
│   ├── components/
│   │   ├── ui/                  # shadcn/ui components
│   │   ├── canvas/              # Live Canvas widgets
│   │   │   ├── ForcePlot.tsx    # Real-time force vs. time
│   │   │   ├── COPVisualization.tsx  # Live COP position
│   │   │   └── PlateCanvas.tsx  # Plate viz + test grid + rotation
│   │   └── shared/              # Status bar, device picker, toasts
│   ├── stores/                  # Zustand stores
│   │   ├── deviceStore.ts
│   │   ├── sessionStore.ts
│   │   ├── liveDataStore.ts
│   │   └── uiStore.ts
│   ├── hooks/
│   │   ├── useSocket.ts         # Socket.IO connection + event binding
│   │   └── useLiveData.ts       # Subscribe to live data stream
│   └── lib/
│       ├── socket.ts            # Socket.IO client singleton
│       └── ipc.ts               # Electron IPC helpers
├── fluxdeluxe/
│   └── DynamoPy/                # Git submodule (unchanged)
├── python/                      # Bundled Python runtime (distribution)
├── package.json
├── tsconfig.json
├── vite.config.ts
├── electron-builder.yml
└── tailwind.config.ts
```

---

## Electron Main Process

### `electron/main.ts` — App Lifecycle
- Creates the BrowserWindow, loads the React app
- On app ready: starts DynamoPy via `dynamo.ts`, starts update checks
- On app close: sends graceful shutdown to DynamoPy, force-kills after timeout

### `electron/dynamo.ts` — DynamoPy Subprocess Manager
- Spawns `python/python.exe fluxdeluxe/DynamoPy/app/main.py`
- Pipes stdout/stderr to a log ring buffer accessible from the renderer
- Monitors process health — auto-restarts on crash, notifies renderer via IPC
- Exposes IPC handlers: `dynamo:restart`, `dynamo:get-logs`, `dynamo:status`

### `electron/updater.ts` — Two-Tier Update System
- **Full app updates**: `electron-updater` checks GitHub Releases for FluxDeluxe repo on launch. Downloads + installs in background, prompts user to restart.
- **DynamoPy hot-update**: On launch, fetches latest release tag from `Axioforce/AxioforceDynamoPy` via GitHub API. Compares to local version file. If newer: downloads release zip, extracts to DynamoPy directory, restarts subprocess.

### `electron/preload.ts` — Context Bridge
Exposes a safe `window.electronAPI` object to the renderer:
- `getDynamoStatus()`, `getDynamoLogs()`, `restartDynamo()`
- `getAppVersion()`
- `onUpdateAvailable(callback)`

The React app never uses Node.js directly — all system access goes through this bridge.

---

## Socket.IO Communication Layer

The React app connects to DynamoPy's Socket.IO server identically to how the Qt app does. No backend changes required.

### `src/lib/socket.ts` — Singleton Client
- Connects to `localhost:3000`
- Handles connect/disconnect/reconnect events
- Typed event emitters and listeners (TypeScript interfaces for every payload)

### `src/hooks/useSocket.ts` — React Binding
- Subscribes to Socket.IO events and pushes data into Zustand stores
- On connect: requests device list, config, model metadata
- On disconnect: updates connection state, shows reconnecting UI
- Cleans up listeners on unmount

### Event Protocol (unchanged from Qt app)

**Backend to Frontend:**

| Event | Destination Store |
|-------|-------------------|
| `connectedDeviceList` | `deviceStore` |
| `connectionStatusUpdate` | `deviceStore` |
| `dynamoConfig` | `sessionStore` |
| Live data frames | `liveDataStore` (ring buffer) |
| `captureStartStatus` | `sessionStore` |
| `stopCaptureStatus` | `sessionStore` |
| `modelMetadata` | `deviceStore` |

**Frontend to Backend:**

| Event | Purpose |
|-------|---------|
| `startCapture` | Begin capture |
| `stopCapture` | Finalize capture |
| `cancelCapture` | Discard capture |
| `setDataEmissionRate` | Set UI update frequency |
| `activateModel` | Load ML model onto device |
| `updateDynamoConfig` | Change runtime config |

---

## Zustand Stores

### `deviceStore` — Hardware State
- `devices`: Map of connected devices (id, type, status, firmware version, temperature)
- `groups`: Device groups (paired devices for testing)
- `models`: Available ML models and device assignments
- Actions: `selectDevice()`, `activateModel()`, `deactivateModel()`

### `sessionStore` — Test Session Lifecycle
- `connectionState`: `BACKEND_STARTING | SOCKET_CONNECTING | DISCOVERING_DEVICES | READY`
- `sessionPhase`: `IDLE | WARMUP | TARE | ARMED | STABLE | CAPTURING | SUMMARY`
- `activeCapture`: Current capture metadata (start time, athlete, tags)
- `dynamoConfig`: Emission rate, sampling rate, demo mode
- Actions: `startCapture()`, `stopCapture()`, `cancelCapture()`, `tare()`, `updateConfig()`

### `liveDataStore` — Real-Time Frame Data
- Uses `subscribeWithSelector` to avoid unnecessary re-renders
- `currentFrame`: Latest processed frame (force, moments, COP, temp per device)
- `frameBuffer`: Ring buffer of recent frames for force plot time series
- Canvas components read via refs, not React state — renders driven by `requestAnimationFrame`, not React reconciliation

### `uiStore` — Navigation and UI State
- `currentPage`: Active tool/page (launcher, fluxlite)
- `activePanel`: Current FluxLite view
- `toasts`: Notification queue
- `dialogState`: Device picker, model packager visibility
- `backendLogs`: Recent DynamoPy log lines (from Electron IPC)

Stores are independent — no store reads from another. `deviceStore` and `sessionStore` are driven by Socket.IO events. `liveDataStore` is driven by the high-frequency data stream. `uiStore` is driven by user interaction.

---

## Canvas Widgets (Live Visualization)

All three render via `requestAnimationFrame` at 60fps, reading directly from `liveDataStore` refs. They bypass React's render cycle for performance.

### `ForcePlot` — Real-Time Force vs. Time
- HTML5 Canvas, scrolling time-series of Fz (normal force) per device
- Reads from `frameBuffer` ring buffer (last ~5 seconds)
- Configurable Y-axis scale, grid lines, device color coding

### `COPVisualization` — Live Center of Pressure
- HTML5 Canvas, 2D top-down view of the plate
- Shows current COP position in real-time (no trail)
- Plate outline overlay for spatial reference

### `PlateCanvas` — Plate Visualization + Test Grid
Replaces the Qt `WorldCanvas`. Full-featured plate interaction widget:
- Renders plate geometry per device type (06, 07, 08, 11, 12) with correct dimensions
- Grid overlay for live testing — cells are color-coded and clickable
- Rotation support (0/90/180/270) to match physical plate orientation
- Click-to-reset functionality
- Mound mode: shows multiple plates (launch + landing zones), device assignment via picker
- Quick-action buttons: refresh devices, tare, rotate
- Cell coordinate mapping with rotation/device-type inversion (same logic as Qt version)

### Common Pattern
```
Component mounts
  → Gets canvas ref
  → Starts requestAnimationFrame loop
  → Each frame: read latest data from liveDataStore ref → draw to canvas
  → On unmount: cancel animation frame
```

Post-capture static charts (summary metrics, analytics) use Recharts — rendered once, no performance concern.

---

## Dynamic Workspace Layout

### Design Principle
Give you what you need, strip away what you don't. The workspace adapts to the current session phase. No fancy animations — panels appear when relevant, disappear when not. Clean cuts, subtle fades at most.

### Sidebar (persistent, ~48px collapsed)
- Navigation icons: Live/Home, Models, Settings
- Device connection status (dot per device), always visible
- Active session indicator when capturing
- Collapsible — icon-only by default, expands on hover or pin

### Live/Home Workspace — Phase-Aware

**IDLE:**
- Recent test history as main content (cards or table with key metrics, device, date)
- Quick-start panel: select device, configure, begin session
- Dashboard feel — not an empty workspace

**WARMUP / TARE:**
- Focused flow: centered card with current gate (temp stabilizing, tare prompt)
- Progress indicator for warmup

**ARMED / STABLE / CAPTURING:**
- PlateCanvas expands to hero position (~60% of workspace)
- ForcePlot beside it
- COPVisualization docked nearby
- Compact control strip — just what's needed (pause, stop, cell details)
- Non-essential elements hidden — maximum focus on live data

**SUMMARY:**
- PlateCanvas shrinks to reference size (grid results still visible)
- Results panel expands: per-cell metrics, pass/fail, overall summary
- Action bar: save, discard, re-test, notes

### History Page
- Sortable/filterable table of past sessions
- Click to drill into capture detail: metrics, force plot replay, plate grid snapshot
- Searchable by date, device, athlete, tags

### Models Page
- List of available models with metadata
- Package new model dialog
- Activate/deactivate on devices

---

## Build, Package & Distribution

### Development
- `electron-vite` for dev server: hot reload for React, restart for Electron main process
- `npm run dev` starts everything: Vite dev server + Electron window + DynamoPy subprocess
- TypeScript strict mode throughout

### Packaging
- `electron-builder` produces a Windows installer (NSIS)
- Bundles: Electron runtime, React app, bundled Python environment, DynamoPy source
- Output: installer exe, similar distribution to today

### Updates

**Full app (electron-updater):**
- Checks GitHub Releases for FluxDeluxe repo on launch
- Downloads + installs in background
- Prompts user to restart

**DynamoPy hot-update:**
- On launch: checks latest release tag on `Axioforce/AxioforceDynamoPy` via GitHub API
- Compares to local version file
- If newer: downloads release zip, extracts, restarts subprocess

**DynamoPy auto-tagging (GitHub Action):**
- Triggers on push/merge to `main` on the DynamoPy repo
- Reads version from version file
- Creates git tag + GitHub Release with source zip attached
- Requires adding a `__version__.py` (or similar) to DynamoPy

### Release Flow
1. DynamoPy changes → push to main → GitHub Action auto-tags + creates release → apps pick up on next launch
2. Electron/React changes → run release script → electron-builder packages → push to GitHub Releases → apps auto-update
