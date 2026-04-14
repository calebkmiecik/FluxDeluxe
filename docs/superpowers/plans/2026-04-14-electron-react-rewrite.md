# FluxDeluxe Electron + React Rewrite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the FluxDeluxe desktop frontend from Python/Qt to Electron + React, connecting to the existing DynamoPy backend over Socket.IO.

**Architecture:** Electron main process manages the window and spawns DynamoPy as a Python subprocess. React renderer connects to DynamoPy's Socket.IO server (port 3000) for real-time data. Zustand stores hold state, HTML5 Canvas renders live visualization at 60fps.

**Tech Stack:** Electron, React 18+, TypeScript (strict), Vite (electron-vite), Tailwind CSS, shadcn/ui, Zustand, socket.io-client, Recharts, Vitest

**Spec:** `docs/superpowers/specs/2026-04-14-electron-react-rewrite-design.md`

---

## File Map

### Electron Main Process (`electron/`)
| File | Responsibility |
|------|---------------|
| `electron/main.ts` | App lifecycle, window creation, DynamoPy startup |
| `electron/dynamo.ts` | DynamoPy subprocess spawn, log capture, health monitoring, restart |
| `electron/preload.ts` | Context bridge — exposes `window.electronAPI` to renderer |
| `electron/updater.ts` | electron-updater for full app + DynamoPy hot-update logic |

### React Renderer (`src/`)
| File | Responsibility |
|------|---------------|
| `src/main.tsx` | React entry point |
| `src/App.tsx` | Root component, sidebar + page routing |
| `src/lib/socket.ts` | Socket.IO client singleton, typed event helpers |
| `src/lib/ipc.ts` | Electron IPC wrapper around `window.electronAPI` |
| `src/lib/types.ts` | Shared TypeScript interfaces (DeviceFrame, Device, Group, etc.) |
| `src/lib/frameParser.ts` | Port of `extract_device_frames()` — normalize backend payload shapes |
| `src/lib/plateGeometry.ts` | Plate dimensions, coordinate transforms, rotation math |
| `src/stores/deviceStore.ts` | Devices, groups, models, connection state |
| `src/stores/sessionStore.ts` | Session phase, capture state, dynamo config |
| `src/stores/liveDataStore.ts` | Ring buffer, current frame, high-frequency data |
| `src/stores/uiStore.ts` | Navigation, toasts, dialog visibility, backend logs |
| `src/hooks/useSocket.ts` | Connect Socket.IO events to Zustand stores |
| ~~`src/hooks/useLiveData.ts`~~ | *(Removed — canvas components read from liveDataStore directly via `getState()`)* |
| `src/hooks/useAnimationFrame.ts` | Shared requestAnimationFrame loop hook |
| `src/components/ui/` | shadcn/ui components (button, dialog, card, toast, etc.) |
| `src/components/shared/Sidebar.tsx` | Persistent navigation sidebar with device status |
| ~~`src/components/shared/StatusBar.tsx`~~ | *(Removed — connection info lives in sidebar; session info in workspace header)* |
| `src/components/shared/Toast.tsx` | Toast notification system |
| `src/components/shared/DevicePicker.tsx` | Device selection dialog (single + mound mode) |
| `src/components/canvas/ForcePlot.tsx` | Real-time force vs. time (HTML5 Canvas) |
| `src/components/canvas/COPVisualization.tsx` | Live COP position (HTML5 Canvas) |
| `src/components/canvas/PlateCanvas.tsx` | Plate viz + test grid + rotation (HTML5 Canvas) |
| `src/pages/Launcher.tsx` | Tool launcher home page |
| `src/pages/fluxlite/FluxLitePage.tsx` | FluxLite shell — phase-aware workspace |
| `src/pages/fluxlite/IdleView.tsx` | IDLE phase — history dashboard + quick-start |
| `src/pages/fluxlite/GateView.tsx` | WARMUP/TARE gate — centered prompt cards |
| `src/pages/fluxlite/LiveView.tsx` | ARMED/STABLE/CAPTURING — canvas hero layout |
| `src/pages/fluxlite/SummaryView.tsx` | SUMMARY — results, save/discard actions |
| `src/pages/fluxlite/HistoryPage.tsx` | Capture history table + detail drill-down |
| `src/pages/fluxlite/ModelsPage.tsx` | Model browser + activate/deactivate |
| `src/pages/fluxlite/ModelPackager.tsx` | Model packaging dialog |

### Tests (`src/__tests__/`)
| File | What it tests |
|------|--------------|
| `src/__tests__/frameParser.test.ts` | All 4 payload shapes from `extract_device_frames` |
| `src/__tests__/plateGeometry.test.ts` | Coordinate transforms, rotation mapping, dimensions |
| `src/__tests__/deviceStore.test.ts` | Device store actions and state transitions |
| `src/__tests__/sessionStore.test.ts` | Session phase transitions, capture lifecycle |
| `src/__tests__/liveDataStore.test.ts` | Ring buffer behavior, frame insertion |
| `src/__tests__/uiStore.test.ts` | Toast queue, navigation state |

### Config Files (root)
| File | Responsibility |
|------|---------------|
| `package.json` | Dependencies, scripts |
| `tsconfig.json` | TypeScript config (strict) |
| `tsconfig.node.json` | TypeScript config for Electron main process |
| `electron.vite.config.ts` | electron-vite config (main, preload, renderer) |
| `electron-builder.yml` | Electron packaging config |
| `components.json` | shadcn/ui config |

---

## Task 1: Branch & Project Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `electron.vite.config.ts`, `components.json`, `src/main.tsx`, `src/App.tsx`, `src/index.css`, `index.html`

- [ ] **Step 1: Create the `electron` branch**

```bash
git checkout -b electron
```

- [ ] **Step 2: Clean out Qt frontend files (keep DynamoPy submodule)**

Remove the Qt-specific files that will be replaced. Keep `fluxdeluxe/DynamoPy/`, `tools/`, `.env`, `.gitignore`, `ROADMAP.md`, `README.md`, and `docs/`.

```bash
rm -f run_app.py build.py release.py FluxDeluxe.spec installer.iss requirements.txt requirements_backend.txt
rm -rf fluxdeluxe/ui fluxdeluxe/__pycache__ fluxdeluxe/__init__.py fluxdeluxe/__version__.py fluxdeluxe/config.py fluxdeluxe/main.py fluxdeluxe/runtime.py fluxdeluxe/updater.py
```

- [ ] **Step 3: Initialize npm project**

```bash
npm init -y
```

Then edit `package.json` to set:
```json
{
  "name": "fluxdeluxe",
  "version": "2.0.0",
  "description": "FluxDeluxe — Force Plate Testing Platform",
  "main": "dist-electron/main.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "author": "Axioforce",
  "license": "UNLICENSED",
  "private": true
}
```

- [ ] **Step 4: Install core dependencies**

```bash
npm install react react-dom zustand socket.io-client recharts
npm install -D electron electron-vite vite @vitejs/plugin-react typescript @types/react @types/react-dom tailwindcss @tailwindcss/vite vitest @testing-library/react @testing-library/jest-dom jsdom electron-builder electron-updater
```

- [ ] **Step 5: Create TypeScript configs**

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src/**/*", "electron/**/*"]
}
```

Create `tsconfig.node.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "noEmit": false,
    "outDir": "dist-electron"
  },
  "include": ["electron/**/*"]
}
```

- [ ] **Step 6: Create electron-vite config**

Create `electron.vite.config.ts`:
```typescript
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src') },
    },
  },
})
```

- [ ] **Step 7: Configure Tailwind v4 theme via CSS**

Tailwind v4 uses CSS-based configuration, not a config file. Theme customization goes in `src/index.css` (created in Step 8). No `tailwind.config.ts` or `postcss.config.js` needed — `@tailwindcss/vite` handles everything.

- [ ] **Step 8: Create entry files**

Create `index.html`:
```html
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>FluxDeluxe</title>
</head>
<body class="bg-background text-white">
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

Create `src/index.css`:
```css
@import 'tailwindcss';

@theme {
  --color-background: #121212;
  --color-surface: #1e1e1e;
  --color-border: #2e2e2e;
  --color-primary: #4a9eff;
  --color-success: #00c853;
  --color-warning: #ffc107;
  --color-danger: #ff5252;
}
```

