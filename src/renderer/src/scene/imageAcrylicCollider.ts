import RAPIER from '@dimforge/rapier3d-compat'
import type { AcrylicShape, Vec3 } from '../../../shared/types'
import type { AcrylicStandBaseDimensions } from './acrylicStand'

export const ACRYLIC_PANEL_DEPTH = 0.04
export const ACRYLIC_COLLISION_GRID_SIZE = 32
export const MAX_ACRYLIC_CONTOUR_RECTS = 96

export interface NormalizedCollisionRect {
  centerX: number
  centerY: number
  width: number
  height: number
}

export interface AlphaCollisionLayout {
  rectangles: NormalizedCollisionRect[]
  gridWidth: number
  gridHeight: number
}

export interface AcrylicColliderGeometry {
  panel: {
    shape: AcrylicShape
    width: number
    height: number
    depth: number
    centerY: number
    centerZ: number
    contourRects: readonly NormalizedCollisionRect[]
  }
  base: AcrylicStandBaseDimensions & {
    centerY: number
  }
}

interface GridRun {
  start: number
  end: number
}

interface GridRect extends GridRun {
  top: number
  bottom: number
}

function occupiedGrid(alpha: Uint8ClampedArray, width: number, height: number, gridWidth: number, gridHeight: number, threshold: number): boolean[] {
  const occupied = new Array<boolean>(gridWidth * gridHeight).fill(false)
  for (let gridY = 0; gridY < gridHeight; gridY += 1) {
    const sourceTop = Math.floor(gridY * height / gridHeight)
    const sourceBottom = Math.max(sourceTop + 1, Math.ceil((gridY + 1) * height / gridHeight))
    for (let gridX = 0; gridX < gridWidth; gridX += 1) {
      const sourceLeft = Math.floor(gridX * width / gridWidth)
      const sourceRight = Math.max(sourceLeft + 1, Math.ceil((gridX + 1) * width / gridWidth))
      let cellOccupied = false
      for (let sourceY = sourceTop; sourceY < sourceBottom && !cellOccupied; sourceY += 1) {
        const row = sourceY * width
        for (let sourceX = sourceLeft; sourceX < sourceRight; sourceX += 1) {
          if (alpha[row + sourceX] >= threshold) {
            cellOccupied = true
            break
          }
        }
      }
      occupied[gridY * gridWidth + gridX] = cellOccupied
    }
  }
  return occupied
}

function gridRuns(occupied: readonly boolean[], gridWidth: number, row: number): GridRun[] {
  const runs: GridRun[] = []
  let start = -1
  for (let x = 0; x <= gridWidth; x += 1) {
    const filled = x < gridWidth && occupied[row * gridWidth + x]
    if (filled && start < 0) start = x
    if (!filled && start >= 0) {
      runs.push({ start, end: x })
      start = -1
    }
  }
  return runs
}

function mergeOccupiedRuns(occupied: readonly boolean[], gridWidth: number, gridHeight: number): GridRect[] {
  const complete: GridRect[] = []
  let active = new Map<string, GridRect>()
  for (let y = 0; y < gridHeight; y += 1) {
    const next = new Map<string, GridRect>()
    for (const run of gridRuns(occupied, gridWidth, y)) {
      const key = `${run.start}:${run.end}`
      const previous = active.get(key)
      next.set(key, previous
        ? { ...previous, bottom: y + 1 }
        : { ...run, top: y, bottom: y + 1 })
    }
    for (const [key, rectangle] of active) {
      if (!next.has(key)) complete.push(rectangle)
    }
    active = next
  }
  complete.push(...active.values())
  return complete
}

function normalizeGridRect(rectangle: GridRect, gridWidth: number, gridHeight: number): NormalizedCollisionRect {
  return {
    centerX: (rectangle.start + rectangle.end) / (gridWidth * 2) - 0.5,
    centerY: 0.5 - (rectangle.top + rectangle.bottom) / (gridHeight * 2),
    width: (rectangle.end - rectangle.start) / gridWidth,
    height: (rectangle.bottom - rectangle.top) / gridHeight
  }
}

