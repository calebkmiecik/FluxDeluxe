/**
 * WebGL scene wrapper for the 3D plate canvas.
 *
 * Owns: renderer, scene, camera, plate fill mesh, cell fill meshes,
 * active-cell ring, raycast hit plane.
 *
 * Critical lifecycle note (production gotcha):
 *   We never call renderer.dispose(). It invokes WEBGL_lose_context
 *   .loseContext() which Chromium counts toward a ~3-loss limit per
 *   page; after that, new WebGL contexts are permanently blocked.
 *   Instead we cache renderers in a WeakMap keyed by canvas element
 *   so the GL context is reclaimed naturally on GC.
 */

import * as THREE from 'three'
import { plate3d } from '../../../lib/theme'

const _rendererCache = new WeakMap<HTMLCanvasElement, THREE.WebGLRenderer>()
function getOrCreateRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  let r = _rendererCache.get(canvas)
  if (r) return r
  r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
  r.setClearColor(0x000000, 0)
  _rendererCache.set(canvas, r)
  return r
}

// ── Shared WebGL readiness probe ──────────────────────────────────
// Electron sometimes needs a beat before getContext succeeds.
let _webglReady: Promise<void> | null = null
export function waitForWebGL(): Promise<void> {
  if (_webglReady) return _webglReady
  _webglReady = new Promise<void>((resolve) => {
    const probe = document.createElement('canvas')
    probe.width = probe.height = 1
    let attempt = 0
    const check = () => {
      const gl = probe.getContext('webgl2') || probe.getContext('webgl')
      if (gl) { resolve(); return }
      const delay = attempt < 4 ? 250 * 2 ** attempt : 5000
      setTimeout(check, delay)
      attempt++
    }
    check()
  })
  return _webglReady
}

export interface PlateSceneOptions {
  canvas: HTMLCanvasElement
}

const _tgt = new THREE.Vector3()
const _eye = new THREE.Vector3()

export class PlateScene {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera =
    new THREE.PerspectiveCamera(45, 1, 0.001, 20)

  /** Group everything plate-local under a pivot so mesh rotation drives the whole plate. */
  private platePivot = new THREE.Group()
  private fillMesh: THREE.Mesh | null = null
  private cellMeshes = new Map<string, THREE.Mesh>() // "canonR,canonC" -> mesh
  private activeRing: THREE.LineLoop | null = null
  private copGroup: THREE.Group | null = null
  private copCore: THREE.Mesh | null = null
  private copMid: THREE.Mesh | null = null
  private copHalo: THREE.Mesh | null = null
  private copDisc: THREE.Mesh | null = null

  constructor(opts: PlateSceneOptions) {
    this.renderer = getOrCreateRenderer(opts.canvas)
    this.scene.add(this.platePivot)
  }

  setSize(w: number, h: number, dpr: number) {
    this.renderer.setSize(w, h, false)
    this.renderer.setPixelRatio(dpr)
  }

  /** Rotate the whole plate group around Y. Driven by cameraController.meshRotation. */
  setMeshRotation(radians: number) {
    this.platePivot.rotation.y = radians
  }

