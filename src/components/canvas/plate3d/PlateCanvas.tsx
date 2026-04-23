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
import { getLatestFrameForDevice } from '../../../stores/liveDataStore'
import { useDeviceStore } from '../../../stores/deviceStore'
import * as THREE from 'three'
import { plate3d } from '../../../lib/theme'
import { rotateForDevice } from '../../../lib/deviceIds'
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
  if (state === 'PEEK_ORBIT') return 'FREE'
  return 'TOP'
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
    deviceType, rotation, cellColors, cellTexts, activeCell, liveTesting,
  })
  propsRef.current = { deviceType, rotation, cellColors, cellTexts, activeCell, liveTesting }

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

  // Smoothed COP position (exponential lerp per frame)
  const smoothCopRef = useRef({ x: 0, z: 0 })
  const smoothForceRef = useRef(0)

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
    const onDblClick = (e: MouseEvent) => {
      // Only dismiss peek when double-clicking the canvas itself,
      // not when rapidly clicking HUD buttons (which would bubble here).
      if ((e.target as HTMLElement).tagName === 'CANVAS') {
        cameraRef.current?.dismissPeek()
      }
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
    if (!scene || !camera || !geom || !container || !camera.isInteractive() || !liveTesting) return
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
        liveTesting: liveTestingNow,
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

      // COP circle — latest frame for the selected device only
      const selectedId = useDeviceStore.getState().selectedDeviceId
      const liveFrame = selectedId ? getLatestFrameForDevice(selectedId) : null
      if (liveFrame && Math.abs(liveFrame.fz) >= 5) {
        // Exponential smoothing — frame-rate independent
        const smoothSpeed = 12 // higher = more responsive, lower = smoother
        const alpha = 1 - Math.exp(-smoothSpeed * (delta / 1000))

        // Device-specific axis correction (XL plates are physically mounted
        // 90° CCW, so rotate their sensor coords before the world mapping).
        const [copX, copY] = rotateForDevice(liveFrame.cop.x, liveFrame.cop.y, deviceTypeNow)
        // Smooth COP position (plate-local target)
        const targetX = -copY
        const targetZ = copX
        const sc = smoothCopRef.current
        sc.x += (targetX - sc.x) * alpha
        sc.z += (targetZ - sc.z) * alpha

        // Smooth total-force magnitude so radius doesn't pulse with every raw spike
        const rawForce = Math.sqrt(
          liveFrame.fx ** 2 + liveFrame.fy ** 2 + liveFrame.fz ** 2,
        )
        smoothForceRef.current += (rawForce - smoothForceRef.current) * alpha
        const baseRadius = 0.008
        const radius = baseRadius + Math.sqrt(Math.max(0, smoothForceRef.current)) * 0.001

        // Clamp to plate bounds
        const b = geom.bounds
        const cx = Math.max(b.minX, Math.min(b.maxX, sc.x))
        const cz = Math.max(b.minZ, Math.min(b.maxZ, sc.z))
        scene.setCopSphere(cx, cz, geom.floorY + 0.05, radius)
      } else {
        // Decay the smoothed force toward zero when below threshold so the
        // dot doesn't snap big the instant force returns.
        smoothForceRef.current *= 0.85
        scene.setCopSphere(null, null, 0, 0)
      }

      scene.render()

      // 2D passes
      const camObj = scene.getCamera()

      // Floor grid on edge canvas — always visible, small radius around plate
      drawFloorGrid(eCtx, camObj, W, H, geom.floorY, geom.bounds, gridOpacityRef.current)

      // Wireframes (below + above fill)
      drawEdges(eCtx, camObj, geom.footEdges, 0.3, W, H, cam.getMeshRotation())
      drawEdges(eCtx, camObj, geom.bodyEdges, 0.3, W, H, cam.getMeshRotation())
      drawEdges(eCtx, camObj, splitRef.current.lower, 0.9, W, H, cam.getMeshRotation())
      drawEdges(ctx, camObj, splitRef.current.upper, 0.8, W, H, cam.getMeshRotation())

      // Cell grid lines (projected onto plate top) — only during live test
      if (liveTestingNow) {
        const b = geom.bounds
        const rotated = rotationNow % 2 === 1
        const dRows = rotated ? grid.cols : grid.rows
        const dCols = rotated ? grid.rows : grid.cols
        const cellW = (b.maxX - b.minX) / dCols
        const cellH = (b.maxZ - b.minZ) / dRows
        const meshRad = cam.getMeshRotation()
        const cosR = Math.cos(meshRad), sinR = Math.sin(meshRad)
        const topYGrid = geom.floorY + 0.051
        ctx.save()
        ctx.strokeStyle = plate3d.edgeCyan
        ctx.globalAlpha = 0.3
        ctx.lineWidth = 1
        ctx.beginPath()
        // Horizontal lines (row boundaries)
        for (let r = 0; r <= dRows; r++) {
          const z = b.minZ + r * cellH
          const x1 = b.minX, x2 = b.maxX
          v3.set(x1 * cosR + z * sinR, topYGrid, -x1 * sinR + z * cosR)
          const p1 = projectToScreen(v3, camObj, W, H)
          v3.set(x2 * cosR + z * sinR, topYGrid, -x2 * sinR + z * cosR)
          const p2 = projectToScreen(v3, camObj, W, H)
          if (p1.visible && p2.visible) { ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y) }
        }
        // Vertical lines (column boundaries)
        for (let c = 0; c <= dCols; c++) {
          const x = b.minX + c * cellW
          const z1 = b.minZ, z2 = b.maxZ
          v3.set(x * cosR + z1 * sinR, topYGrid, -x * sinR + z1 * cosR)
          const p1 = projectToScreen(v3, camObj, W, H)
          v3.set(x * cosR + z2 * sinR, topYGrid, -x * sinR + z2 * cosR)
          const p2 = projectToScreen(v3, camObj, W, H)
          if (p1.visible && p2.visible) { ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y) }
        }
        ctx.stroke()
        ctx.restore()
      }

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
        const pad = 10 // px of air between plate edge and brackets
        drawBrackets(
          ctx,
          { x: sx1 - pad, y: sy1 - pad, w: (sx2 - sx1) + pad * 2, h: (sy2 - sy1) + pad * 2 },
          bracketOpacityRef.current * 0.7,
        )
      }

      // Hover reticle (only when not peeking)
      if (hoverCellRef.current && cam.state !== 'PEEK_ORBIT') {
        const h = hoverCellRef.current
        drawHoverReticle(ctx, { x: h.x, y: h.y }, `R${h.row},C${h.col}`)
      }

      // 3D axis gizmo (bottom-right) — projects world XYZ unit vectors
      // through the current camera transform so it reflects the view.
      drawAxisGizmo(ctx, camObj, W, H)

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
      {/* stopPropagation prevents button clicks from bubbling to the
          container as dblclick (which would fire dismissPeek) */}
      <div
        className="absolute flex items-center overflow-hidden"
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
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
          TOP
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

