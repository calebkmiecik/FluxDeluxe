import { useRef, useEffect } from 'react'
import { useAnimationFrame } from '../../hooks/useAnimationFrame'
import { useLiveDataStore } from '../../stores/liveDataStore'
import { useDeviceStore } from '../../stores/deviceStore'
import { canvas as C } from '../../lib/theme'

const WINDOW_SEC = 5
const MAX_SAMPLES = 3000

interface Sample {
  wallT: number  // performance.now() when this sample was placed on the timeline
  fz: number
}

export function ForcePlot() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sizeRef = useRef({ width: 0, height: 0 })
  const samplesRef = useRef<Sample[]>([])
  const lastBufferSizeRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      canvas.width = width * devicePixelRatio
      canvas.height = height * devicePixelRatio
      sizeRef.current = { width, height }
    })
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])

  useAnimationFrame(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const { width, height } = sizeRef.current
    if (width === 0 || height === 0) return

    const dpr = devicePixelRatio
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const store = useLiveDataStore.getState()
    const bufferSize = store.frameBuffer.size
    const selectedId = useDeviceStore.getState().selectedDeviceId
    const samples = samplesRef.current
    const now = performance.now()

    // --- Ingest new frames when buffer has grown ---
    if (bufferSize !== lastBufferSizeRef.current) {
      const allFrames = store.frameBuffer.toArray()
      lastBufferSizeRef.current = bufferSize

      // Get new frames for the selected device
      // Use _receivedAt as the base time, but spread frames within a batch
      // using backend timestamps to give each a unique position
      const newFrames = selectedId
        ? allFrames.filter((f) => f.id === selectedId)
        : allFrames

      if (newFrames.length > 0) {
        // Find frames newer than what we already have
        const lastWallT = samples.length > 0 ? samples[samples.length - 1].wallT : 0

        // Group by _receivedAt (batch detection)
        let batchStart = 0
        for (let i = 0; i < newFrames.length; i++) {
          const f = newFrames[i]

          // Spread frames within a batch:
          // If multiple frames share the same _receivedAt, spread them
          // evenly across a small time span (~16ms = one render frame)
          let wallT = f._receivedAt

          // Look ahead to count batch size
          if (i === batchStart) {
            let batchEnd = i + 1
            while (batchEnd < newFrames.length && newFrames[batchEnd]._receivedAt === f._receivedAt) {
              batchEnd++
            }
            const batchSize = batchEnd - batchStart
            if (batchSize > 1) {
              // Spread across ~16ms
              const spread = 16
              const idx = i - batchStart
              wallT = f._receivedAt + (idx / (batchSize - 1)) * spread
            }
            if (i === batchEnd - 1) {
              batchStart = batchEnd
            }
          } else {
            // Mid-batch: find our position
            let bs = i
            while (bs > 0 && newFrames[bs - 1]._receivedAt === f._receivedAt) bs--
            let be = i
            while (be < newFrames.length - 1 && newFrames[be + 1]._receivedAt === f._receivedAt) be++
            const batchSize = be - bs + 1
            const idx = i - bs
            wallT = f._receivedAt + (batchSize > 1 ? (idx / (batchSize - 1)) * 16 : 0)
          }

          if (wallT > lastWallT) {
            samples.push({ wallT, fz: f.fz })
          }
        }

        // Trim old samples
        if (samples.length > MAX_SAMPLES) {
          samplesRef.current = samples.slice(samples.length - MAX_SAMPLES)
        }
      }
    }

    // --- Draw ---
    ctx.fillStyle = C.bg
    ctx.fillRect(0, 0, width, height)

    if (samples.length === 0) {
      ctx.fillStyle = C.noDataText
      ctx.font = '14px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(selectedId ? 'Waiting for data...' : 'No device selected', width / 2, height / 2)
      return
    }

    const padding = { top: 20, right: 20, bottom: 30, left: 60 }
    const plotW = width - padding.left - padding.right
    const plotH = height - padding.top - padding.bottom

    // Sliding window: right = now, left = now - WINDOW_SEC
    const tMax = now
    const tMin = now - WINDOW_SEC * 1000

    // Y auto-scale from visible samples
    let maxFz = 0
    for (let i = samples.length - 1; i >= 0; i--) {
      if (samples[i].wallT < tMin) break
      const abs = Math.abs(samples[i].fz)
      if (abs > maxFz) maxFz = abs
    }
    maxFz = Math.max(maxFz * 1.15, 10)

    // H grid + Y labels
    ctx.strokeStyle = C.gridLine
    ctx.lineWidth = 0.5
    for (let i = 0; i <= 5; i++) {
      const y = padding.top + (plotH * i) / 5
      ctx.beginPath()
      ctx.moveTo(padding.left, y)
      ctx.lineTo(width - padding.right, y)
      ctx.stroke()
      const val = maxFz - (maxFz * 2 * i) / 5
      ctx.fillStyle = C.axisLabel
      ctx.font = '11px sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText(`${val.toFixed(0)}N`, padding.left - 8, y + 4)
    }

    // V grid + X labels
    for (let i = 0; i <= 5; i++) {
      const x = padding.left + (plotW * i) / 5
      ctx.beginPath()
      ctx.moveTo(x, padding.top)
      ctx.lineTo(x, padding.top + plotH)
      ctx.stroke()
    }
    ctx.fillStyle = C.axisLabel
    ctx.font = '11px sans-serif'
    ctx.textAlign = 'center'
    for (let i = 0; i <= 5; i++) {
      const x = padding.left + (plotW * i) / 5
      const sec = -WINDOW_SEC + (WINDOW_SEC * i) / 5
      ctx.fillText(`${sec.toFixed(1)}s`, x, height - 8)
    }

    // Clip + draw
    ctx.save()
    ctx.beginPath()
    ctx.rect(padding.left, padding.top, plotW, plotH)
    ctx.clip()

    ctx.strokeStyle = C.dataLine
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.beginPath()

    let started = false
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i]
      if (s.wallT < tMin) continue
      if (s.wallT > tMax) break

      const x = padding.left + ((s.wallT - tMin) / (tMax - tMin)) * plotW
      const nFz = (s.fz + maxFz) / (2 * maxFz)
      const y = padding.top + plotH * (1 - nFz)

      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else {
        ctx.lineTo(x, y)
      }
    }
    if (started) ctx.stroke()

    ctx.restore()
  })

  return (
    <div className="w-full h-full relative">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  )
}
