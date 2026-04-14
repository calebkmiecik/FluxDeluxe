import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { DynamoManager } from './dynamo'
import { initUpdater } from './updater'

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
  dynamo.start()

  initUpdater(mainWindow)

  ipcMain.removeHandler('app:version')
  ipcMain.handle('app:version', () => app.getVersion())
}

app.whenReady().then(createWindow)

app.on('window-all-closed', async () => {
  await dynamo?.stop()
  app.quit()
})