/**
 * 3D axis gizmo anchored to the bottom-right corner. Projects the three
 * world unit vectors (+X, +Y, +Z) through the current camera's view matrix
 * so the gizmo tumbles as the camera orbits. Classic Blender-style widget
 * for understanding the current 3D orientation at a glance.
 */
const _axisTmp = new THREE.Vector3()
const _axisRot = new THREE.Matrix4()
function drawAxisGizmo(
  ctx: CanvasRenderingContext2D,
  camera: THREE.Camera,
  W: number, H: number,
) {
  const cx = W - 54
  const cy = H - 54
  const len = 26
  const head = 5

  // View-matrix rotation only (discard translation) — we just want to
  // transform DIRECTIONS, not positions.
  _axisRot.extractRotation(camera.matrixWorldInverse)

  interface AxisInfo { dx: number; dy: number; depth: number; color: string; label: string }
  const axes: AxisInfo[] = []
  const push = (x: number, y: number, z: number, color: string, label: string) => {
    _axisTmp.set(x, y, z).applyMatrix4(_axisRot)
    axes.push({
      dx: _axisTmp.x,
      dy: -_axisTmp.y, // canvas Y is inverted
      depth: _axisTmp.z,
      color,
      label,
    })
  }
  push(1, 0, 0, '#FF5252', 'X') // red
  push(0, 1, 0, '#00C853', 'Y') // green
  push(0, 0, 1, '#7AB8FF', 'Z') // cyan

  // Draw farthest (most-negative Z after view transform) first so nearer
  // arrows overlap them.
  axes.sort((a, b) => a.depth - b.depth)

  ctx.save()
  ctx.translate(cx, cy)
  ctx.font = `10px ${plate3d.hudMonoFont}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (const a of axes) {
    const tx = a.dx * len
    const ty = a.dy * len
    // Axes pointing away from the camera get dimmed slightly
    const alpha = a.depth > 0 ? 0.45 : 1
    ctx.globalAlpha = alpha

    ctx.strokeStyle = a.color
    ctx.fillStyle = a.color
    ctx.lineWidth = 1.5

    // Shaft
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(tx, ty)
    ctx.stroke()

    // Arrowhead: small triangle at the tip, oriented along (dx, dy)
    const ang = Math.atan2(ty, tx)
    const cosA = Math.cos(ang), sinA = Math.sin(ang)
    ctx.beginPath()
    ctx.moveTo(tx, ty)
    ctx.lineTo(tx - head * cosA + (head / 2) * sinA, ty - head * sinA - (head / 2) * cosA)
    ctx.lineTo(tx - head * cosA - (head / 2) * sinA, ty - head * sinA + (head / 2) * cosA)
    ctx.closePath()
    ctx.fill()

    // Label just past the tip
    ctx.fillText(a.label, tx + cosA * 8, ty + sinA * 8)
  }

  ctx.globalAlpha = 1
  ctx.restore()
}

function drawFloorGrid(
  ctx: CanvasRenderingContext2D,
  camera: THREE.Camera,
  W: number, H: number,
  floorY: number,
  bounds: Bounds,
  opacityScale: number = 1,
) {
  const extent = 1.5
  const step = 0.1
  const fade = 1.5 // ~1m past largest plate edge, fades to 0 at boundary
  const v = new THREE.Vector3()
  ctx.save()
  ctx.strokeStyle = plate3d.floorGrid
  ctx.lineWidth = 0.5
  const segment = (x1: number, z1: number, x2: number, z2: number) => {
    v.set(x1, floorY, z1)
    const p1 = projectToScreen(v, camera, W, H)
    v.set(x2, floorY, z2)
    const p2 = projectToScreen(v, camera, W, H)
    if (!p1.visible || !p2.visible) return // clip behind-camera segments
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2
    const dist = Math.hypot(cx, cz)
    const alpha = 0.7 * Math.max(0, 1 - dist / fade) ** 2 * opacityScale
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
