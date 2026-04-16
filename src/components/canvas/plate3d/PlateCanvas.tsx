/**
 * PlateCanvas — drop-in 3D replacement for the 2D plate canvas.
 *
 * Prop contract is identical to the old 2D PlateCanvas, plus one
 * optional `liveTesting` prop (see spec §3, §6.5).
 *
 * This shell file wires together:
 *   - three stacked canvases (z=0 2D / z=1 WebGL / z=2 2D)
 *   - PlateScene (WebGL meshes)
 *   - CameraController (camera state machine)
 *   - cellRaycaster (click → canonical cell)
 *   - cellOverlay (HUD chrome + projected text)
 */

import { useEffect, useRef, useCallback, forwardRef, CSSProperties } from 'react'
import * as THREE from 'three'
import { plate3d } from '../../../lib/theme'
import {
  PLATE_DIMENSIONS,
  GRID_DIMS,
  COLOR_BIN_RGBA,
} from '../../../lib/types'
import { PlateScene, waitForWebGL } from './PlateScene'
import {
  parsePlateJSON,
  splitEdgesByY,
  PlateGeometry,
  EdgeSegments,
} from './plateModelCache'
import { CameraController } from './cameraController'
import {
  hitPointToCanonicalCell,
  canonicalCellRect,
  Bounds,
} from './cellRaycaster'
import {
  drawBrackets,
  drawCellText,
  drawHoverReticle,
  projectToScreen,
} from './cellOverlay'
import {
  DEVICE_TO_PLATE_MODEL,
  DEFAULT_PLATE_MODEL,
  PlateModelKey,
  CLICK_MAX_MS,
  CLICK_MAX_PX,
  ACTIVE_PULSE_MS,
  HUD_FADE_MS,
} from './constants'

// Static JSON imports — Vite bundles all three into the renderer chunk.
import plateLiteJson from './assets/plate-lite.json'
import plateLaunchpadJson from './assets/plate-launchpad.json'
import plateXlJson from './assets/plate-xl.json'

const PLATE_JSON_BY_KEY: Record<PlateModelKey, unknown> = {
  lite: plateLiteJson,
  launchpad: plateLaunchpadJson,
  xl: plateXlJson,
}

export interface PlateCanvasProps {
  deviceType: string
  rotation: number
  cellColors: Map<string, string>
  cellTexts: Map<string, string>
  activeCell: { row: number; col: number } | null
  onCellClick: (row: number, col: number) => void
  onRotate: () => void
  onTare: () => void
  liveTesting?: boolean
}

function resolvePlateJson(deviceType: string): unknown {
  const key = DEVICE_TO_PLATE_MODEL[deviceType]
  if (!key) {
    console.warn(`[plate3d] unknown deviceType "${deviceType}", falling back to ${DEFAULT_PLATE_MODEL}`)
    return PLATE_JSON_BY_KEY[DEFAULT_PLATE_MODEL]
  }
  return PLATE_JSON_BY_KEY[key]
}

function cameraStateLabel(state: string): string {
  if (state === 'INTRO_SWOOP') return '◌ SWOOP'
  if (state === 'PEEK_ORBIT') return '⤴ PEEK'
  if (state === 'PEEK_RETURN') return '↺ RETURN'
  return '▲ TOP'
}

