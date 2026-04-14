import { useState, useEffect } from 'react'
import { getSocket } from '../../lib/socket'
import type { SocketResponse } from '../../lib/types'

interface CaptureRecord {
  captureId: string
  captureType: string
  athleteId?: string
  timestamp: number
  deviceId?: string
  tags?: string[]
}

export function HistoryPage() {
  const [captures, setCaptures] = useState<CaptureRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    const socket = getSocket()

    const handler = (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success' && Array.isArray(resp.data)) {
        setCaptures(resp.data as CaptureRecord[])
      }
      setLoading(false)
    }

    socket.on('getCaptureMetadataStatus', handler)
    socket.emit('getCaptureMetadata', {})

    return () => { socket.off('getCaptureMetadataStatus', handler) }
  }, [])

  const filtered = search
    ? captures.filter((c) =>
        c.captureId.toLowerCase().includes(search.toLowerCase()) ||
        c.captureType.toLowerCase().includes(search.toLowerCase()) ||
        (c.athleteId || '').toLowerCase().includes(search.toLowerCase())
      )
    : captures

  return (
    <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Capture History</h2>
        <input
          type="text"
          placeholder="Search captures..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 bg-background border border-border rounded text-sm text-white placeholder-zinc-500 w-64"
        />
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="text-zinc-400">Loading captures...</p>
        ) : filtered.length === 0 ? (
          <p className="text-zinc-400">No captures found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-400 border-b border-border">
                <th className="pb-2 pr-4">ID</th>
                <th className="pb-2 pr-4">Type</th>
                <th className="pb-2 pr-4">Athlete</th>
                <th className="pb-2 pr-4">Date</th>
                <th className="pb-2">Tags</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((cap) => (
                <tr key={cap.captureId} className="border-b border-border/50 hover:bg-white/5 cursor-pointer">
                  <td className="py-2 pr-4 font-mono text-xs">{cap.captureId.slice(0, 8)}</td>
                  <td className="py-2 pr-4">{cap.captureType}</td>
                  <td className="py-2 pr-4">{cap.athleteId || '—'}</td>
                  <td className="py-2 pr-4">{new Date(cap.timestamp).toLocaleDateString()}</td>
                  <td className="py-2">{(cap.tags || []).join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
