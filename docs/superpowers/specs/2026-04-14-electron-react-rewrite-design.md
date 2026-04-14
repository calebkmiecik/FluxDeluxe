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
- **Production**: spawns `python/python.exe fluxdeluxe/DynamoPy/app/main.py` using the bundled Python runtime
- **Development**: spawns using system Python or project venv (mirrors the existing `runtime.py:get_python_executable()` logic that resolves the correct Python for frozen vs. dev modes)
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

DynamoPy exposes ~190 Socket.IO events total. The tables below list the events needed for v1 scope (live testing + model packaging). The full event catalog lives in `fluxdeluxe/DynamoPy/app/flux_bridge/events/` — consult that directory as the source of truth for payload shapes and additional events.

DynamoPy also runs an HTTP REST API on port 3001 (default, configurable via `api_port` config key) for configuration and admin operations (e.g., `POST /api/shutdown` for graceful shutdown, `GET /api/get-devices`). The React app uses the REST API for shutdown and may use it for configuration reads; all real-time communication uses Socket.IO.

**Backend to Frontend (v1 events):**

| Event | Destination Store | Notes |
|-------|-------------------|-------|
| `connectedDeviceList` | `deviceStore` | Device discovery response |
| `connectionStatusUpdate` | `deviceStore` | Per-device connection changes |
| `initializationDevices` | `deviceStore` | Devices found during init |
| `initializationStatusUpdate` | `deviceStore` | Init progress per device |
| `getGroupsStatus` | `deviceStore` | Device group list |
| `groupDefinitions` | `deviceStore` | Group definitions (mound zones) |
| `getDynamoConfigStatus` | `sessionStore` | Runtime config response |
| `jsonData` | `liveDataStore` | Live data frames (JSON mode) |
| `simpleJsonData` | `liveDataStore` | Live data frames (msgpack compact mode) |
| `startCaptureStatus` | `sessionStore` | Capture start ACK |
| `stopCaptureStatus` | `sessionStore` | Capture stop ACK |
| `cancelCaptureStatus` | `sessionStore` | Capture cancel ACK |
| `tareStatus` | `sessionStore` | Tare ACK (per-device) |
| `tareAllStatus` | `sessionStore` | Tare-all ACK |
| `modelMetadata` | `deviceStore` | Available ML models |
| `modelLoadStatus` | `deviceStore` | Model load ACK |
| `modelActivationStatus` | `deviceStore` | Model activate/deactivate ACK |
| `modelPackageStatus` | `deviceStore` | Model packaging result |
| `deviceSettingsList` | `deviceStore` | Device settings response |
| `deviceTypesList` | `deviceStore` | Device type definitions |
| `groupUpdateStatus` | `deviceStore` | Response to saveGroup/updateGroup/deleteGroup |
| `getCaptureMetricsStatus` | (History page) | Capture analytics response |
| `getCaptureMetadataStatus` | (History page) | Capture history query response |
| `getCaptureResultsStatus` | (History page) | Capture detail response |
| `logMessage` | `uiStore` | Backend log forwarding |

**Frontend to Backend (v1 events):**

| Event | Purpose | Payload |
|-------|---------|---------|
| `getConnectedDevices` | Request device list | (none) |
| `getDynamoConfig` | Request runtime config | (none) |
| `getGroups` | Request device groups | (none) |
| `getGroupDefinitions` | Request group definitions | (none) |
| `getDeviceSettings` | Request device settings | (none) |
| `getDeviceTypes` | Request device types | (none) |
| `saveGroup` | Create/update device group | Group object |
| `tare` | Tare specific devices | `{[groupId]: [deviceIds]}` |
| `tareAll` | Tare all devices | (none) |
| `startCapture` | Begin capture | `{captureType, groupId, captureName?, athleteId?, tags?}` |
| `stopCapture` | Finalize capture | `{groupId?}` |
| `cancelCapture` | Discard capture | `{groupId?}` |
| `setDataEmissionRate` | Set UI update frequency | int (0-500) |
| `updateDynamoConfig` | Change runtime config | `{key, value}` |
| `getModelMetadata` | Request model list | `{deviceId}` |
| `activateModel` | Load ML model onto device | `{deviceId, modelId}` |
| `deactivateModel` | Unload model from device | `{deviceId, modelId}` |
| `loadModel` | Load model from disk | `{modelDir}` |
| `packageModel` | Package force+moments models | `{forceModelDir, momentsModelDir, outputDir}` |
| `getCaptureMetrics` | Fetch capture analytics | `{captureId}` |
| `getCaptureMetadata` | Query capture history | `{captureType?, athleteIds?, startTime?, stopTime?, tags?}` |
| `getCaptureResults` | Fetch capture detail | `{captureId}` |
| `quit` | Graceful backend shutdown | (none) |
| `clientLog` | Log from frontend | `{level, message}` |

