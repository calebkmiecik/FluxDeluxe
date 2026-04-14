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
    // Dev mode: PYTHON_PATH env var takes priority
    if (process.env.PYTHON_PATH) return process.env.PYTHON_PATH
    // Try conda env: look for DYNAMO_CONDA_ENV or default to Dynamo3.11
    const condaEnv = process.env.DYNAMO_CONDA_ENV || 'Dynamo3.11'
    const home = process.env.USERPROFILE || ''
    const condaPython = path.join(home, 'miniconda3', 'envs', condaEnv, 'python.exe')
    try {
      require('fs').accessSync(condaPython)
      return condaPython
    } catch {
      // Fall back to bare python
      return 'python'
    }
  }

  private getScriptPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'fluxdeluxe', 'DynamoPy', 'app', 'main.py')
    }
    // In dev mode, app.getAppPath() points to out/main, not the project root.
    // Walk up from __dirname (out/main/) to reach the project root.
    return path.join(__dirname, '..', '..', 'fluxdeluxe', 'DynamoPy', 'app', 'main.py')
  }

  start(): void {
    if (this.process) return
    this.status = 'starting'
    this.notifyStatus()

    const pythonPath = this.getPythonPath()
    const scriptPath = this.getScriptPath()

    // DynamoPy root (for PYTHONPATH so `from app.` imports work)
    const dynamoRoot = path.dirname(path.dirname(scriptPath)) // .../DynamoPy/
    // DynamoPy's config resolves file_system relative to cwd as ../file_system
    // when APP_ENV=development, so cwd must be DynamoPy/app/
    const cwd = path.dirname(scriptPath) // .../DynamoPy/app/

    this.process = spawn(pythonPath, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
      env: { ...process.env, PYTHONPATH: dynamoRoot, APP_ENV: 'development' },
    })

    console.log(`[dynamo] python: ${pythonPath}`)
    console.log(`[dynamo] script: ${scriptPath}`)
    console.log(`[dynamo] cwd: ${cwd}`)
    console.log(`[dynamo] PYTHONPATH: ${dynamoRoot}`)
    console.log(`[dynamo] APP_ENV: development`)
    this.pushLog(`[dynamo] python: ${pythonPath}`)
    this.pushLog(`[dynamo] script: ${scriptPath}`)

    this.process.on('error', (err) => {
      console.error(`[dynamo] spawn error: ${err.message}`)
      this.pushLog(`[dynamo] spawn error: ${err.message}`)
      this.status = 'crashed'
      this.process = null
      this.notifyStatus()
    })

    this.process.stdout?.on('data', (data: Buffer) => {
      const line = data.toString().trim()
      if (line) {
        console.log(`[dynamo:stdout] ${line}`)
        this.pushLog(line)
        if (this.status === 'starting' && line.includes('Uvicorn running')) {
          this.status = 'running'
          this.notifyStatus()
        }
      }
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim()
      if (line) {
        console.error(`[dynamo:stderr] ${line}`)
        this.pushLog(`[stderr] ${line}`)
      }
    })

    this.process.on('exit', (code) => {
      console.log(`[dynamo] exited with code ${code}`)
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

  async restart(): Promise<void> {
    await this.stop()
    this.start()
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
