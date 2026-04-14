import { useEffect } from 'react'
import { useUiStore } from '../../stores/uiStore'

const TYPE_STYLES = {
  success: 'border-l-4 border-l-success bg-success/10',
  error: 'border-l-4 border-l-danger bg-danger/10',
  warning: 'border-l-4 border-l-warning bg-warning/10',
  info: 'border-l-4 border-l-primary bg-primary/10',
} as const

export function ToastContainer() {
  const toasts = useUiStore((s) => s.toasts)
  const dismissToast = useUiStore((s) => s.dismissToast)

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          id={toast.id}
          message={toast.message}
          type={toast.type}
          onDismiss={dismissToast}
        />
      ))}
    </div>
  )
}

function ToastItem({ id, message, type, onDismiss }: {
  id: string
  message: string
  type: 'info' | 'success' | 'error' | 'warning'
  onDismiss: (id: string) => void
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(id), 5000)
    return () => clearTimeout(timer)
  }, [id, onDismiss])

  return (
    <div
      className={`${TYPE_STYLES[type]} bg-surface border border-border rounded px-4 py-3 shadow-lg cursor-pointer animate-in slide-in-from-right`}
      onClick={() => onDismiss(id)}
    >
      <p className="text-sm text-white">{message}</p>
    </div>
  )
}
