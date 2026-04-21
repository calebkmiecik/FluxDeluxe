import { create } from 'zustand'

interface Toast {
  id: string
  message: string
  type: 'info' | 'success' | 'error' | 'warning'
}

interface UiStoreState {
  activeLitePage: 'live' | 'history' | 'models'
  toasts: Toast[]
  backendLogs: string[]
  showDevicePicker: boolean
  showModelPackager: boolean
  backendRestartPending: boolean
  setActiveLitePage: (page: UiStoreState['activeLitePage']) => void
  addToast: (toast: Omit<Toast, 'id'>) => void
  dismissToast: (id: string) => void
  pushBackendLog: (line: string) => void
  setShowDevicePicker: (show: boolean) => void
  setShowModelPackager: (show: boolean) => void
  setBackendRestartPending: (pending: boolean) => void
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback for environments without crypto.randomUUID (e.g. jsdom in some setups)
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export const useUiStore = create<UiStoreState>()((set) => ({
  activeLitePage: 'live',
  toasts: [],
  backendLogs: [],
  showDevicePicker: false,
  showModelPackager: false,
  backendRestartPending: false,
  setActiveLitePage: (activeLitePage) => set({ activeLitePage }),
  setBackendRestartPending: (backendRestartPending) => set({ backendRestartPending }),
  addToast: (toast) =>
    set((s) => ({ toasts: [...s.toasts, { ...toast, id: generateId() }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  pushBackendLog: (line) =>
    set((s) => ({
      backendLogs: s.backendLogs.length >= 500
        ? [...s.backendLogs.slice(1), line]
        : [...s.backendLogs, line],
    })),
  setShowDevicePicker: (showDevicePicker) => set({ showDevicePicker }),
  setShowModelPackager: (showModelPackager) => set({ showModelPackager }),
}))
