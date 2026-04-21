import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  getDynamoStatus: () => ipcRenderer.invoke('dynamo:status'),
  getDynamoLogs: () => ipcRenderer.invoke('dynamo:get-logs'),
  restartDynamo: () => ipcRenderer.invoke('dynamo:restart'),
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  openDirectoryDialog: (title?: string) => ipcRenderer.invoke('dialog:openDirectory', title),
  onDynamoLog: (callback: (log: string) => void) =>
    ipcRenderer.on('dynamo:log', (_event, log) => callback(log)),
  onDynamoStatusChange: (callback: (status: string) => void) =>
    ipcRenderer.on('dynamo:status-change', (_event, status) => callback(status)),
  onUpdateAvailable: (callback: (info: unknown) => void) =>
    ipcRenderer.on('updater:available', (_event, info) => callback(info)),

  // Live test persistence
  liveTest: {
    saveSession: (payload: unknown) => ipcRenderer.invoke('liveTest:saveSession', payload),
    listSessions: (opts: unknown) => ipcRenderer.invoke('liveTest:listSessions', opts),
    getSession: (id: string) => ipcRenderer.invoke('liveTest:getSession', id),
    getOverview: (opts: unknown) => ipcRenderer.invoke('liveTest:getOverview', opts),
    getTimeSeries: (opts: unknown) => ipcRenderer.invoke('liveTest:getTimeSeries', opts),
    retryQueued: () => ipcRenderer.invoke('liveTest:retryQueued'),
    queueStatus: () => ipcRenderer.invoke('liveTest:queueStatus'),
  },
})
