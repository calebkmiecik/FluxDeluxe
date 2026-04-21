import { useState } from 'react'
import { useUiStore } from '../../stores/uiStore'
import { getSocket } from '../../lib/socket'

export function ModelPackager() {
  const showModelPackager = useUiStore((s) => s.showModelPackager)
  const setShowModelPackager = useUiStore((s) => s.setShowModelPackager)
  const [forceModelDir, setForceModelDir] = useState('')
  const [momentsModelDir, setMomentsModelDir] = useState('')
  const [outputDir, setOutputDir] = useState('')
  const [packaging, setPackaging] = useState(false)

  if (!showModelPackager) return null

  const handlePackage = () => {
    if (!forceModelDir || !momentsModelDir || !outputDir) return
    setPackaging(true)
    getSocket().emit('packageModel', { forceModelDir, momentsModelDir, outputDir })
    // The modelPackageStatus event will be handled by useSocket and show a toast
    setTimeout(() => {
      setPackaging(false)
      setShowModelPackager(false)
    }, 2000)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowModelPackager(false)}>
      <div className="bg-card border border-border rounded-xl shadow-xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold tracking-tight mb-4">Package Model</h2>

        <div className="flex flex-col gap-3 mb-6">
          <div>
            <label className="telemetry-label uppercase mb-1 block">Force Model Directory</label>
            <input
              type="text"
              value={forceModelDir}
              onChange={(e) => setForceModelDir(e.target.value)}
              placeholder="/path/to/force/model"
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <div>
            <label className="telemetry-label uppercase mb-1 block">Moments Model Directory</label>
            <input
              type="text"
              value={momentsModelDir}
              onChange={(e) => setMomentsModelDir(e.target.value)}
              placeholder="/path/to/moments/model"
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <div>
            <label className="telemetry-label uppercase mb-1 block">Output Directory</label>
            <input
              type="text"
              value={outputDir}
              onChange={(e) => setOutputDir(e.target.value)}
              placeholder="/path/to/output"
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground"
            />
          </div>
        </div>

        <div className="flex gap-3 justify-end">
          <button onClick={() => setShowModelPackager(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            Cancel
          </button>
          <button
            onClick={handlePackage}
            disabled={packaging || !forceModelDir || !momentsModelDir || !outputDir}
            className="px-4 py-2 text-sm bg-primary text-white rounded-md btn-glow disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {packaging ? 'Packaging...' : 'Package'}
          </button>
        </div>
      </div>
    </div>
  )
}
