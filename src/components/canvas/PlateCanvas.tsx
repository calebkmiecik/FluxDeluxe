import { useRef, useEffect, useCallback } from 'react'
import {
  PLATE_DIMENSIONS,
  GRID_DIMS,
  COLOR_BIN_RGBA,
} from '../../lib/types'
import {
  mapCellForDevice,
  mapCellForRotation,
  invertRotation,
  invertDeviceMapping,
} from '../../lib/plateGeometry'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlateCanvasProps {
  deviceType: string // '06', '07', '08', '11', '12'
  rotation: number // 0-3 (quadrants, 0=0deg, 1=90deg, 2=180deg, 3=270deg)
  cellColors: Map<string, string> // "row,col" -> color bin name
  cellTexts: Map<string, string> // "row,col" -> display text
  activeCell: { row: number; col: number } | null
  onCellClick: (row: number, col: number) => void
  onRotate: () => void
  onTare: () => void
  onRefresh: () => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rgbaStr(rgba: [number, number, number, number]): string {
  return `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${(rgba[3] / 255).toFixed(2)})`
}

/**
 * Compute the plate rectangle (in canvas pixel space) so it fills ~80% of the
 * canvas while preserving aspect ratio.
 */
function computePlateRect(
  canvasW: number,
  canvasH: number,
  plateW: number,
  plateH: number,
) {
  const TARGET = 0.8
  const scaleW = (canvasW * TARGET) / plateW
  const scaleH = (canvasH * TARGET) / plateH
  const scale = Math.min(scaleW, scaleH)

  const rectW = plateW * scale
  const rectH = plateH * scale
  const x = (canvasW - rectW) / 2
  const y = (canvasH - rectH) / 2

  return { x, y, w: rectW, h: rectH, scale }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PlateCanvas({
  deviceType,
  rotation,
  cellColors,
  cellTexts,
  activeCell,
  onCellClick,
  onRotate,
  onTare,
  onRefresh,
}: PlateCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // ---- drawing ------------------------------------------------------------
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const cw = canvas.width
    const ch = canvas.height
    if (cw <= 0 || ch <= 0) return

    // Clear
    ctx.clearRect(0, 0, cw, ch)

    // Plate physical dimensions (mm). Swap w/h for 90/270 rotation.
    const dims = PLATE_DIMENSIONS[deviceType] ?? { width: 400, height: 400 }
    const rotated = rotation % 2 === 1
    const plateW = rotated ? dims.height : dims.width
    const plateH = rotated ? dims.width : dims.height

    // Grid dimensions (canonical, never swapped)
    const grid = GRID_DIMS[deviceType] ?? { rows: 3, cols: 3 }

    // After rotation the display grid rows/cols may swap
    const displayRows = rotated ? grid.cols : grid.rows
    const displayCols = rotated ? grid.rows : grid.cols

    const rect = computePlateRect(cw, ch, plateW, plateH)

    // --- plate background ---
    ctx.fillStyle = '#afb4be'
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h)

    // --- cell dimensions ---
    const cellW = rect.w / displayCols
    const cellH = rect.h / displayRows

    // --- cell fills + text ---
    for (const [key, bin] of cellColors.entries()) {
      const [canonR, canonC] = key.split(',').map(Number)
      if (isNaN(canonR) || isNaN(canonC)) continue

      // Map canonical -> device -> rotation to get display position
      const [dr, dc] = mapCellForDevice(canonR, canonC, grid.rows, grid.cols, deviceType)
      const [dispR, dispC] = mapCellForRotation(dr, dc, grid.rows, grid.cols, rotation)

      const rgba = COLOR_BIN_RGBA[bin]
      if (rgba) {
        ctx.fillStyle = rgbaStr(rgba)
        ctx.fillRect(
          rect.x + dispC * cellW,
          rect.y + dispR * cellH,
          cellW,
          cellH,
        )
      }
    }

    // --- cell text ---
    const fontSize = Math.max(10, Math.min(cellW, cellH) * 0.25)
    ctx.font = `bold ${fontSize}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#1a1a1a'

    for (const [key, text] of cellTexts.entries()) {
      const [canonR, canonC] = key.split(',').map(Number)
      if (isNaN(canonR) || isNaN(canonC)) continue

      const [dr, dc] = mapCellForDevice(canonR, canonC, grid.rows, grid.cols, deviceType)
      const [dispR, dispC] = mapCellForRotation(dr, dc, grid.rows, grid.cols, rotation)

      ctx.fillText(
        text,
        rect.x + dispC * cellW + cellW / 2,
        rect.y + dispR * cellH + cellH / 2,
      )
    }

    // --- grid lines ---
    ctx.strokeStyle = '#555'
    ctx.lineWidth = 1
    for (let r = 0; r <= displayRows; r++) {
      const yy = rect.y + r * cellH
      ctx.beginPath()
      ctx.moveTo(rect.x, yy)
      ctx.lineTo(rect.x + rect.w, yy)
      ctx.stroke()
    }
    for (let c = 0; c <= displayCols; c++) {
      const xx = rect.x + c * cellW
      ctx.beginPath()
      ctx.moveTo(xx, rect.y)
      ctx.lineTo(xx, rect.y + rect.h)
      ctx.stroke()
    }

    // --- plate border ---
    ctx.strokeStyle = '#333'
    ctx.lineWidth = 2
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)

    // --- active cell highlight ---
    if (activeCell) {
      const [dr, dc] = mapCellForDevice(
        activeCell.row,
        activeCell.col,
        grid.rows,
        grid.cols,
        deviceType,
      )
      const [dispR, dispC] = mapCellForRotation(dr, dc, grid.rows, grid.cols, rotation)

      ctx.strokeStyle = '#00bfff'
      ctx.lineWidth = 3
      ctx.strokeRect(
        rect.x + dispC * cellW + 1,
        rect.y + dispR * cellH + 1,
        cellW - 2,
        cellH - 2,
      )
    }
  }, [deviceType, rotation, cellColors, cellTexts, activeCell])

  // ---- click handling -----------------------------------------------------
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return

      const bounds = canvas.getBoundingClientRect()
      const scaleX = canvas.width / bounds.width
      const scaleY = canvas.height / bounds.height
      const px = (e.clientX - bounds.left) * scaleX
      const py = (e.clientY - bounds.top) * scaleY

      const dims = PLATE_DIMENSIONS[deviceType] ?? { width: 400, height: 400 }
      const rotated = rotation % 2 === 1
      const plateW = rotated ? dims.height : dims.width
      const plateH = rotated ? dims.width : dims.height

      const grid = GRID_DIMS[deviceType] ?? { rows: 3, cols: 3 }
      const displayRows = rotated ? grid.cols : grid.rows
      const displayCols = rotated ? grid.rows : grid.cols

      const rect = computePlateRect(canvas.width, canvas.height, plateW, plateH)

      // Check bounds
      if (px < rect.x || px > rect.x + rect.w || py < rect.y || py > rect.y + rect.h) {
        return
      }

      const cellW = rect.w / displayCols
      const cellH = rect.h / displayRows
      const dispC = Math.min(displayCols - 1, Math.floor((px - rect.x) / cellW))
      const dispR = Math.min(displayRows - 1, Math.floor((py - rect.y) / cellH))

      // Invert: display -> undo rotation -> undo device mapping -> canonical
      const [invR, invC] = invertRotation(dispR, dispC, grid.rows, grid.cols, rotation)
      const [canonR, canonC] = invertDeviceMapping(invR, invC, grid.rows, grid.cols, deviceType)

      onCellClick(canonR, canonC)
    },
    [deviceType, rotation, onCellClick],
  )

  // ---- resize observer ----------------------------------------------------
  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const resizeCanvas = () => {
      const { width, height } = container.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      draw()
    }

    const observer = new ResizeObserver(resizeCanvas)
    observer.observe(container)
    resizeCanvas()

    return () => observer.disconnect()
  }, [draw])

  // ---- redraw on prop changes ---------------------------------------------
  useEffect(() => {
    draw()
  }, [draw])

  // ---- render -------------------------------------------------------------
  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[200px]">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        className="absolute inset-0 w-full h-full cursor-crosshair"
      />

      {/* Quick action buttons — bottom-right overlay */}
      <div className="absolute bottom-3 right-3 flex gap-1.5">
        <button
          onClick={onRefresh}
          title="Refresh devices"
          className="w-8 h-8 rounded bg-white/10 hover:bg-white/20 text-zinc-300 hover:text-white text-base font-bold flex items-center justify-center transition-colors"
        >
          &#x21bb;
        </button>
        <button
          onClick={onTare}
          title="Tare (zero)"
          className="w-8 h-8 rounded bg-white/10 hover:bg-white/20 text-zinc-300 hover:text-white text-xs font-bold flex items-center justify-center transition-colors"
        >
          0.0
        </button>
        <button
          onClick={onRotate}
          title="Rotate plate 90 degrees"
          className="w-8 h-8 rounded bg-white/10 hover:bg-white/20 text-zinc-300 hover:text-white text-base font-bold flex items-center justify-center transition-colors"
        >
          &#x27F3;
        </button>
      </div>
    </div>
  )
}
