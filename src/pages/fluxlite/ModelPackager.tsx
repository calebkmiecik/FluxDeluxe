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
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={() => setShowModelPackager(false)}
    >
      <div
        className="bg-card border border-border/70 rounded-xl shadow-2xl p-6 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold tracking-tight mb-4">Package Model</h2>

        <div className="flex flex-col gap-3 mb-6">
          <DirectoryField
            label="Force Model Directory"
            value={forceModelDir}
            setValue={setForceModelDir}
            placeholder="/path/to/force/model"
            dialogTitle="Select force model directory"
          />
          <DirectoryField
            label="Moments Model Directory"
            value={momentsModelDir}
            setValue={setMomentsModelDir}
            placeholder="/path/to/moments/model"
            dialogTitle="Select moments model directory"
          />
          <DirectoryField
            label="Output Directory"
            value={outputDir}
            setValue={setOutputDir}
            placeholder="/path/to/output"
            dialogTitle="Select output directory"
          />
        </div>

        <p className="telemetry-label uppercase text-muted-foreground mb-4">
          Device will be derived from model filenames
        </p>

        <div className="flex gap-3 justify-end">
          <button
            onClick={() => setShowModelPackager(false)}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors bg-transparent border-none"
          >
            Cancel
          </button>
          <button
            onClick={handlePackage}
            disabled={packaging || !forceModelDir || !momentsModelDir || !outputDir}
            className="px-4 py-2 text-sm border rounded-md bg-transparent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              borderColor: '#7AB8FF',
              color: '#7AB8FF',
            }}
            onMouseEnter={(e) => {
              if (!packaging && forceModelDir && momentsModelDir && outputDir) {
                (e.currentTarget as HTMLButtonElement).style.background = '#7AB8FF14'
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
            }}
          >
            {packaging ? 'Packaging…' : 'Package'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DirectoryField({
  label,
  value,
  setValue,
  placeholder,
  dialogTitle,
}: {
  label: string
  value: string
  setValue: (v: string) => void
  placeholder: string
  dialogTitle: string
}) {
  const handleBrowse = async () => {
    const api = window.electronAPI
    if (!api?.openDirectoryDialog) {
      console.warn('[ModelPackager] openDirectoryDialog not available — running in non-Electron context?')
      return
    }
    const selected = await api.openDirectoryDialog(dialogTitle)
    if (selected) setValue(selected)
  }
  return (
    <div>
      <label className="telemetry-label uppercase mb-1 block">{label}</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="flex-1 min-w-0 px-3 py-2 bg-background border border-border/60 rounded-md text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-[#7AB8FF] transition-colors"
        />
        <button
          type="button"
          onClick={handleBrowse}
          className="flex-shrink-0 px-3 py-2 text-xs border border-border/60 rounded-md bg-transparent text-muted-foreground hover:border-[#7AB8FF] hover:text-[#7AB8FF] transition-colors"
          title="Browse for folder"
        >
          Browse…
        </button>
      </div>
    </div>
  )
}
