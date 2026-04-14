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