export function alphaMaskToCollisionLayout(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  options: { threshold?: number, gridSize?: number, maxRectangles?: number } = {}
): AlphaCollisionLayout {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || alpha.length < width * height) {
    throw new Error('Invalid acrylic alpha mask dimensions')
  }

  const threshold = Math.min(255, Math.max(1, Math.round(options.threshold ?? 3)))
  const maximumGridSize = Math.max(4, Math.round(options.gridSize ?? ACRYLIC_COLLISION_GRID_SIZE))
  const maximumRectangles = Math.max(1, Math.round(options.maxRectangles ?? MAX_ACRYLIC_CONTOUR_RECTS))
  let gridSize = maximumGridSize

  while (true) {
    const scale = Math.min(1, gridSize / Math.max(width, height))
    const gridWidth = Math.max(1, Math.round(width * scale))
    const gridHeight = Math.max(1, Math.round(height * scale))
    const occupied = occupiedGrid(alpha, width, height, gridWidth, gridHeight, threshold)
    const rectangles = mergeOccupiedRuns(occupied, gridWidth, gridHeight)
      .map((rectangle) => normalizeGridRect(rectangle, gridWidth, gridHeight))

    if (rectangles.length <= maximumRectangles || gridSize <= 8) {
      return { rectangles, gridWidth, gridHeight }
    }
    gridSize = Math.max(8, Math.floor(gridSize * 0.75))
  }
}

export function createAcrylicColliderGeometry(options: {
  imageWidth: number
  imageHeight: number
  offset: number
  shape: AcrylicShape
  base: AcrylicStandBaseDimensions
  contourRects?: readonly NormalizedCollisionRect[]
}): AcrylicColliderGeometry {
  const panelWidth = options.imageWidth + options.offset * 2
  const panelHeight = options.imageHeight + options.offset * 2
  return {
    panel: {
      shape: options.shape,
      width: panelWidth,
      height: panelHeight,
      depth: ACRYLIC_PANEL_DEPTH,
      centerY: options.base.height + panelHeight / 2,
      centerZ: 0,
      contourRects: options.contourRects ?? []
    },
    base: {
      ...options.base,
      centerY: options.base.height / 2
    }
  }
}

function ellipsePrism(axis: 'xy' | 'xz', width: number, height: number, depth: number, segments = 48): RAPIER.Shape {
  const points = new Float32Array(segments * 2 * 3)
  let cursor = 0
  for (const side of [-0.5, 0.5]) {
    for (let index = 0; index < segments; index += 1) {
      const angle = index / segments * Math.PI * 2
      const first = Math.cos(angle) * width / 2
      const second = Math.sin(angle) * height / 2
      if (axis === 'xy') {
        points[cursor++] = first
        points[cursor++] = second
        points[cursor++] = side * depth
      } else {
        points[cursor++] = first
        points[cursor++] = side * depth
        points[cursor++] = second
      }
    }
  }
  const descriptor = RAPIER.ColliderDesc.convexHull(points)
  if (!descriptor) throw new Error('Could not create acrylic ellipse collision shape')
  return descriptor.shape
}

export function createAcrylicColliderDesc(geometry: AcrylicColliderGeometry, scale: Vec3): RAPIER.ColliderDesc {
  const scaleX = Math.abs(scale.x)
  const scaleY = Math.abs(scale.y)
  const scaleZ = Math.abs(scale.z)
  const signedX = scale.x
  const signedY = scale.y
  const signedZ = scale.z
  const shapes: RAPIER.Shape[] = []
  const positions: RAPIER.Vector[] = []
  const rotations: RAPIER.Rotation[] = []
  const identity = { x: 0, y: 0, z: 0, w: 1 }
  const addShape = (shape: RAPIER.Shape, position: RAPIER.Vector): void => {
    shapes.push(shape)
    positions.push(position)
    rotations.push(identity)
  }

  const panel = geometry.panel
  const panelWidth = Math.max(0.002, panel.width * scaleX)
  const panelHeight = Math.max(0.002, panel.height * scaleY)
  const panelDepth = Math.max(0.002, panel.depth * scaleZ)
  const panelCenter = {
    x: 0,
    y: panel.centerY * signedY,
    z: panel.centerZ * signedZ
  }

  if (panel.shape === 'rectangle') {
    addShape(new RAPIER.Cuboid(panelWidth / 2, panelHeight / 2, panelDepth / 2), panelCenter)
  } else if (panel.shape === 'ellipse') {
    addShape(ellipsePrism('xy', panelWidth, panelHeight, panelDepth), panelCenter)
  } else {
    for (const rectangle of panel.contourRects) {
      const width = Math.max(0.002, rectangle.width * panelWidth)
      const height = Math.max(0.002, rectangle.height * panelHeight)
      addShape(
        new RAPIER.Cuboid(width / 2, height / 2, panelDepth / 2),
        {
          x: rectangle.centerX * panel.width * signedX,
          y: panel.centerY * signedY + rectangle.centerY * panel.height * signedY,
          z: panel.centerZ * signedZ
        }
      )
    }
  }

  const base = geometry.base
  addShape(
    ellipsePrism(
      'xz',
      Math.max(0.002, base.width * scaleX),
      Math.max(0.002, base.depth * scaleZ),
      Math.max(0.002, base.height * scaleY)
    ),
    { x: 0, y: base.centerY * signedY, z: 0 }
  )

  return RAPIER.ColliderDesc.compound(shapes, positions, rotations)
}
