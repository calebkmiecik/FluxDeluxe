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
