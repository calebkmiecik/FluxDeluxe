import { useSocket } from './hooks/useSocket'
import { FluxLitePage } from './pages/fluxlite/FluxLitePage'
import { ToastContainer } from './components/shared/Toast'

export default function App() {
  useSocket()

  return (
    <div className="flex h-screen w-screen bg-background text-foreground">
      <main className="flex-1 flex overflow-hidden">
        <FluxLitePage />
      </main>
      <ToastContainer />
    </div>
  )
}