export function PlateCanvas({
  deviceType,
  rotation,
  cellColors,
  cellTexts,
  activeCell,
  onCellClick,
  onRotate,
  onTare,
  liveTesting = false,
}: PlateCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const edgeCanvasRef = useRef<HTMLCanvasElement>(null)   // z=0
  const webglCanvasRef = useRef<HTMLCanvasElement>(null)  // z=1
  const canvasRef = useRef<HTMLCanvasElement>(null)       // z=2

  const sceneRef = useRef<PlateScene | null>(null)
  const cameraRef = useRef<CameraController | null>(null)
  const geomRef = useRef<PlateGeometry | null>(null)
  const splitRef = useRef<{ upper: EdgeSegments | null; lower: EdgeSegments | null }>({ upper: null, lower: null })
  const fatalRef = useRef(false)

  // Render-loop data refs — keep the RAF loop stable across prop updates.
  // Without these, the loop would tear down every time cellColors / cellTexts /
  // activeCell / rotation change, which is very frequent during live testing.
  const propsRef = useRef({
    deviceType, rotation, cellColors, cellTexts, activeCell,
  })
  propsRef.current = { deviceType, rotation, cellColors, cellTexts, activeCell }

  const lastFrameRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)

  // Pointer state
  const pointerDownRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const isDraggingRef = useRef(false)
  const hoverCellRef = useRef<{ row: number; col: number; x: number; y: number } | null>(null)

  // HUD fade state
  const bracketOpacityRef = useRef(0)
  const hoverInsideRef = useRef(false)
  const gridOpacityRef = useRef(0)

  // Camera state button — updated imperatively in RAF to avoid per-frame re-renders
  const cameraStateButtonRef = useRef<HTMLButtonElement>(null)
  const lastCameraStateRef = useRef<string>('')

  // ── Parse plate JSON when deviceType changes ─────────────────────
  useEffect(() => {
    const json = resolvePlateJson(deviceType)
    geomRef.current = parsePlateJSON(json)
    splitRef.current = splitEdgesByY(geomRef.current.topPlateEdges)
    sceneRef.current?.buildPlateFill(geomRef.current.faces)
  }, [deviceType])

  // ── Feed rotation into camera controller ─────────────────────────
  useEffect(() => {
    cameraRef.current?.setRotation(rotation)
  }, [rotation])

  // ── Feed liveTesting into camera controller ──────────────────────
  useEffect(() => {
    cameraRef.current?.setLiveTesting(liveTesting)
  }, [liveTesting])

  // ── Init scene + camera controller ───────────────────────────────
  useEffect(() => {
    const wgl = webglCanvasRef.current
    if (!wgl) return
    let cancelled = false

    waitForWebGL().then(() => {
      if (cancelled) return
      try {
        sceneRef.current = new PlateScene({ canvas: wgl })
        if (geomRef.current) sceneRef.current.buildPlateFill(geomRef.current.faces)
        cameraRef.current = new CameraController({ fitDistance: 1.0 })
        cameraRef.current.setRotation(rotation)
        cameraRef.current.setLiveTesting(liveTesting)
      } catch (err) {
        console.error('[plate3d] scene init failed', err)
        fatalRef.current = true
      }
    }).catch(() => { fatalRef.current = true })

    return () => {
      cancelled = true
      sceneRef.current?.dispose()
      sceneRef.current = null
      cameraRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Resize handling ──────────────────────────────────────────────
  useEffect(() => {
    const c = containerRef.current
    const main = canvasRef.current
    const edge = edgeCanvasRef.current
    if (!c || !main || !edge) return

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = c.getBoundingClientRect()
      for (const cv of [main, edge]) {
        cv.width = rect.width * dpr
        cv.height = rect.height * dpr
        cv.style.width = `${rect.width}px`
        cv.style.height = `${rect.height}px`
        cv.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0)
      }
      sceneRef.current?.setSize(rect.width, rect.height, dpr)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(c)
    return () => ro.disconnect()
  }, [])

  // ── Pointer handling (click vs drag disambiguation) ──────────────
  const getPointerXY = (e: PointerEvent | React.PointerEvent, container: HTMLElement) => {
    const rect = container.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  useEffect(() => {
    const c = containerRef.current
    if (!c) return

    const onDown = (e: PointerEvent) => {
      if (fatalRef.current) return
      const p = getPointerXY(e, c)
      pointerDownRef.current = { x: p.x, y: p.y, t: performance.now() }
      isDraggingRef.current = false
    }
    const onMove = (e: PointerEvent) => {
      if (fatalRef.current) return
      const p = getPointerXY(e, c)
      // Hover tracking (for reticle)
      hoverInsideRef.current = true
      updateHoverCell(p.x, p.y)

      const dp = pointerDownRef.current
      if (!dp) return
      const dx = p.x - dp.x
      const dy = p.y - dp.y
      if (!isDraggingRef.current) {
        if (Math.abs(dx) > CLICK_MAX_PX || Math.abs(dy) > CLICK_MAX_PX) {
          // Engage drag (or reject if liveTesting locked)
          if (!liveTesting) {
            isDraggingRef.current = true
            cameraRef.current?.beginDrag()
          }
        }
      }
      if (isDraggingRef.current) {
        cameraRef.current?.applyDrag(dx, dy)
        pointerDownRef.current = { x: p.x, y: p.y, t: dp.t }
      }
    }
    const onUp = (e: PointerEvent) => {
      if (fatalRef.current) return
      const dp = pointerDownRef.current
      pointerDownRef.current = null
      if (!dp) return
      const p = getPointerXY(e, c)
      const dx = p.x - dp.x
      const dy = p.y - dp.y
      const elapsed = performance.now() - dp.t
      if (
        !isDraggingRef.current &&
        Math.abs(dx) <= CLICK_MAX_PX &&
        Math.abs(dy) <= CLICK_MAX_PX &&
        elapsed <= CLICK_MAX_MS
      ) {
        tryCellClick(p.x, p.y)
      }
      isDraggingRef.current = false
    }
    const onDblClick = () => {
      cameraRef.current?.dismissPeek()
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      cameraRef.current?.applyWheelZoom(e.deltaY)
    }
    const onEnter = () => { hoverInsideRef.current = true }
    const onLeave = () => {
      hoverInsideRef.current = false
      hoverCellRef.current = null
    }

    c.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    c.addEventListener('dblclick', onDblClick)
    c.addEventListener('wheel', onWheel, { passive: false })
    c.addEventListener('pointerenter', onEnter)
    c.addEventListener('pointerleave', onLeave)
    return () => {
      c.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      c.removeEventListener('dblclick', onDblClick)
      c.removeEventListener('wheel', onWheel)
      c.removeEventListener('pointerenter', onEnter)
      c.removeEventListener('pointerleave', onLeave)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveTesting, deviceType, rotation])

  // ── Click → canonical cell ───────────────────────────────────────
  const tryCellClick = useCallback((px: number, py: number) => {
    const scene = sceneRef.current
    const camera = cameraRef.current
    const geom = geomRef.current
    const container = containerRef.current
    if (!scene || !camera || !geom || !container || !camera.isInteractive()) return
    const rect = container.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      (px / rect.width) * 2 - 1,
      -(py / rect.height) * 2 + 1,
    )
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(ndc, scene.getCamera())

    // Build a plane at plate top y, rotated by meshRotation.
    const topY = geom.floorY + 0.05 // approximate plate top; cell-level accuracy is sufficient for raycast
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -topY)
    const hit = new THREE.Vector3()
    if (!raycaster.ray.intersectPlane(plane, hit)) return

    // Rotate hit back into plate-local space
    const rad = -camera.getMeshRotation()
    const cosR = Math.cos(rad), sinR = Math.sin(rad)
    const lx = hit.x * cosR - hit.z * sinR
    const lz = hit.x * sinR + hit.z * cosR

    const cell = hitPointToCanonicalCell(lx, lz, deviceType, rotation, geom.bounds)
    if (cell) onCellClick(cell[0], cell[1])
  }, [deviceType, rotation, onCellClick])

  const updateHoverCell = useCallback((px: number, py: number) => {
    const scene = sceneRef.current
    const camera = cameraRef.current
    const geom = geomRef.current
    const container = containerRef.current
    if (!scene || !camera || !geom || !container) return
    const rect = container.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      (px / rect.width) * 2 - 1,
      -(py / rect.height) * 2 + 1,
    )
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(ndc, scene.getCamera())
    const topY = geom.floorY + 0.05
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -topY)
    const hit = new THREE.Vector3()
    if (!raycaster.ray.intersectPlane(plane, hit)) { hoverCellRef.current = null; return }
    const rad = -camera.getMeshRotation()
    const cosR = Math.cos(rad), sinR = Math.sin(rad)
    const lx = hit.x * cosR - hit.z * sinR
    const lz = hit.x * sinR + hit.z * cosR
    const cell = hitPointToCanonicalCell(lx, lz, deviceType, rotation, geom.bounds)
    if (cell) hoverCellRef.current = { row: cell[0], col: cell[1], x: px, y: py }
    else hoverCellRef.current = null
  }, [deviceType, rotation])

  // ── Render loop ──────────────────────────────────────────────────
  // Intentionally EMPTY dep array — loop is set up once, reads latest
  // props via propsRef. Prevents RAF teardown on every live-testing update.
  useEffect(() => {
    const v3 = new THREE.Vector3()
    const draw = (now: number) => {
      rafRef.current = requestAnimationFrame(draw)
      if (fatalRef.current) return

      const delta = lastFrameRef.current === null ? 0 : now - lastFrameRef.current
      lastFrameRef.current = now

      const main = canvasRef.current
      const edge = edgeCanvasRef.current
      const scene = sceneRef.current
      const cam = cameraRef.current
      const geom = geomRef.current
      if (!main || !edge || !scene || !cam || !geom) return
      const ctx = main.getContext('2d')
      const eCtx = edge.getContext('2d')
      if (!ctx || !eCtx) return

      const {
        deviceType: deviceTypeNow,
        rotation: rotationNow,
        cellColors: cellColorsNow,
        cellTexts: cellTextsNow,
        activeCell: activeCellNow,
      } = propsRef.current

      cam.update(delta)
      scene.setMeshRotation(cam.getMeshRotation())

      // Grid fades out during transitioning states so the ortho/perspective
      // projection flip isn't visible; fades back in once the camera settles.
      const gridTarget =
        cam.state === 'ORTHO_LOCKED' || cam.state === 'PEEK_ORBIT' ? 1 : 0
      const gridFadeMs = 250
      gridOpacityRef.current += Math.sign(gridTarget - gridOpacityRef.current) *
        Math.min(Math.abs(gridTarget - gridOpacityRef.current), delta / gridFadeMs)
      gridOpacityRef.current = Math.max(0, Math.min(1, gridOpacityRef.current))

      // Imperatively update camera state button (avoids per-frame React re-render)
      if (cam.state !== lastCameraStateRef.current) {
        lastCameraStateRef.current = cam.state
        const btn = cameraStateButtonRef.current
        if (btn) {
          btn.textContent = cameraStateLabel(cam.state)
          btn.style.opacity = cam.state === 'ORTHO_LOCKED' ? '0.7' : '1'
        }
      }

      const dpr = window.devicePixelRatio || 1
      const W = main.width / dpr
      const H = main.height / dpr
      const aspect = W / H

      // Background + clear
      ctx.clearRect(0, 0, W, H)
      eCtx.setTransform(1, 0, 0, 1, 0, 0)
      eCtx.fillStyle = plate3d.bg
      eCtx.fillRect(0, 0, edge.width, edge.height)
      eCtx.setTransform(dpr, 0, 0, dpr, 0, 0)

      // Sync camera
      const pose = cam.getPose()
      scene.syncCamera(pose.azimuth, pose.elevation, pose.distance, { x: 0, y: 0, z: 0 }, 45, aspect, pose.ortho)

      // Update cell fills
      scene.clearAllCellFills() // simple rebuild; cell count is small
      const grid = GRID_DIMS[deviceTypeNow] ?? { rows: 3, cols: 3 }
      for (const [key, bin] of cellColorsNow.entries()) {
        const [rStr, cStr] = key.split(',')
        const canonR = Number(rStr), canonC = Number(cStr)
        if (isNaN(canonR) || isNaN(canonC)) continue
        const rgba = COLOR_BIN_RGBA[bin]
        if (!rgba) continue
        const rect = canonicalCellRect(canonR, canonC, deviceTypeNow, rotationNow, geom.bounds)
        scene.setCellFill(key, rect, geom.floorY + 0.05, rgba)
      }

      // Active cell ring + pulse
      if (activeCellNow) {
        const rect = canonicalCellRect(activeCellNow.row, activeCellNow.col, deviceTypeNow, rotationNow, geom.bounds)
        const pulse = 0.8 + 0.2 * (0.5 + 0.5 * Math.sin((now / ACTIVE_PULSE_MS) * Math.PI * 2))
        scene.setActiveRing(rect, geom.floorY + 0.05, pulse)
      } else {
        scene.setActiveRing(null, 0)
      }

      scene.render()

      // 2D passes
      const camObj = scene.getCamera()

      // Floor grid on edge canvas
      drawFloorGrid(eCtx, camObj, W, H, geom.floorY, geom.bounds, gridOpacityRef.current)

      // Wireframes (below + above fill)
      drawEdges(eCtx, camObj, geom.footEdges, 0.3, W, H, cam.getMeshRotation())
      drawEdges(eCtx, camObj, geom.bodyEdges, 0.3, W, H, cam.getMeshRotation())
      drawEdges(eCtx, camObj, splitRef.current.lower, 0.9, W, H, cam.getMeshRotation())
      drawEdges(ctx, camObj, splitRef.current.upper, 0.8, W, H, cam.getMeshRotation())

      // Cell text labels (projected)
      for (const [key, text] of cellTextsNow.entries()) {
        const [rStr, cStr] = key.split(',')
        const canonR = Number(rStr), canonC = Number(cStr)
        if (isNaN(canonR) || isNaN(canonC)) continue
        const rect = canonicalCellRect(canonR, canonC, deviceTypeNow, rotationNow, geom.bounds)
        const cx = rect.x + rect.w / 2
        const cz = rect.z + rect.h / 2
        const rad = cam.getMeshRotation()
        const cosR = Math.cos(rad), sinR = Math.sin(rad)
        v3.set(cx * cosR + cz * sinR, geom.floorY + 0.051, -cx * sinR + cz * cosR)
        const p = projectToScreen(v3, camObj, W, H)
        if (p.visible) drawCellText(ctx, p.x, p.y, text)
      }

      // HUD chrome
      // Fade brackets based on hover
      const fadeStep = delta / HUD_FADE_MS
      if (hoverInsideRef.current) bracketOpacityRef.current = Math.min(1, bracketOpacityRef.current + fadeStep)
      else bracketOpacityRef.current = Math.max(0, bracketOpacityRef.current - fadeStep)

      if (bracketOpacityRef.current > 0 && cam.state !== 'PEEK_ORBIT') {
        // Rough plate screen-space bounds from bounds corners
        const cornersXZ = [
          { x: geom.bounds.minX, z: geom.bounds.minZ },
          { x: geom.bounds.maxX, z: geom.bounds.minZ },
          { x: geom.bounds.maxX, z: geom.bounds.maxZ },
          { x: geom.bounds.minX, z: geom.bounds.maxZ },
        ]
        let sx1 = Infinity, sy1 = Infinity, sx2 = -Infinity, sy2 = -Infinity
        const rad = cam.getMeshRotation()
        const cosR = Math.cos(rad), sinR = Math.sin(rad)
        for (const c of cornersXZ) {
          v3.set(c.x * cosR + c.z * sinR, geom.floorY + 0.05, -c.x * sinR + c.z * cosR)
          const p = projectToScreen(v3, camObj, W, H)
          sx1 = Math.min(sx1, p.x); sy1 = Math.min(sy1, p.y)
          sx2 = Math.max(sx2, p.x); sy2 = Math.max(sy2, p.y)
        }
        drawBrackets(ctx, { x: sx1, y: sy1, w: sx2 - sx1, h: sy2 - sy1 }, bracketOpacityRef.current * 0.7)
      }

      // Hover reticle (only when not peeking)
      if (hoverCellRef.current && cam.state !== 'PEEK_ORBIT') {
        const h = hoverCellRef.current
        drawHoverReticle(ctx, { x: h.x, y: h.y }, `R${h.row},C${h.col}`)
      }

    }
    rafRef.current = requestAnimationFrame(draw)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


  // ── Render tree ──────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      className="relative w-full h-full min-h-[200px] select-none"
      style={{ cursor: 'grab' }}
    >
      <canvas ref={edgeCanvasRef}  style={{ position: 'absolute', inset: 0, zIndex: 0 }} />
      <canvas ref={webglCanvasRef} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
      <canvas ref={canvasRef}      style={{ position: 'absolute', inset: 0, zIndex: 2 }} />

      {/* Bottom HUD strip — action buttons only */}
      <div
        className="absolute flex items-center overflow-hidden"
        style={{
          bottom: 12, left: 12, height: 32,
          zIndex: 3,
          background: 'rgba(20, 20, 20, 0.65)',
          border: `1px solid ${plate3d.edgeCyan}20`,
          borderRadius: 4,
          backdropFilter: 'blur(8px)',
          fontFamily: plate3d.hudMonoFont,
          fontSize: 12,
          color: plate3d.hudTextColor,
        }}
      >
        <HudActionButton onClick={onTare}>TARE</HudActionButton>
        <HudActionButton onClick={onRotate}>ROTATE 90°</HudActionButton>
        <HudActionButton
          ref={cameraStateButtonRef}
          onClick={() => cameraRef.current?.dismissPeek()}
        >
          ▲ TOP
        </HudActionButton>
      </div>
    </div>
  )
}