Create `src/main.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

Create `src/App.tsx`:
```tsx
export default function App() {
  return (
    <div className="flex h-screen w-screen bg-background text-white">
      <div className="flex items-center justify-center flex-1">
        <h1 className="text-2xl font-bold">FluxDeluxe</h1>
      </div>
    </div>
  )
}
```

- [ ] **Step 9: Create vitest config**

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
})
```

- [ ] **Step 10: Initialize shadcn/ui**

```bash
npx shadcn@latest init
```

Select: TypeScript, default style, dark theme, `src/components/ui` path, `@/` alias.

Then add initial components:
```bash
npx shadcn@latest add button card dialog toast sonner
```

- [ ] **Step 11: Verify the dev server starts**

```bash
npm run dev
```

Confirm: Electron window opens showing "FluxDeluxe" with dark background and white text. If Electron doesn't open, check that `electron-vite` is configured correctly.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: scaffold Electron + React project with Vite, Tailwind, shadcn/ui"
```

---

## Task 2: Electron Main Process

**Files:**
- Create: `electron/main.ts`, `electron/preload.ts`, `electron/dynamo.ts`
- Note: `electron.vite.config.ts` was already created in Task 1

- [ ] **Step 1: Create `electron/preload.ts`**

```typescript
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
})
```

- [ ] **Step 2: Create `electron/dynamo.ts`**

```typescript
import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import { app, ipcMain, BrowserWindow } from 'electron'

const MAX_LOG_LINES = 500

export class DynamoManager {
  private process: ChildProcess | null = null
  private logs: string[] = []
  private status: 'stopped' | 'starting' | 'running' | 'crashed' = 'stopped'
  private window: BrowserWindow | null = null

  constructor(window: BrowserWindow) {
    this.window = window
    this.registerIpcHandlers()
  }

  private getPythonPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'python', 'python.exe')
    }
    // Dev mode: use system Python or venv
    return process.env.PYTHON_PATH || 'python'
  }

  private getScriptPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'fluxdeluxe', 'DynamoPy', 'app', 'main.py')
    }
    return path.join(app.getAppPath(), 'fluxdeluxe', 'DynamoPy', 'app', 'main.py')
  }

  start(): void {
    if (this.process) return
    this.status = 'starting'
    this.notifyStatus()

    const pythonPath = this.getPythonPath()
    const scriptPath = this.getScriptPath()

    this.process = spawn(pythonPath, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    this.process.stdout?.on('data', (data: Buffer) => {
      const line = data.toString().trim()
      if (line) {
        this.pushLog(line)
        if (this.status === 'starting' && line.includes('Uvicorn running')) {
          this.status = 'running'
          this.notifyStatus()
        }
      }
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim()
      if (line) this.pushLog(`[stderr] ${line}`)
    })

    this.process.on('exit', (code) => {
      this.pushLog(`DynamoPy exited with code ${code}`)
      this.process = null
      if (this.status === 'running') {
        this.status = 'crashed'
        this.notifyStatus()
        // Auto-restart after 2 seconds
        setTimeout(() => this.start(), 2000)
      } else {
        this.status = 'stopped'
        this.notifyStatus()
      }
    })
  }

  async stop(): Promise<void> {
    if (!this.process) return
    this.status = 'stopped'
    this.notifyStatus()
    // Graceful shutdown: POST /api/shutdown, then wait up to 5s before force-kill
    try {
      await fetch('http://localhost:3001/api/shutdown', { method: 'POST', signal: AbortSignal.timeout(3000) })
    } catch { /* Backend may already be down */ }
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.process?.kill()
        resolve()
      }, 5000)
      this.process?.on('exit', () => { clearTimeout(timeout); resolve() })
    })
    this.process = null
  }

  restart(): void {
    this.stop()
    setTimeout(() => this.start(), 500)
  }

  private pushLog(line: string): void {
    this.logs.push(line)
    if (this.logs.length > MAX_LOG_LINES) this.logs.shift()
    this.window?.webContents.send('dynamo:log', line)
  }

  private notifyStatus(): void {
    this.window?.webContents.send('dynamo:status-change', this.status)
  }

  private registerIpcHandlers(): void {
    // Guard against duplicate registration (e.g., window recreation)
    for (const ch of ['dynamo:status', 'dynamo:get-logs', 'dynamo:restart']) {
      ipcMain.removeHandler(ch)
    }
    ipcMain.handle('dynamo:status', () => this.status)
    ipcMain.handle('dynamo:get-logs', () => [...this.logs])
    ipcMain.handle('dynamo:restart', () => { this.restart() })
  }

  getStatus(): string { return this.status }
}
```

- [ ] **Step 3: Create `electron/main.ts`**

```typescript
import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { DynamoManager } from './dynamo'

let mainWindow: BrowserWindow | null = null
let dynamo: DynamoManager | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'FluxDeluxe',
    backgroundColor: '#121212',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  dynamo = new DynamoManager(mainWindow)
  dynamo.start()

  ipcMain.handle('app:version', () => app.getVersion())
}

app.whenReady().then(createWindow)

app.on('window-all-closed', async () => {
  await dynamo?.stop()
  app.quit()
})
```

- [ ] **Step 4: Verify Electron window opens with React app**

```bash
npm run dev
```

Confirm: Electron window opens, shows "FluxDeluxe" text, DynamoPy starts (check terminal logs).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Electron main process with DynamoPy subprocess manager"
```

---

## Task 3: IPC Bridge + TypeScript Types

**Files:**
- Create: `src/lib/ipc.ts`, `src/lib/types.ts`, `src/global.d.ts`

- [ ] **Step 1: Create type declarations for the preload API**

Create `src/global.d.ts`:
```typescript
interface ElectronAPI {
  getDynamoStatus: () => Promise<string>
  getDynamoLogs: () => Promise<string[]>
  restartDynamo: () => Promise<void>
  getAppVersion: () => Promise<string>
  onDynamoLog: (callback: (log: string) => void) => void
  onDynamoStatusChange: (callback: (status: string) => void) => void
  onUpdateAvailable: (callback: (info: unknown) => void) => void
}

interface Window {
  electronAPI?: ElectronAPI
}
```

- [ ] **Step 2: Create IPC helper**

Create `src/lib/ipc.ts`:
```typescript
function getAPI(): ElectronAPI | null {
  return window.electronAPI ?? null
}

export const ipc = {
  getDynamoStatus: () => getAPI()?.getDynamoStatus() ?? Promise.resolve('unknown'),
  getDynamoLogs: () => getAPI()?.getDynamoLogs() ?? Promise.resolve([]),
  restartDynamo: () => getAPI()?.restartDynamo() ?? Promise.resolve(),
  getAppVersion: () => getAPI()?.getAppVersion() ?? Promise.resolve('dev'),
  onDynamoLog: (cb: (log: string) => void) => getAPI()?.onDynamoLog(cb),
  onDynamoStatusChange: (cb: (status: string) => void) => getAPI()?.onDynamoStatusChange(cb),
  onUpdateAvailable: (cb: (info: unknown) => void) => getAPI()?.onUpdateAvailable(cb),
}
```

- [ ] **Step 3: Create shared TypeScript types**

