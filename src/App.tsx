import { useSocket } from './hooks/useSocket'
import { useUiStore } from './stores/uiStore'
import { Sidebar } from './components/shared/Sidebar'
import { Launcher } from './pages/Launcher'

export default function App() {
  useSocket()
  const currentPage = useUiStore((s) => s.currentPage)

  return (
    <div className="flex h-screen w-screen bg-background text-white">
      <Sidebar />
      <main className="flex-1 flex overflow-hidden">
        {currentPage === 'launcher' && <Launcher />}
        {currentPage === 'fluxlite' && (
          <div className="flex-1 flex items-center justify-center text-zinc-400">
            FluxLite (coming next)
          </div>
        )}
      </main>
    </div>
  )
}
