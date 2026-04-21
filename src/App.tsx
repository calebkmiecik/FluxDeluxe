import { useSocket } from './hooks/useSocket'
import { FluxLitePage } from './pages/fluxlite/FluxLitePage'
import { ToastContainer } from './components/shared/Toast'
import { BackendRestartBanner } from './components/shared/BackendRestartBanner'

export default function App() {
  useSocket()

  return (
    <div className="flex h-screen w-screen bg-background text-foreground">
      <main className="flex-1 flex overflow-hidden">
        <FluxLitePage />
      </main>
      <ToastContainer />
      <BackendRestartBanner />
    </div>
  )
}