Create `src/lib/types.ts`:
```typescript
// Device frame from DynamoPy live data stream
export interface DeviceFrame {
  id: string
  fx: number
  fy: number
  fz: number
  time?: number
  avgTemperatureF?: number
  cop: { x: number; y: number }
  moments: { x: number; y: number; z: number }
  groupId?: string
}

// Connected device info
export interface Device {
  axfId: string
  name: string
  deviceTypeId: string
  status: string
  firmwareVersion?: string
  temperature?: number
}

// Device group (mound setup)
export interface DeviceGroup {
  axfId: string
  name: string
  groupDefinitionId: string
  devices: Record<string, string> // position -> deviceId
}

// Socket.IO response envelope
export interface SocketResponse<T = unknown> {
  status: 'success' | 'error'
  message: string
  data?: T
  errorDetails?: string
}

// Session phases
export type ConnectionState =
  | 'BACKEND_STARTING'
  | 'SOCKET_CONNECTING'
  | 'DISCOVERING_DEVICES'
  | 'READY'
  | 'DISCONNECTED'
  | 'ERROR'

export type SessionPhase =
  | 'IDLE'
  | 'WARMUP'
  | 'TARE'
  | 'ARMED'
  | 'STABLE'
  | 'CAPTURING'
  | 'SUMMARY'

// Plate geometry constants
export const PLATE_DIMENSIONS: Record<string, { width: number; height: number }> = {
  '06': { width: 353.2, height: 404.0 },
  '07': { width: 353.3, height: 607.3 },
  '08': { width: 658.1, height: 607.3 },
  '11': { width: 353.3, height: 607.3 },
  '12': { width: 658.1, height: 607.3 },
}

// Grid dimensions per device type
export const GRID_DIMS: Record<string, { rows: number; cols: number }> = {
  '06': { rows: 3, cols: 3 },
  '07': { rows: 5, cols: 3 },
  '08': { rows: 5, cols: 5 },
  '11': { rows: 5, cols: 3 },
  '12': { rows: 5, cols: 5 },
}

// Color bins for cell grading
export const COLOR_BIN_MULTIPLIERS = {
  green: 0.5,
  light_green: 1.0,
  yellow: 1.5,
  orange: 2.5,
} as const

export const COLOR_BIN_RGBA: Record<string, [number, number, number, number]> = {
  green: [0, 200, 0, 180],
  light_green: [144, 238, 144, 180],
  yellow: [255, 255, 0, 180],
  orange: [255, 165, 0, 180],
  red: [255, 0, 0, 180],
}

// Passing thresholds (N) by device type
export const THRESHOLDS_DB_N: Record<string, number> = {
  '06': 5.0, '07': 6.0, '08': 8.0, '11': 6.0, '12': 8.0,
}

export const THRESHOLDS_BW_PCT: Record<string, number> = {
  '06': 0.010, '07': 0.015, '08': 0.020, '11': 0.015, '12': 0.020,
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add IPC bridge and shared TypeScript types"
```

---

## Task 4: Frame Parser + Plate Geometry Utilities (TDD)

**Files:**
- Create: `src/lib/frameParser.ts`, `src/lib/plateGeometry.ts`, `src/__tests__/frameParser.test.ts`, `src/__tests__/plateGeometry.test.ts`

- [ ] **Step 1: Write frame parser tests**

Create `src/__tests__/frameParser.test.ts`. Port the 4 payload shapes from `tools/FluxLite/src/ui/live_data_frames.py`:

```typescript
import { describe, it, expect } from 'vitest'
import { extractDeviceFrames } from '../lib/frameParser'

describe('extractDeviceFrames', () => {
  it('handles list of frame dicts', () => {
    const payload = [
      { id: 'axf_001', fx: 1, fy: 2, fz: 100, cop: { x: 0, y: 0 }, moments: { x: 0, y: 0, z: 0 } },
    ]
    const frames = extractDeviceFrames(payload)
    expect(frames).toHaveLength(1)
    expect(frames[0].id).toBe('axf_001')
    expect(frames[0].fz).toBe(100)
  })

  it('handles dict with "devices" key', () => {
    const payload = {
      devices: [
        { id: 'axf_002', fx: 0, fy: 0, fz: 200, cop: { x: 1, y: 2 }, moments: { x: 0, y: 0, z: 0 } },
      ],
    }
    const frames = extractDeviceFrames(payload)
    expect(frames).toHaveLength(1)
    expect(frames[0].fz).toBe(200)
  })

  it('handles raw sensor payload', () => {
    const payload = {
      deviceId: 'axf_003',
      sensors: [{ name: 'Sum', x: 1, y: 2, z: 300 }],
      cop: { x: 10, y: 20 },
      moments: { x: 5, y: 6, z: 7 },
      avgTemperatureF: 72.5,
    }
    const frames = extractDeviceFrames(payload)
    expect(frames).toHaveLength(1)
    expect(frames[0].id).toBe('axf_003')
    expect(frames[0].fz).toBe(300)
    expect(frames[0].cop.x).toBe(10)
  })

  it('handles single frame dict', () => {
    const payload = { id: 'axf_004', fx: 0, fy: 0, fz: 50, cop: { x: 0, y: 0 }, moments: { x: 0, y: 0, z: 0 } }
    const frames = extractDeviceFrames(payload)
    expect(frames).toHaveLength(1)
  })

  it('returns empty for non-dict/non-array', () => {
    expect(extractDeviceFrames(null)).toEqual([])
    expect(extractDeviceFrames('string')).toEqual([])
    expect(extractDeviceFrames(42)).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/__tests__/frameParser.test.ts
```

Expected: FAIL — `frameParser` module not found.

- [ ] **Step 3: Implement frame parser**

Create `src/lib/frameParser.ts`:
```typescript
import type { DeviceFrame } from './types'

export function extractDeviceFrames(payload: unknown): DeviceFrame[] {
  if (Array.isArray(payload)) {
    return payload.filter((f): f is DeviceFrame => typeof f === 'object' && f !== null)
  }

  if (typeof payload !== 'object' || payload === null) return []

  const p = payload as Record<string, unknown>

  // Raw sensor stream: { deviceId, sensors:[...], cop:{...}, moments:{...} }
  if ('sensors' in p && Array.isArray(p.sensors)) {
    const did = String(p.deviceId ?? '').trim()
    if (!did) return []
    const sum = (p.sensors as Record<string, unknown>[]).find(
      (s) => typeof s === 'object' && s !== null && s.name === 'Sum'
    )
    if (!sum) return []
    const cop = (p.cop ?? {}) as Record<string, number>
    const moments = (p.moments ?? {}) as Record<string, number>
    return [{
      id: did,
      fx: Number(sum.x ?? 0),
      fy: Number(sum.y ?? 0),
      fz: Number(sum.z ?? 0),
      time: p.time as number | undefined,
      avgTemperatureF: p.avgTemperatureF as number | undefined,
      cop: { x: Number(cop.x ?? 0), y: Number(cop.y ?? 0) },
      moments: { x: Number(moments.x ?? 0), y: Number(moments.y ?? 0), z: Number(moments.z ?? 0) },
      groupId: (p.groupId ?? p.group_id) as string | undefined,
    }]
  }

  // Processed stream: { devices:[...] }
  if ('devices' in p && Array.isArray(p.devices)) {
    return p.devices.filter((f): f is DeviceFrame => typeof f === 'object' && f !== null)
  }

  // Single frame dict
  if ('id' in p || 'deviceId' in p) {
    return [p as DeviceFrame]
  }

  return []
}
```

- [ ] **Step 4: Run frame parser tests**

```bash
npx vitest run src/__tests__/frameParser.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Write plate geometry tests**

Create `src/__tests__/plateGeometry.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { mapCellForDevice, mapCellForRotation, getColorBin } from '../lib/plateGeometry'

describe('mapCellForDevice', () => {
  it('mirrors cells for type 06', () => {
    const [r, c] = mapCellForDevice(0, 0, 3, 3, '06')
    expect(r).toBe(2)
    expect(c).toBe(2)
  })
  it('passes through for type 07', () => {
    const [r, c] = mapCellForDevice(0, 0, 5, 3, '07')
    expect(r).toBe(0)
    expect(c).toBe(0)
  })
})

describe('mapCellForRotation', () => {
  it('rotation 0 is identity', () => {
    expect(mapCellForRotation(1, 2, 3, 3, 0)).toEqual([1, 2])
  })
  it('rotation 1 (90 degrees)', () => {
    expect(mapCellForRotation(0, 0, 3, 3, 1)).toEqual([0, 2])
  })
  it('rotation 2 (180 degrees)', () => {
    expect(mapCellForRotation(0, 0, 3, 3, 2)).toEqual([2, 2])
  })
  it('rotation 3 (270 degrees)', () => {
    expect(mapCellForRotation(0, 0, 3, 3, 3)).toEqual([2, 0])
  })
})

describe('getColorBin', () => {
  it('returns green for low error', () => {
    expect(getColorBin(0.3)).toBe('green')
  })
  it('returns red for high error', () => {
    expect(getColorBin(3.0)).toBe('red')
  })
})
```

- [ ] **Step 6: Implement plate geometry**

Create `src/lib/plateGeometry.ts`:
```typescript
import { COLOR_BIN_MULTIPLIERS } from './types'

/** Mirror cell for device types that use anti-diagonal layout (06, 08, 12). */
export function mapCellForDevice(
  row: number, col: number, rows: number, cols: number, deviceType: string
): [number, number] {
  if (['06', '08', '12'].includes(deviceType)) {
    return [rows - 1 - col, cols - 1 - row]
  }
  return [row, col]
}

