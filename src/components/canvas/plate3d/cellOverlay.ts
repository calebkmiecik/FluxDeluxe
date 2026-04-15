/**
 * 2D HUD overlay drawing for the plate canvas.
 *
 * Two draw surfaces:
 *   z=0 canvas — background, floor grid, below-fill wireframes
 *   z=2 canvas — above-fill wireframes, projected cell text labels,
 *                HUD chrome (corner brackets, bottom readout, reticle)
 *
 * This module contains only the HUD chrome + projected text drawing.
 * Wireframe passes remain inline in PlateCanvas (they share projection
 * state with the scene).
 */

import type * as THREE from 'three'
import {
  plate3d,
} from '../../../lib/theme'
import {
  HUD_BRACKET_LENGTH,
  HUD_BRACKET_STROKE,
  HUD_FONT_PX,
} from './constants'

export interface ScreenRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Compute the four L-bracket line-paths for a given screen-space rect.
 * Returned order: top-left, top-right, bottom-right, bottom-left.
 * Each bracket is three points forming an L.
 */
export function computeScreenBracket(
  rect: ScreenRect,
  length = HUD_BRACKET_LENGTH,
): Array<Array<{ x: number; y: number }>> {
  const { x, y, w, h } = rect
  return [
    // top-left
    [{ x, y: y + length }, { x, y }, { x: x + length, y }],
    // top-right
    [{ x: x + w - length, y }, { x: x + w, y }, { x: x + w, y: y + length }],
    // bottom-right
    [{ x: x + w, y: y + h - length }, { x: x + w, y: y + h }, { x: x + w - length, y: y + h }],
    // bottom-left
    [{ x: x + length, y: y + h }, { x, y: y + h }, { x, y: y + h - length }],
  ]
}

export function drawBrackets(
  ctx: CanvasRenderingContext2D,
  rect: ScreenRect,
  opacity: number,
) {
  if (opacity <= 0) return
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.strokeStyle = plate3d.edgeCyan
  ctx.lineWidth = HUD_BRACKET_STROKE
  for (const path of computeScreenBracket(rect)) {
    ctx.beginPath()
    ctx.moveTo(path[0].x, path[0].y)
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y)
    ctx.stroke()
  }
  ctx.restore()
}

export function drawHoverReticle(
  ctx: CanvasRenderingContext2D,
  center: { x: number; y: number },
  label: string,
) {
  ctx.save()
  ctx.strokeStyle = plate3d.edgeCyan
  ctx.globalAlpha = 0.7
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(center.x - 12, center.y)
  ctx.lineTo(center.x + 12, center.y)
  ctx.moveTo(center.x, center.y - 12)
  ctx.lineTo(center.x, center.y + 12)
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.font = `${HUD_FONT_PX}px ${plate3d.hudMonoFont}`
  ctx.fillStyle = plate3d.hudTextColor
  ctx.textBaseline = 'bottom'
  ctx.textAlign = 'left'
  ctx.fillText(label, center.x + 8, center.y - 8)
  ctx.restore()
}

export function drawCellText(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  text: string,
) {
  ctx.save()
  ctx.font = `bold ${HUD_FONT_PX}px ${plate3d.hudMonoFont}`
  ctx.fillStyle = '#FFFFFF'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, screenX, screenY)
  ctx.restore()
}

/** Project a world-space point to screen coordinates via a three camera. */
export function projectToScreen(
  world: THREE.Vector3,
  camera: THREE.Camera,
  viewportW: number,
  viewportH: number,
): { x: number; y: number; visible: boolean } {
  const p = world.clone().project(camera)
  return {
    x: (p.x * 0.5 + 0.5) * viewportW,
    y: (-p.y * 0.5 + 0.5) * viewportH,
    visible: p.z >= -1 && p.z <= 1,
  }
}