// ── Local HUD sub-components ──────────────────────────────────────

const DIVIDER: CSSProperties = {
  borderRight: `1px solid ${plate3d.edgeCyan}1A`,
}

const HudActionButton = forwardRef<
  HTMLButtonElement,
  { children: React.ReactNode; onClick: () => void }
>(function HudActionButton({ children, onClick }, ref) {
  return (
    <button
      ref={ref}
      onClick={onClick}
      style={{
        padding: '0 12px',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        background: 'transparent',
        border: 'none',
        color: 'inherit',
        fontFamily: 'inherit',
        fontSize: 'inherit',
        cursor: 'pointer',
        transition: 'background 120ms ease-out, color 120ms ease-out',
        ...DIVIDER,
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget
        el.style.background = `${plate3d.edgeCyan}14`
        el.style.color = plate3d.edgeCyan
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget
        el.style.background = 'transparent'
        el.style.color = plate3d.hudTextColor
      }}
    >
      {children}
    </button>
  )
})

// ── 2D helpers kept inline (share projection state with scene) ─────

function drawFloorGrid(
  ctx: CanvasRenderingContext2D,
  camera: THREE.Camera,
  W: number, H: number,
  floorY: number,
  bounds: Bounds,
  opacityScale: number = 1,
) {
  const extent = 3
  const step = 0.1
  const fade = 3
  const v = new THREE.Vector3()
  ctx.save()
  ctx.strokeStyle = plate3d.floorGrid
  ctx.lineWidth = 0.5
  const segment = (x1: number, z1: number, x2: number, z2: number) => {
    v.set(x1, floorY, z1)
    const p1 = projectToScreen(v, camera, W, H)
    v.set(x2, floorY, z2)
    const p2 = projectToScreen(v, camera, W, H)
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2
    const dist = Math.hypot(cx, cz)
    const alpha = 0.5 * Math.max(0, 1 - dist / fade) ** 2 * opacityScale
    if (alpha < 0.01) return
    ctx.globalAlpha = alpha
    ctx.beginPath()
    ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y)
    ctx.stroke()
  }
  for (let x = -extent; x <= extent; x += step)
    for (let z = -extent; z < extent; z += step) segment(x, z, x, z + step)
  for (let z = -extent; z <= extent; z += step)
    for (let x = -extent; x < extent; x += step) segment(x, z, x + step, z)
  ctx.restore()
}

function drawEdges(
  ctx: CanvasRenderingContext2D,
  camera: THREE.Camera,
  es: Float32Array | null,
  opacity: number,
  W: number, H: number,
  meshRotation: number,
) {
  if (!es || es.length < 6) return
  const v = new THREE.Vector3()
  const cosR = Math.cos(meshRotation), sinR = Math.sin(meshRotation)
  ctx.save()
  ctx.strokeStyle = plate3d.edgeCyan
  ctx.globalAlpha = opacity
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i < es.length; i += 6) {
    // apply mesh rotation around Y to each endpoint
    const ax = es[i],      ay = es[i + 1], az = es[i + 2]
    const bx = es[i + 3],  by = es[i + 4], bz = es[i + 5]
    v.set(ax * cosR + az * sinR, ay, -ax * sinR + az * cosR)
    const p1 = projectToScreen(v, camera, W, H)
    v.set(bx * cosR + bz * sinR, by, -bx * sinR + bz * cosR)
    const p2 = projectToScreen(v, camera, W, H)
    if (!p1.visible || !p2.visible) continue
    ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y)
  }
  ctx.stroke()
  ctx.restore()
}
