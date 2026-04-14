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