/** Rotate cell coordinates by k*90 degrees clockwise. */
export function mapCellForRotation(
  row: number, col: number, rows: number, cols: number, k: number
): [number, number] {
  const q = ((k % 4) + 4) % 4
  if (q === 0) return [row, col]
  if (q === 1) return [col, cols - 1 - row]
  if (q === 2) return [rows - 1 - row, cols - 1 - col]
  return [rows - 1 - col, row]
}

/** Invert rotation mapping (for click → canonical cell). */
export function invertRotation(
  row: number, col: number, rows: number, cols: number, k: number
): [number, number] {
  const q = ((k % 4) + 4) % 4
  if (q === 0) return [row, col]
  if (q === 1) return [cols - 1 - col, row]
  if (q === 2) return [rows - 1 - row, cols - 1 - col]
  return [col, rows - 1 - row]
}

/** Invert device mapping (for click → canonical cell). */
export function invertDeviceMapping(
  row: number, col: number, rows: number, cols: number, deviceType: string
): [number, number] {
  if (['06', '08', '12'].includes(deviceType)) {
    return [rows - 1 - col, cols - 1 - row]
  }
  return [row, col]
}

/** Map error ratio to color bin name. */
export function getColorBin(errorRatio: number): string {
  if (errorRatio <= COLOR_BIN_MULTIPLIERS.green) return 'green'
  if (errorRatio <= COLOR_BIN_MULTIPLIERS.light_green) return 'light_green'
  if (errorRatio <= COLOR_BIN_MULTIPLIERS.yellow) return 'yellow'
  if (errorRatio <= COLOR_BIN_MULTIPLIERS.orange) return 'orange'
  return 'red'
}
```

- [ ] **Step 7: Run all tests**

```bash
npx vitest run
```

Expected: All PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add frame parser and plate geometry utilities with tests"
```

---

## Task 5: Zustand Stores (TDD)

**Files:**
- Create: `src/stores/deviceStore.ts`, `src/stores/sessionStore.ts`, `src/stores/liveDataStore.ts`, `src/stores/uiStore.ts`
- Create: `src/__tests__/deviceStore.test.ts`, `src/__tests__/sessionStore.test.ts`, `src/__tests__/liveDataStore.test.ts`, `src/__tests__/uiStore.test.ts`

- [ ] **Step 1: Write device store tests**

Create `src/__tests__/deviceStore.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { useDeviceStore } from '../stores/deviceStore'

describe('deviceStore', () => {
  beforeEach(() => useDeviceStore.setState(useDeviceStore.getInitialState()))

  it('starts in BACKEND_STARTING state', () => {
    expect(useDeviceStore.getState().connectionState).toBe('BACKEND_STARTING')
  })

  it('sets connection state', () => {
    useDeviceStore.getState().setConnectionState('READY')
    expect(useDeviceStore.getState().connectionState).toBe('READY')
  })

  it('sets device list', () => {
    const devices = [{ axfId: 'axf_001', name: 'Plate 1', deviceTypeId: '07', status: 'connected' }]
    useDeviceStore.getState().setDevices(devices as any)
    expect(useDeviceStore.getState().devices).toHaveLength(1)
  })

  it('selects a device', () => {
    useDeviceStore.getState().selectDevice('axf_001')
    expect(useDeviceStore.getState().selectedDeviceId).toBe('axf_001')
  })
})
```

- [ ] **Step 2: Write session store tests**

Create `src/__tests__/sessionStore.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { useSessionStore } from '../stores/sessionStore'

describe('sessionStore', () => {
  beforeEach(() => useSessionStore.setState(useSessionStore.getInitialState()))

  it('starts in IDLE phase', () => {
    expect(useSessionStore.getState().sessionPhase).toBe('IDLE')
  })

  it('transitions session phase', () => {
    useSessionStore.getState().setSessionPhase('ARMED')
    expect(useSessionStore.getState().sessionPhase).toBe('ARMED')
  })

  it('sets dynamo config', () => {
    useSessionStore.getState().setDynamoConfig({ emissionRate: 100, samplingRate: 1000 })
    expect(useSessionStore.getState().dynamoConfig.emissionRate).toBe(100)
  })
})
```

- [ ] **Step 3: Write live data store tests**

Create `src/__tests__/liveDataStore.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { useLiveDataStore } from '../stores/liveDataStore'

describe('liveDataStore', () => {
  beforeEach(() => useLiveDataStore.setState(useLiveDataStore.getInitialState()))

  it('pushes frames to ring buffer', () => {
    const frame = { id: 'axf_001', fx: 0, fy: 0, fz: 100, cop: { x: 0, y: 0 }, moments: { x: 0, y: 0, z: 0 } }
    useLiveDataStore.getState().pushFrame(frame as any)
    expect(useLiveDataStore.getState().frameBuffer.size).toBe(1)
    expect(useLiveDataStore.getState().currentFrame?.fz).toBe(100)
  })

  it('ring buffer caps at max size', () => {
    const store = useLiveDataStore.getState()
    for (let i = 0; i < 400; i++) {
      store.pushFrame({ id: 'axf_001', fx: 0, fy: 0, fz: i, cop: { x: 0, y: 0 }, moments: { x: 0, y: 0, z: 0 } } as any)
    }
    expect(useLiveDataStore.getState().frameBuffer.size).toBeLessThanOrEqual(300)
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
npx vitest run
```

Expected: FAIL — store modules not found.

- [ ] **Step 5: Implement all four stores**

Create `src/stores/deviceStore.ts`:
```typescript
import { create } from 'zustand'
import type { ConnectionState, Device, DeviceGroup } from '../lib/types'

interface DeviceStoreState {
  connectionState: ConnectionState
  devices: Device[]
  groups: DeviceGroup[]
  groupDefinitions: unknown[]
  models: unknown[]
  selectedDeviceId: string | null
  setConnectionState: (state: ConnectionState) => void
  setDevices: (devices: Device[]) => void
  setGroups: (groups: DeviceGroup[]) => void
  setGroupDefinitions: (defs: unknown[]) => void
  setModels: (models: unknown[]) => void
  selectDevice: (id: string | null) => void
}

export const useDeviceStore = create<DeviceStoreState>()((set) => ({
  connectionState: 'BACKEND_STARTING',
  devices: [],
  groups: [],
  groupDefinitions: [],
  models: [],
  selectedDeviceId: null,
  setConnectionState: (connectionState) => set({ connectionState }),
  setDevices: (devices) => set({ devices }),
  setGroups: (groups) => set({ groups }),
  setGroupDefinitions: (groupDefinitions) => set({ groupDefinitions }),
  setModels: (models) => set({ models }),
  selectDevice: (selectedDeviceId) => set({ selectedDeviceId }),
}))
```

Create `src/stores/sessionStore.ts`:
```typescript
import { create } from 'zustand'
import type { SessionPhase } from '../lib/types'

interface DynamoConfig {
  emissionRate: number
  samplingRate: number
  demoMode?: boolean
}

interface SessionStoreState {
  sessionPhase: SessionPhase
  activeCapture: { startTime?: number; athleteId?: string; tags?: string[] } | null
  dynamoConfig: DynamoConfig
  setSessionPhase: (phase: SessionPhase) => void
  setActiveCapture: (capture: SessionStoreState['activeCapture']) => void
  setDynamoConfig: (config: Partial<DynamoConfig>) => void
}

export const useSessionStore = create<SessionStoreState>()((set) => ({
  sessionPhase: 'IDLE',
  activeCapture: null,
  dynamoConfig: { emissionRate: 0, samplingRate: 1000 },
  setSessionPhase: (sessionPhase) => set({ sessionPhase }),
  setActiveCapture: (activeCapture) => set({ activeCapture }),
  setDynamoConfig: (config) => set((s) => ({ dynamoConfig: { ...s.dynamoConfig, ...config } })),
}))
```

Create `src/stores/liveDataStore.ts`:

**IMPORTANT**: This store uses a mutable ring buffer to avoid React re-renders at 500Hz. Canvas components read via `getState()` in their `requestAnimationFrame` loop — they never subscribe via React. Only UI components that show summary info (like a force readout) should subscribe, and they should use `subscribeWithSelector` to limit re-renders.