### Live Data Stream

DynamoPy supports three emission modes: `json`, `csv`, and `simpleJson`. The React app should use `simpleJson` mode for live data (msgpack-encoded, lowest overhead) and `json` for debugging/development.

**Event**: `jsonData` (json mode) or `simpleJsonData` (simpleJson mode)
**Frequency**: Configurable 0-500 Hz via `setDataEmissionRate`
**Payload**: Per-device data including force vectors (Fz), moments (Mx, My), COP (cop_x, cop_y), temperature, and model predictions if active.

The existing Qt frontend's `extract_device_frames()` function (in `tools/FluxLite/src/ui/live_data_frames.py`) handles multiple payload shapes — the React version must handle the same variations. Consult that file for the definitive frame extraction logic.

---

## Zustand Stores

### `deviceStore` — Hardware & Connection State
- `connectionState`: `BACKEND_STARTING | SOCKET_CONNECTING | DISCOVERING_DEVICES | READY | DISCONNECTED | ERROR` (backend/hardware lifecycle, not test session state)
- `devices`: Map of connected devices (id, type, status, firmware version, temperature)
- `groups`: Device groups (paired devices for testing)
- `groupDefinitions`: Group definitions (mound zone assignments)
- `models`: Available ML models and device assignments
- Actions: `selectDevice()`, `activateModel()`, `deactivateModel()`, `saveGroup()`

### `sessionStore` — Test Session Lifecycle
- `sessionPhase`: `IDLE | WARMUP | TARE | ARMED | STABLE | CAPTURING | SUMMARY`
  - Note: `ARMED` and `STABLE` are frontend-only refinements of the existing backend `active` phase. The backend's `LiveSessionGate` uses `inactive | warmup | tare | active`. The frontend subdivides `active` into finer states for UI purposes.
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

## Device Group Management (Mound Mode)

When testing with a mound setup (launch plate + landing plates), the user must assign physical devices to logical positions. This mirrors the existing `WorldCanvas` mound mode.

**Mound zone positions**: "Launch Zone" (type 07/11), "Upper Landing Zone" (type 08/12), "Lower Landing Zone" (type 08/12).

**Workflow**:
1. User clicks a plate position on the `PlateCanvas` (in mound display mode)
2. `DevicePickerDialog` opens, filtered to compatible device types for that position
3. User selects a device → `saveGroup` event sent to backend with zone-to-device mapping
4. Backend creates/updates the device group → `groupUpdateStatus` response confirms

This state lives in `deviceStore.groups` and `deviceStore.groupDefinitions`.

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
- **Data source**: Queries capture history via Socket.IO `getCaptureMetadata` event (returns metadata from DynamoPy's local SQLite + Firebase). Individual capture details via `getCaptureMetrics` and `getCaptureResults` events. No direct database access from the React app.

### Models Page
- List of available models with metadata
- Package new model dialog
- Activate/deactivate on devices

---

## Error Handling

**DynamoPy crash during active session**: Electron detects process exit via `dynamo.ts`. If a capture is in progress, the session transitions to an error state. DynamoPy auto-restarts. The UI shows a toast with the failure and offers to resume or discard. The capture CSV may be partially written on disk — recovery is not attempted in v1.

**Socket.IO disconnection during active test**: `useSocket` hook detects disconnect. If mid-capture, the session pauses (UI shows "Reconnecting..."). On reconnect, the app re-requests device state. If reconnection fails after timeout, transitions to error state.

**Device disconnection during capture**: Backend sends `connectionStatusUpdate` with disconnected status. Frontend shows which device dropped and stops the capture. The user decides whether to save partial data or discard.

**Model packaging failure**: `modelPackageStatus` event returns with `status: 'error'`. The model packager dialog shows the error message. No retry — user fixes the input and tries again.

**General pattern**: All Socket.IO response events include `{status: 'success'|'error', message: string}`. The `useSocket` hook checks status on every response and routes errors to the toast system via `uiStore`.

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
