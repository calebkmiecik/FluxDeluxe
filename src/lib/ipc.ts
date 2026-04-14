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