```typescript
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { DeviceFrame } from '../lib/types'

const MAX_BUFFER_SIZE = 300 // ~5 seconds at 60fps

// Mutable ring buffer — mutated in place, no new array allocations per frame
class RingBuffer<T> {
  private buf: T[] = []
  private head = 0
  private _size = 0
  constructor(private capacity: number) {}
  push(item: T): void {
    if (this._size < this.capacity) {
      this.buf.push(item)
      this._size++
    } else {
      this.buf[this.head] = item
      this.head = (this.head + 1) % this.capacity
    }
  }
  toArray(): T[] {
    if (this._size < this.capacity) return this.buf.slice()
    return [...this.buf.slice(this.head), ...this.buf.slice(0, this.head)]
  }
  clear(): void { this.buf = []; this.head = 0; this._size = 0 }
  get size(): number { return this._size }
}

interface LiveDataStoreState {
  currentFrame: DeviceFrame | null
  frameBuffer: RingBuffer<DeviceFrame>
  pushFrame: (frame: DeviceFrame) => void
  clearBuffer: () => void
}

export const useLiveDataStore = create<LiveDataStoreState>()(
  subscribeWithSelector((set, get) => ({
    currentFrame: null,
    frameBuffer: new RingBuffer<DeviceFrame>(MAX_BUFFER_SIZE),
    pushFrame: (frame) => {
      // Mutate buffer in place — no React re-render triggered
      get().frameBuffer.push(frame)
      // Only update currentFrame (triggers subscribers that select it)
      set({ currentFrame: frame })
    },
    clearBuffer: () => set({ currentFrame: null, frameBuffer: new RingBuffer<DeviceFrame>(MAX_BUFFER_SIZE) }),
  }))
)
```

Create `src/stores/uiStore.ts`:
```typescript
import { create } from 'zustand'

interface Toast {
  id: string
  message: string
  type: 'info' | 'success' | 'error' | 'warning'
}

interface UiStoreState {
  currentPage: 'launcher' | 'fluxlite'
  activeLitePage: 'live' | 'history' | 'models'
  toasts: Toast[]
  backendLogs: string[]
  showDevicePicker: boolean
  showModelPackager: boolean
  navigate: (page: UiStoreState['currentPage']) => void
  setActiveLitePage: (page: UiStoreState['activeLitePage']) => void
  addToast: (toast: Omit<Toast, 'id'>) => void
  dismissToast: (id: string) => void
  pushBackendLog: (line: string) => void
  setShowDevicePicker: (show: boolean) => void
  setShowModelPackager: (show: boolean) => void
}

export const useUiStore = create<UiStoreState>()((set) => ({
  currentPage: 'launcher',
  activeLitePage: 'live',
  toasts: [],
  backendLogs: [],
  showDevicePicker: false,
  showModelPackager: false,
  navigate: (currentPage) => set({ currentPage }),
  setActiveLitePage: (activeLitePage) => set({ activeLitePage }),
  addToast: (toast) =>
    set((s) => ({ toasts: [...s.toasts, { ...toast, id: crypto.randomUUID() }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  pushBackendLog: (line) =>
    set((s) => ({
      backendLogs: s.backendLogs.length >= 500 ? [...s.backendLogs.slice(1), line] : [...s.backendLogs, line],
    })),
  setShowDevicePicker: (showDevicePicker) => set({ showDevicePicker }),
  setShowModelPackager: (showModelPackager) => set({ showModelPackager }),
}))
```

- [ ] **Step 6: Run all tests**

```bash
npx vitest run
```

Expected: All PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add Zustand stores with tests (device, session, liveData, ui)"
```

---

## Task 6: Socket.IO Client + useSocket Hook

**Files:**
- Create: `src/lib/socket.ts`, `src/hooks/useSocket.ts`

- [ ] **Step 1: Create Socket.IO singleton**

Create `src/lib/socket.ts`:
```typescript
import { io, Socket } from 'socket.io-client'

const SOCKET_URL = 'http://localhost:3000'

let socket: Socket | null = null

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    })
  }
  return socket
}

export function disconnectSocket(): void {
  socket?.disconnect()
  socket = null
}
```

- [ ] **Step 2: Create useSocket hook**

Create `src/hooks/useSocket.ts`:
```typescript
import { useEffect } from 'react'
import { getSocket } from '../lib/socket'
import { extractDeviceFrames } from '../lib/frameParser'
import { useDeviceStore } from '../stores/deviceStore'
import { useSessionStore } from '../stores/sessionStore'
import { useLiveDataStore } from '../stores/liveDataStore'
import { useUiStore } from '../stores/uiStore'
import type { SocketResponse } from '../lib/types'

export function useSocket(): void {
  useEffect(() => {
    const socket = getSocket()
    const deviceStore = useDeviceStore.getState()
    const sessionStore = useSessionStore.getState()
    const uiStore = useUiStore.getState()

    // Connection lifecycle
    socket.on('connect', () => {
      deviceStore.setConnectionState('DISCOVERING_DEVICES')
      // Request initial state from backend
      socket.emit('getConnectedDevices')
      socket.emit('getDynamoConfig')
      socket.emit('getGroups')
      socket.emit('getGroupDefinitions')
      socket.emit('getDeviceSettings')
      socket.emit('getDeviceTypes')
    })

    socket.on('disconnect', () => {
      deviceStore.setConnectionState('DISCONNECTED')
    })

    socket.on('connect_error', () => {
      deviceStore.setConnectionState('ERROR')
    })

    // Device events
    socket.on('connectedDeviceList', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success' && resp.data) {
        deviceStore.setDevices(resp.data as any)
        deviceStore.setConnectionState('READY')
      }
    })

    socket.on('connectionStatusUpdate', (data: unknown) => {
      // Update specific device status
    })

    socket.on('getGroupsStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success' && resp.data) {
        deviceStore.setGroups(resp.data as any)
      }
    })

    socket.on('groupDefinitions', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success' && resp.data) {
        deviceStore.setGroupDefinitions(resp.data as any)
      }
    })

    // Config
    socket.on('getDynamoConfigStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success' && resp.data) {
        const config = resp.data as Record<string, unknown>
        sessionStore.setDynamoConfig({
          emissionRate: Number(config.dataEmissionRate ?? 0),
          samplingRate: Number(config.samplingRate ?? 1000),
          demoMode: Boolean(config.demoMode),
        })
      }
    })

    // Live data (high frequency)
    socket.on('jsonData', (data: unknown) => {
      const frames = extractDeviceFrames(data)
      const pushFrame = useLiveDataStore.getState().pushFrame
      for (const frame of frames) pushFrame(frame)
    })

    socket.on('simpleJsonData', (data: unknown) => {
      const frames = extractDeviceFrames(data)
      const pushFrame = useLiveDataStore.getState().pushFrame
      for (const frame of frames) pushFrame(frame)
    })

    // Capture lifecycle
    socket.on('startCaptureStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success') {
        sessionStore.setSessionPhase('CAPTURING')
      } else {
        uiStore.addToast({ message: `Capture failed: ${resp.message}`, type: 'error' })
      }
    })

    socket.on('stopCaptureStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success') {
        sessionStore.setSessionPhase('SUMMARY')
      }
    })

    socket.on('tareStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success') {
        uiStore.addToast({ message: 'Tare complete', type: 'success' })
      } else {
        uiStore.addToast({ message: `Tare failed: ${resp.message}`, type: 'error' })
      }
    })

    // Models
    socket.on('modelMetadata', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success' && resp.data) {
        deviceStore.setModels(resp.data as any)
      }
    })

    socket.on('cancelCaptureStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success') {
        sessionStore.setSessionPhase('IDLE')
        uiStore.addToast({ message: 'Capture cancelled', type: 'info' })
      }
    })

    socket.on('tareAllStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success') {
        uiStore.addToast({ message: 'All devices tared', type: 'success' })
      }
    })

    // Device init
    socket.on('initializationDevices', (data: unknown) => {
      // Update device list during discovery
      const resp = data as SocketResponse
      if (resp.status === 'success' && resp.data) {
        deviceStore.setDevices(resp.data as any)
      }
    })

    socket.on('initializationStatusUpdate', (_data: unknown) => {
      // Could update per-device init progress in deviceStore if needed
    })

    socket.on('deviceSettingsList', (data: unknown) => {
      const resp = data as SocketResponse
      // Store device settings if needed for UI display
    })

    socket.on('deviceTypesList', (data: unknown) => {
      const resp = data as SocketResponse
      // Store device type definitions
    })

    // Group management
    socket.on('groupUpdateStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success') {
        // Re-fetch groups to get updated list
        socket.emit('getGroups')
      } else {
        uiStore.addToast({ message: `Group update failed: ${resp.message}`, type: 'error' })
      }
    })

    // Model lifecycle
    socket.on('modelLoadStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success') {
        uiStore.addToast({ message: 'Model loaded', type: 'success' })
      } else {
        uiStore.addToast({ message: `Model load failed: ${resp.message}`, type: 'error' })
      }
    })

    socket.on('modelActivationStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success') {
        uiStore.addToast({ message: 'Model activation updated', type: 'success' })
      }
    })

    socket.on('modelPackageStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success') {
        uiStore.addToast({ message: 'Model packaged successfully', type: 'success' })
      } else {
        uiStore.addToast({ message: `Packaging failed: ${resp.message}`, type: 'error' })
      }
    })

    // Capture history (for History page)
    socket.on('getCaptureMetricsStatus', (_data: unknown) => {
      // Handled by History page component directly
    })

    socket.on('getCaptureMetadataStatus', (_data: unknown) => {
      // Handled by History page component directly
    })

    socket.on('getCaptureResultsStatus', (_data: unknown) => {
      // Handled by History page component directly
    })

    // Backend logs
    socket.on('logMessage', (data: unknown) => {
      if (typeof data === 'string') uiStore.pushBackendLog(data)
      else if (typeof data === 'object' && data !== null) {
        uiStore.pushBackendLog(JSON.stringify(data))
      }
    })

    return () => {
      socket.removeAllListeners()
    }
  }, [])
}
```

- [ ] **Step 3: Wire useSocket into App**

Update `src/App.tsx`:
```tsx
import { useSocket } from './hooks/useSocket'