  syncCamera(
    azimuth: number, elevation: number, distance: number,
    target: { x: number; y: number; z: number },
    fov: number, aspect: number, ortho: boolean,
  ) {
    _tgt.set(target.x, target.y, target.z)
    _eye.set(
      distance * Math.cos(elevation) * Math.sin(azimuth),
      distance * Math.sin(elevation),
      distance * Math.cos(elevation) * Math.cos(azimuth),
    ).add(_tgt)

    if (ortho) {
      const halfH = distance * Math.tan((fov * Math.PI / 180) / 2)
      const halfW = halfH * aspect
      if (!(this.camera instanceof THREE.OrthographicCamera)) {
        this.camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.01, 20)
        this.camera.updateProjectionMatrix()
      } else {
        this.camera.left = -halfW; this.camera.right = halfW
        this.camera.top = halfH; this.camera.bottom = -halfH
        this.camera.updateProjectionMatrix()
      }
    } else {
      if (!(this.camera instanceof THREE.PerspectiveCamera)) {
        this.camera = new THREE.PerspectiveCamera(fov, aspect, 0.001, 20)
        this.camera.updateProjectionMatrix()
      } else {
        this.camera.fov = fov; this.camera.aspect = aspect
        this.camera.updateProjectionMatrix()
      }
    }
    this.camera.position.copy(_eye)
    this.camera.lookAt(_tgt)
    this.camera.updateMatrixWorld()
  }

  getCamera(): THREE.Camera {
    return this.camera
  }

  /** Rebuild plate fill mesh from decoded faces. Called when plate JSON changes. */
  buildPlateFill(faces: Float32Array | null) {
    this.clearPlateFill()
    if (!faces || faces.length < 9) return
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(faces), 3))
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(plate3d.plateFill),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: plate3d.plateFillOpacity,
      depthTest: true,
      depthWrite: true,
    })
    const mesh = new THREE.Mesh(geo, mat)
    this.platePivot.add(mesh)
    this.fillMesh = mesh
  }

  /**
   * Create / update a flat colored quad for one canonical cell.
   * `rect` is in plate-local XZ; `topY` places the quad just above the plate top.
   */
  setCellFill(
    key: string,
    rect: { x: number; z: number; w: number; h: number },
    topY: number,
    colorRgba: [number, number, number, number],
  ) {
    let mesh = this.cellMeshes.get(key)
    if (!mesh) {
      const geo = new THREE.PlaneGeometry(1, 1)
      const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })
      mesh = new THREE.Mesh(geo, mat)
      mesh.rotation.x = -Math.PI / 2 // flat, facing up
      this.platePivot.add(mesh)
      this.cellMeshes.set(key, mesh)
    }
    mesh.position.set(rect.x + rect.w / 2, topY + 0.0005, rect.z + rect.h / 2)
    mesh.scale.set(rect.w, rect.h, 1)
    const mat = mesh.material as THREE.MeshBasicMaterial
    mat.color.setRGB(colorRgba[0] / 255, colorRgba[1] / 255, colorRgba[2] / 255)
    mat.opacity = (colorRgba[3] / 255) * plate3d.cellFillOpacity
  }

  removeCellFill(key: string) {
    const mesh = this.cellMeshes.get(key)
    if (!mesh) return
    this.platePivot.remove(mesh)
    mesh.geometry.dispose()
    ;(mesh.material as THREE.Material).dispose()
    this.cellMeshes.delete(key)
  }

  clearAllCellFills() {
    for (const key of Array.from(this.cellMeshes.keys())) this.removeCellFill(key)
  }

  /** Active cell amber outline ring, co-planar with plate top (slight offset). */
  setActiveRing(
    rect: { x: number; z: number; w: number; h: number } | null,
    topY: number,
    opacity = 1,
  ) {
    if (!rect) {
      if (this.activeRing) {
        this.platePivot.remove(this.activeRing)
        this.activeRing.geometry.dispose()
        ;(this.activeRing.material as THREE.Material).dispose()
        this.activeRing = null
      }
      return
    }
    if (!this.activeRing) {
      const geo = new THREE.BufferGeometry()
      const mat = new THREE.LineBasicMaterial({
        color: new THREE.Color(plate3d.activeAmber),
        transparent: true,
        depthTest: false,
      })
      this.activeRing = new THREE.LineLoop(geo, mat)
      this.platePivot.add(this.activeRing)
    }
    const inset = 0.003
    const x1 = rect.x + inset
    const x2 = rect.x + rect.w - inset
    const z1 = rect.z + inset
    const z2 = rect.z + rect.h - inset
    const y = topY + 0.0008
    const verts = new Float32Array([
      x1, y, z1,
      x2, y, z1,
      x2, y, z2,
      x1, y, z2,
    ])
    const geo = this.activeRing.geometry
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
    geo.attributes.position.needsUpdate = true
    ;(this.activeRing.material as THREE.LineBasicMaterial).opacity = opacity
  }

  /**
   * Position and scale the COP sphere group on the plate top.
   * Pass null position to hide. Radius in meters.
   */
  setCopSphere(
    worldX: number | null,
    worldZ: number | null,
    topY: number,
    radius: number,
  ) {
    if (worldX === null || worldZ === null || radius <= 0) {
      if (this.copGroup) this.copGroup.visible = false
      return
    }
    if (!this.copGroup) {
      this.copGroup = new THREE.Group()

      // Shared geometries
      const sphereGeo = new THREE.SphereGeometry(1, 24, 16)
      const discGeo = new THREE.CircleGeometry(1, 32)

      // Core — bright white-blue center
      this.copCore = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({
        color: new THREE.Color('#AAD4FF'),
        transparent: true,
        opacity: 0.95,
      }))
      this.copGroup.add(this.copCore)

      // Mid — primary blue envelope
      this.copMid = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({
        color: new THREE.Color('#0066FF'),
        transparent: true,
        opacity: 0.6,
      }))
      this.copGroup.add(this.copMid)

      // Halo — soft additive glow
      this.copHalo = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({
        color: new THREE.Color('#0066FF'),
        transparent: true,
        opacity: 0.12,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }))
      this.copGroup.add(this.copHalo)

      // Ground disc — light cast on plate surface
      this.copDisc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({
        color: new THREE.Color('#0051BA'),
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
        side: THREE.DoubleSide,
      }))
      this.copDisc.rotation.x = -Math.PI / 2 // lay flat
      this.copGroup.add(this.copDisc)

      this.platePivot.add(this.copGroup)
    }

    this.copGroup.visible = true

    // Position the group at COP XZ, surface Y
    this.copGroup.position.set(worldX, topY, worldZ)

    // Scale each sub-mesh relative to core radius
    this.copCore!.scale.setScalar(radius)
    this.copCore!.position.y = radius // sit on surface

    this.copMid!.scale.setScalar(radius * 1.3)
    this.copMid!.position.y = radius // same center as core

    this.copHalo!.scale.setScalar(radius * 2.5)
    this.copHalo!.position.y = radius // same center

    this.copDisc!.scale.setScalar(radius * 3)
    this.copDisc!.position.y = 0.0002 // just above surface (the group is already at topY)
  }

  render() {
    this.renderer.render(this.scene, this.camera)
  }

  /** Renderer intentionally NOT disposed — see file header. */
  dispose() {
    this.clearPlateFill()
    this.clearAllCellFills()
    this.setActiveRing(null, 0)
    if (this.copGroup) {
      this.platePivot.remove(this.copGroup)
      this.copGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose()
          ;(obj.material as THREE.Material).dispose()
        }
      })
      this.copGroup = null
      this.copCore = this.copMid = this.copHalo = this.copDisc = null
    }
  }

  private clearPlateFill() {
    if (this.fillMesh) {
      this.platePivot.remove(this.fillMesh)
      this.fillMesh.geometry.dispose()
      ;(this.fillMesh.material as THREE.Material).dispose()
      this.fillMesh = null
    }
  }
}
