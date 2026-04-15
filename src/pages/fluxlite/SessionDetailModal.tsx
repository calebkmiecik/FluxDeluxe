export function SessionDetailModal({ id: _id, onClose }: { id: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-card border border-border rounded-md p-6" onClick={(e) => e.stopPropagation()}>
        <p className="text-muted-foreground">Session detail — coming next.</p>
        <button onClick={onClose} className="mt-4 px-3 py-1.5 text-sm border border-border rounded-md">Close</button>
      </div>
    </div>
  )
}