export default function App() {
  useSocket()
  return (
    <div className="flex h-screen w-screen bg-background text-white">
      <div className="flex items-center justify-center flex-1">
        <h1 className="text-2xl font-bold">FluxDeluxe</h1>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify Socket.IO connects to DynamoPy**

```bash
npm run dev
```

Open Electron app. In dev tools console, check for Socket.IO connection. If DynamoPy is running, you should see device data arriving.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Socket.IO client and useSocket hook wiring events to stores"
```

---

## Task 7: App Shell — Sidebar + Routing

**Files:**
- Create: `src/components/shared/Sidebar.tsx`, `src/pages/Launcher.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create Sidebar component**

Create `src/components/shared/Sidebar.tsx`:
```tsx
import { useUiStore } from '../../stores/uiStore'
import { useDeviceStore } from '../../stores/deviceStore'

const NAV_ITEMS = [
  { id: 'launcher' as const, icon: '⊞', label: 'Home' },
  { id: 'fluxlite' as const, icon: '⚡', label: 'FluxLite' },
] as const

export function Sidebar() {
  const { currentPage, navigate } = useUiStore()
  const connectionState = useDeviceStore((s) => s.connectionState)
  const devices = useDeviceStore((s) => s.devices)

  return (
    <div className="flex flex-col w-12 hover:w-48 transition-all duration-150 bg-surface border-r border-border group overflow-hidden">
      {/* Nav items */}
      <nav className="flex flex-col gap-1 p-2 flex-1">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => navigate(item.id)}
            className={`flex items-center gap-3 px-2 py-2 rounded text-sm transition-colors ${
              currentPage === item.id ? 'bg-primary/20 text-primary' : 'text-zinc-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <span className="text-lg w-6 text-center flex-shrink-0">{item.icon}</span>
            <span className="whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Device status dots */}
      <div className="p-2 border-t border-border">
        <div className="flex items-center gap-2 px-2">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
            connectionState === 'READY' ? 'bg-success' :
            connectionState === 'DISCONNECTED' || connectionState === 'ERROR' ? 'bg-danger' :
            'bg-warning animate-pulse'
          }`} />
          <span className="text-xs text-zinc-500 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
            {connectionState === 'READY' ? `${devices.length} device${devices.length !== 1 ? 's' : ''}` : connectionState.toLowerCase().replace('_', ' ')}
          </span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create Launcher page**

Create `src/pages/Launcher.tsx`:
```tsx
import { useUiStore } from '../stores/uiStore'

const TOOLS = [
  { id: 'fluxlite', name: 'FluxLite', description: 'Live force plate testing', icon: '⚡' },
] as const

export function Launcher() {
  const navigate = useUiStore((s) => s.navigate)

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <h1 className="text-3xl font-bold mb-2">FluxDeluxe</h1>
      <p className="text-zinc-400 mb-8">Select a tool to get started</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            onClick={() => navigate('fluxlite')}
            className="flex flex-col items-center gap-3 p-6 rounded-lg bg-surface border border-border hover:border-primary/50 transition-colors"
          >
            <span className="text-3xl">{tool.icon}</span>
            <span className="font-semibold">{tool.name}</span>
            <span className="text-sm text-zinc-400">{tool.description}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Wire up App with sidebar and routing**

Update `src/App.tsx`:
```tsx
import { useSocket } from './hooks/useSocket'
import { useUiStore } from './stores/uiStore'
import { Sidebar } from './components/shared/Sidebar'
import { Launcher } from './pages/Launcher'

export default function App() {
  useSocket()
  const currentPage = useUiStore((s) => s.currentPage)

  return (
    <div className="flex h-screen w-screen bg-background text-white">
      <Sidebar />
      <main className="flex-1 flex overflow-hidden">
        {currentPage === 'launcher' && <Launcher />}
        {currentPage === 'fluxlite' && (
          <div className="flex-1 flex items-center justify-center text-zinc-400">
            FluxLite (coming next)
          </div>
        )}
      </main>
    </div>
  )
}
```

- [ ] **Step 4: Verify sidebar and launcher render**

```bash
npm run dev
```

Confirm: Sidebar shows on left, launcher page with FluxLite card renders. Clicking card navigates to FluxLite placeholder. Sidebar shows connection status dot.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add app shell with sidebar navigation and tool launcher"
```

---

## Task 8: FluxLite Shell — Phase-Aware Workspace

**Files:**
- Create: `src/pages/fluxlite/FluxLitePage.tsx`, `src/pages/fluxlite/IdleView.tsx`, `src/pages/fluxlite/GateView.tsx`, `src/pages/fluxlite/LiveView.tsx`, `src/pages/fluxlite/SummaryView.tsx`

- [ ] **Step 1: Create FluxLitePage (phase router)**

Create `src/pages/fluxlite/FluxLitePage.tsx`:
```tsx
import { useSessionStore } from '../../stores/sessionStore'
import { useUiStore } from '../../stores/uiStore'
import { IdleView } from './IdleView'
import { GateView } from './GateView'
import { LiveView } from './LiveView'
import { SummaryView } from './SummaryView'

const LITE_NAV = [
  { id: 'live' as const, label: 'Live' },
  { id: 'history' as const, label: 'History' },
  { id: 'models' as const, label: 'Models' },
] as const

export function FluxLitePage() {
  const phase = useSessionStore((s) => s.sessionPhase)
  const { activeLitePage, setActiveLitePage } = useUiStore()

  // During active sessions (not IDLE), show the session workspace instead of nav tabs
  const isActiveSession = phase !== 'IDLE'

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Sub-nav tabs (only shown when IDLE) */}
      {!isActiveSession && (
        <div className="flex gap-1 px-4 pt-3 pb-1 border-b border-border">
          {LITE_NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveLitePage(item.id)}
              className={`px-3 py-1.5 text-sm rounded-t transition-colors ${
                activeLitePage === item.id
                  ? 'text-white bg-surface border-b-2 border-primary'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {/* Phase-aware content */}
      <div className="flex-1 overflow-hidden">
        {isActiveSession ? (
          // Active session phases
          phase === 'WARMUP' || phase === 'TARE' ? <GateView /> :
          phase === 'SUMMARY' ? <SummaryView /> :
          <LiveView />
        ) : (
          // Idle navigation
          activeLitePage === 'live' ? <IdleView /> :
          activeLitePage === 'history' ? <div className="p-4 text-zinc-400">History (Task 11)</div> :
          <div className="p-4 text-zinc-400">Models (Task 12)</div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create IdleView (dashboard + quick-start)**

Create `src/pages/fluxlite/IdleView.tsx`:
```tsx
import { useDeviceStore } from '../../stores/deviceStore'
import { useSessionStore } from '../../stores/sessionStore'

export function IdleView() {
  const devices = useDeviceStore((s) => s.devices)
  const connectionState = useDeviceStore((s) => s.connectionState)
  const setPhase = useSessionStore((s) => s.setSessionPhase)

  return (
    <div className="flex-1 flex flex-col p-6 gap-6 overflow-auto">
      {/* Quick-start */}
      <div className="bg-surface rounded-lg border border-border p-6">
        <h2 className="text-lg font-semibold mb-4">Start Testing</h2>
        {connectionState !== 'READY' ? (
          <p className="text-zinc-400">Waiting for backend connection...</p>
        ) : devices.length === 0 ? (
          <p className="text-zinc-400">No devices connected. Connect a force plate to begin.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-zinc-400">{devices.length} device{devices.length !== 1 ? 's' : ''} connected</p>
            <button
              onClick={() => setPhase('WARMUP')}
              className="self-start px-4 py-2 bg-primary text-white rounded hover:bg-primary/80 transition-colors"
            >
              Begin Session
            </button>
          </div>
        )}
      </div>

      {/* Recent tests placeholder */}
      <div className="bg-surface rounded-lg border border-border p-6 flex-1">
        <h2 className="text-lg font-semibold mb-4">Recent Tests</h2>
        <p className="text-zinc-400">No recent tests.</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create GateView (warmup/tare prompts)**

Create `src/pages/fluxlite/GateView.tsx`:
```tsx
import { useSessionStore } from '../../stores/sessionStore'
import { getSocket } from '../../lib/socket'

export function GateView() {
  const phase = useSessionStore((s) => s.sessionPhase)
  const setPhase = useSessionStore((s) => s.setSessionPhase)

  const handleTare = () => {
    getSocket().emit('tareAll')
    setPhase('ARMED')
  }

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="bg-surface rounded-lg border border-border p-8 max-w-md text-center">
        {phase === 'WARMUP' ? (
          <>
            <h2 className="text-xl font-semibold mb-4">Warmup</h2>
            <p className="text-zinc-400 mb-6">Allow the plate to reach stable temperature before testing.</p>
            <button
              onClick={() => setPhase('TARE')}
              className="px-6 py-2 bg-primary text-white rounded hover:bg-primary/80 transition-colors"
            >
              Warmup Complete
            </button>
          </>
        ) : (
          <>
            <h2 className="text-xl font-semibold mb-4">Tare</h2>
            <p className="text-zinc-400 mb-6">Ensure nothing is on the plate, then tare to zero the baseline.</p>
            <button
              onClick={handleTare}
              className="px-6 py-2 bg-primary text-white rounded hover:bg-primary/80 transition-colors"
            >
              Tare & Begin
            </button>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create LiveView and SummaryView stubs**

Create `src/pages/fluxlite/LiveView.tsx`:
```tsx
export function LiveView() {
  return (
    <div className="flex-1 flex items-center justify-center text-zinc-400">
      Live testing workspace (canvas widgets — Task 9)
    </div>
  )
}
```

Create `src/pages/fluxlite/SummaryView.tsx`:
```tsx
import { useSessionStore } from '../../stores/sessionStore'

export function SummaryView() {
  const setPhase = useSessionStore((s) => s.setSessionPhase)

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4">
      <h2 className="text-xl font-semibold">Capture Complete</h2>
      <p className="text-zinc-400">Results will be displayed here.</p>
      <div className="flex gap-3">
        <button
          onClick={() => setPhase('ARMED')}
          className="px-4 py-2 bg-surface border border-border rounded hover:bg-white/5 transition-colors"
        >
          Test Again
        </button>
        <button
          onClick={() => setPhase('IDLE')}
          className="px-4 py-2 bg-primary text-white rounded hover:bg-primary/80 transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Wire FluxLitePage into App**

Update `src/App.tsx` to import and render `FluxLitePage` when `currentPage === 'fluxlite'`.

- [ ] **Step 6: Verify phase transitions work**

```bash
npm run dev
```

Test flow: Launcher → FluxLite → Begin Session → Warmup Complete → Tare & Begin → (LiveView stub) → navigate back through tabs.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add FluxLite phase-aware workspace with idle, gate, and summary views"
```

---

## Task 9: Canvas Widgets — ForcePlot + COPVisualization

**Files:**
- Create: `src/hooks/useAnimationFrame.ts`, `src/components/canvas/ForcePlot.tsx`, `src/components/canvas/COPVisualization.tsx`

- [ ] **Step 1: Create useAnimationFrame hook**

Create `src/hooks/useAnimationFrame.ts`:
```typescript
import { useRef, useEffect } from 'react'

export function useAnimationFrame(callback: (dt: number) => void): void {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    let lastTime = performance.now()
    let frameId: number

    function loop(time: number) {
      const dt = time - lastTime
      lastTime = time
      callbackRef.current(dt)
      frameId = requestAnimationFrame(loop)
    }

    frameId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frameId)
  }, [])
}
```

- [ ] **Step 2: Create ForcePlot canvas**

Create `src/components/canvas/ForcePlot.tsx` — scrolling time-series of Fz. The component:
- Gets a canvas ref
- Uses `useAnimationFrame` to render at 60fps
- Reads `frameBuffer` from `useLiveDataStore` via `getState()` (not React subscription)
- Draws axes, grid, and a scrolling line for each device's Fz
- Auto-scales Y axis based on recent max force

Full implementation — approximately 120 lines of canvas drawing code. Key drawing logic:
- Clear canvas
- Draw grid lines and axis labels
- Iterate `frameBuffer`, map each frame's `fz` to canvas Y coordinate
- Draw line segments connecting consecutive frames
- Draw axis labels (time on X, force in N on Y)

- [ ] **Step 3: Create COPVisualization canvas**

Create `src/components/canvas/COPVisualization.tsx` — live COP dot on plate outline. The component:
- Gets a canvas ref
- Uses `useAnimationFrame` to render at 60fps
- Reads `currentFrame` from `useLiveDataStore` via `getState()`
- Draws plate outline rectangle (scaled to device type dimensions)
- Draws COP position as a colored dot

- [ ] **Step 4: Wire canvases into LiveView**

Update `src/pages/fluxlite/LiveView.tsx` to render `ForcePlot` and `COPVisualization` side by side.

- [ ] **Step 5: Verify canvases render with live data**

```bash
npm run dev
```

With DynamoPy running and a device connected (or in demo mode), navigate to live testing. Verify force plot shows scrolling data and COP dot moves.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add ForcePlot and COPVisualization canvas widgets"
```

---

## Task 10: PlateCanvas — Plate Visualization + Test Grid

**Files:**
- Create: `src/components/canvas/PlateCanvas.tsx`

This is the most complex canvas widget. Port the logic from `tools/FluxLite/src/ui/widgets/world_canvas.py` and `tools/FluxLite/src/ui/widgets/grid_overlay.py`.

- [ ] **Step 1: Create PlateCanvas component**

Create `src/components/canvas/PlateCanvas.tsx`. Key features to implement:
- Render plate rectangle with correct dimensions per device type (use `PLATE_DIMENSIONS` from types)
- Grid overlay: draw NxM cells per device type (use `GRID_DIMS`)
- Cell color-coding: fill cells with colors from `COLOR_BIN_RGBA`
- Cell text: display force values or labels in each cell
- Active cell highlight: outline the currently selected cell
- Rotation: apply rotation transform (0/90/180/270) to the rendering
- Click handling: map click position to grid cell, apply inverse rotation + device mapping
- Quick action buttons: tare, rotate, refresh (rendered as HTML overlays on top of the canvas)

Use `mapCellForDevice`, `mapCellForRotation`, `invertRotation`, `invertDeviceMapping` from `src/lib/plateGeometry.ts`.

The component accepts props:
```typescript
interface PlateCanvasProps {
  deviceType: string
  rotation: number // 0-3 (quadrants)
  cellColors: Map<string, string> // "row,col" -> color bin name
  cellTexts: Map<string, string> // "row,col" -> display text
  activeCell: { row: number; col: number } | null
  onCellClick: (row: number, col: number) => void
  onRotate: () => void
  onTare: () => void
  onRefresh: () => void
}
```

- [ ] **Step 2: Wire PlateCanvas into LiveView**

Update `src/pages/fluxlite/LiveView.tsx` to render `PlateCanvas` as the hero element (~60% width), with `ForcePlot` and `COPVisualization` beside it.

- [ ] **Step 3: Test plate rendering and grid interaction**

```bash
npm run dev
```

Verify: plate renders with correct dimensions, grid cells are clickable, rotation works, cell colors display.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add PlateCanvas with test grid, rotation, and cell interaction"
```

---

## Task 11: Live Testing Workflow — Full Integration

**Files:**
- Modify: `src/pages/fluxlite/LiveView.tsx`, `src/pages/fluxlite/SummaryView.tsx`
- Create: `src/components/shared/DevicePicker.tsx`

- [ ] **Step 1: Create DevicePicker dialog**

Create `src/components/shared/DevicePicker.tsx` — a dialog that shows available devices filtered by type, lets the user select one. Used for both single-device and mound mode setup.

- [ ] **Step 2: Build out LiveView with full layout**

Update `src/pages/fluxlite/LiveView.tsx`:
- PlateCanvas as hero (left, ~60%)
- ForcePlot (top right)
- COPVisualization (below force plot)
- Control strip at bottom: session phase indicator, stop/pause buttons, cell detail panel
- Wire up session actions: `startCapture`, `stopCapture`, `cancelCapture` via Socket.IO

- [ ] **Step 3: Build out SummaryView with capture results**

Update `src/pages/fluxlite/SummaryView.tsx`:
- Show plate canvas in reduced size with final cell colors
- Display capture metrics (fetched via `getCaptureMetrics` event)
- Action buttons: save, discard, re-test

- [ ] **Step 4: Test full live testing flow**

```bash
npm run dev
```

With DynamoPy + device: connect → warmup → tare → arm → step on plate → capture → stop → view summary → done.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: implement full live testing workflow with device picker and summary"
```

---

## Task 12: History Page + Models Page + Model Packager

**Files:**
- Create: `src/pages/fluxlite/HistoryPage.tsx`, `src/pages/fluxlite/ModelsPage.tsx`, `src/pages/fluxlite/ModelPackager.tsx`

- [ ] **Step 1: Create HistoryPage**

Create `src/pages/fluxlite/HistoryPage.tsx`:
- On mount: emit `getCaptureMetadata` to fetch capture history
- Render sortable/filterable table of captures
- Click a row to drill into detail: emit `getCaptureMetrics` + `getCaptureResults`, display metrics

- [ ] **Step 2: Create ModelsPage**

Create `src/pages/fluxlite/ModelsPage.tsx`:
- On mount: emit `getModelMetadata` for each connected device
- List models with metadata (name, type, device)
- Buttons: activate, deactivate, package new model

- [ ] **Step 3: Create ModelPackager dialog**

Create `src/pages/fluxlite/ModelPackager.tsx`:
- File pickers for force model directory and moments model directory
- Output directory picker
- Package button emits `packageModel` event
- Shows progress/result from `modelPackageStatus` response

- [ ] **Step 4: Wire History and Models into FluxLitePage tabs**

Update `src/pages/fluxlite/FluxLitePage.tsx` to render `HistoryPage` and `ModelsPage` for their respective tabs.

- [ ] **Step 5: Test history table and model management**

Verify capture history loads, model list displays, packaging works end-to-end.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add history page, models page, and model packager"
```

---

## Task 13: Toast System + Error Handling

**Files:**
- Create: `src/components/shared/Toast.tsx`
- Modify: `src/App.tsx` (mount toast container)

- [ ] **Step 1: Create Toast component**

Create `src/components/shared/Toast.tsx`:
- Reads from `uiStore.toasts`
- Renders toasts in bottom-right corner
- Auto-dismiss after 5 seconds
- Color-coded by type (success=green, error=red, warning=yellow, info=blue)

- [ ] **Step 2: Mount toast container in App**

Update `src/App.tsx` to render `<ToastContainer />` at the root level.

- [ ] **Step 3: Wire error handling into useSocket**

Review `src/hooks/useSocket.ts` — ensure all `status: 'error'` responses route to `uiStore.addToast()`. Add handlers for DynamoPy crash and Socket.IO disconnect that show appropriate toasts.

- [ ] **Step 4: Test error scenarios**

Manually test: disconnect DynamoPy mid-session, send a bad command, verify toasts appear.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add toast notification system and error handling"
```

---

## Task 14: Updater — electron-updater + DynamoPy Hot-Update

**Files:**
- Create: `electron/updater.ts`
- Modify: `electron/main.ts` (integrate updater)

- [ ] **Step 1: Create updater module**

Create `electron/updater.ts`:
- **Full app**: Initialize `electron-updater`, check for updates on launch, send `updater:available` IPC event to renderer
- **DynamoPy hot-update**: Fetch latest release from `https://api.github.com/repos/Axioforce/AxioforceDynamoPy/releases/latest`, compare tag to local version file, download zip if newer, extract to DynamoPy directory

- [ ] **Step 2: Integrate updater into main process**

Update `electron/main.ts` to call updater init after window creation.

- [ ] **Step 3: Add update notification to UI**

Add a small update banner or toast in the renderer when `onUpdateAvailable` fires.

- [ ] **Step 4: Test update check**

Verify the app checks GitHub releases on launch and handles the case where no update is available (no error).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add two-tier update system (electron-updater + DynamoPy hot-update)"
```

---

## Task 15: Build Configuration + Packaging

**Files:**
- Create: `electron-builder.yml`
- Modify: `package.json` (build scripts)

- [ ] **Step 1: Create electron-builder config**

Create `electron-builder.yml`:
```yaml
appId: com.axioforce.fluxdeluxe
productName: FluxDeluxe
directories:
  output: output
files:
  - dist/**/*
  - dist-electron/**/*
extraResources:
  - from: fluxdeluxe/DynamoPy
    to: fluxdeluxe/DynamoPy
  - from: python
    to: python
win:
  target: nsis
  icon: assets/icon.ico
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
publish:
  provider: github
  owner: calebkmiecik
  repo: FluxDeluxe
```

- [ ] **Step 2: Add build scripts to package.json**

```json
{
  "scripts": {
    "build": "electron-vite build",
    "package": "npm run build && electron-builder --win",
    "release": "npm run build && electron-builder --win --publish always"
  }
}
```

- [ ] **Step 3: Test the build**

```bash
npm run build
```

Verify it compiles without errors. A full `npm run package` can be tested when ready to produce an installer.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add electron-builder config for Windows packaging"
```

---

## Task 16: DynamoPy GitHub Action — Auto-Tagging

**Note:** This task is done on the `AxioforceDynamoPy` repo, not FluxDeluxe. It can be executed independently.

**Files:**
- Create (in DynamoPy repo): `.github/workflows/auto-release.yml`, `app/__version__.py`

- [ ] **Step 1: Add version file to DynamoPy**

Create `app/__version__.py`:
```python
__version__ = "1.3.1"
```

- [ ] **Step 2: Create GitHub Action**

Create `.github/workflows/auto-release.yml`:
```yaml
name: Auto Release
on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Read version
        id: version
        run: echo "version=$(python -c "exec(open('app/__version__.py').read()); print(__version__)")" >> $GITHUB_OUTPUT

      - name: Check if tag exists
        id: check_tag
        run: |
          if git rev-parse "v${{ steps.version.outputs.version }}" >/dev/null 2>&1; then
            echo "exists=true" >> $GITHUB_OUTPUT
          else
            echo "exists=false" >> $GITHUB_OUTPUT
          fi

      - name: Create release
        if: steps.check_tag.outputs.exists == 'false'
        uses: softprops/action-gh-release@v2
        with:
          tag_name: v${{ steps.version.outputs.version }}
          generate_release_notes: true
          make_latest: true
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 3: Commit and push to DynamoPy**

```bash
cd fluxdeluxe/DynamoPy
git add -A
git commit -m "feat: add auto-release GitHub Action and version file"
git push origin main
```

- [ ] **Step 4: Verify action runs**

Check the Actions tab on the DynamoPy repo. Confirm a release is created with the correct version tag.

---

## Execution Order

Tasks 1-8 are sequential (each builds on the previous). Tasks 9-10 can run in parallel. Tasks 11-13 are sequential after 10. Tasks 14-16 are independent of each other and can be done in any order after Task 8.

```
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 ──┬── 9 ──┬── 10 → 11 → 12 → 13
                                    │       │
                                    │  (parallel)
                                    │
                                    ├── 14 (independent)
                                    ├── 15 (independent)
                                    └── 16 (independent, DynamoPy repo)
```
