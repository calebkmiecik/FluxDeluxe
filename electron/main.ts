import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { DynamoManager } from './dynamo'
import { initUpdater } from './updater'
import { createLiveTestDeps, registerLiveTestIpc, runRetryOnStart } from './ipc/liveTest'

let mainWindow: BrowserWindow | null = null
let dynamo: DynamoManager | null = null
let isQuitting = false

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'FluxDeluxe',
    backgroundColor: '#121212',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  dynamo = new DynamoManager(mainWindow)
  dynamo.start().catch((err) => console.warn('[main] dynamo.start failed:', err))

  initUpdater(mainWindow)

  ipcMain.removeHandler('app:version')
  ipcMain.handle('app:version', () => app.getVersion())

  // Live test persistence
  const liveTestDeps = createLiveTestDeps()
  registerLiveTestIpc(liveTestDeps)
  // Fire-and-forget retry on start
  runRetryOnStart(liveTestDeps).catch((err) => console.warn('[liveTest] retry failed:', err))
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  app.quit()
})

// Central shutdown: intercept every quit path (menu quit, window close, programmatic),
// stop the Python backend, then let the quit proceed. Without this, on Windows the
// child process survives Electron and holds port 3001 — next boot the new backend
// fails to bind and the renderer loads blank.
app.on('before-quit', (event) => {
  if (isQuitting || !dynamo) return
  event.preventDefault()
  isQuitting = true
  void (async () => {
    try {
      await dynamo?.stop()
    } catch (err) {
      console.warn('[main] dynamo.stop failed during quit:', err)
    }
    app.quit()
  })()
})
