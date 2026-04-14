import { useSocket } from './hooks/useSocket'
import { useUiStore } from './stores/uiStore'
import { Sidebar } from './components/shared/Sidebar'
import { Launcher } from './pages/Launcher'
import { FluxLitePage } from './pages/fluxlite/FluxLitePage'
import { ToastContainer } from './components/shared/Toast'

export default function App() {
  useSocket()
  const currentPage = useUiStore((s) => s.currentPage)

  return (
    <div className="flex h-screen w-screen bg-background text-foreground">
      <Sidebar />
      <main className="flex-1 flex overflow-hidden">
        {currentPage === 'launcher' && <Launcher />}
        {currentPage === 'fluxlite' && <FluxLitePage />}
      </main>
      <ToastContainer />
    </div>
  )
}
