import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  alphaMaskToCollisionLayout,
  createAcrylicColliderDesc,
  createAcrylicColliderGeometry,
  MAX_ACRYLIC_CONTOUR_RECTS,
  type AcrylicColliderGeometry,
  type NormalizedCollisionRect
} from './imageAcrylicCollider'

const identity = { x: 0, y: 0, z: 0, w: 1 }
const base = { width: 1, depth: 0.5, height: 0.05 }

function rectangleContains(rectangle: NormalizedCollisionRect, x: number, y: number): boolean {
  return Math.abs(x - rectangle.centerX) < rectangle.width / 2
    && Math.abs(y - rectangle.centerY) < rectangle.height / 2
}

function pointHitsCollider(geometry: AcrylicColliderGeometry, point: RAPIER.Vector, scale = { x: 1, y: 1, z: 1 }): boolean {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  world.createCollider(createAcrylicColliderDesc(geometry, scale), body)
  world.step()
  const hit = world.intersectionWithShape(point, identity, new RAPIER.Ball(0.002)) !== null
  world.free()
  return hit
}

function geometry(shape: 'rectangle' | 'ellipse' | 'contour', contourRects: readonly NormalizedCollisionRect[] = []): AcrylicColliderGeometry {
  return createAcrylicColliderGeometry({
    imageWidth: 2,
    imageHeight: 2,
    offset: 0,
    shape,
    base,
    contourRects
  })
}

beforeAll(async () => {
  await RAPIER.init()
})

describe('image acrylic alpha collision layout', () => {
  it('maps opaque pixels to colliders while preserving transparent corners and concavities', () => {
    const width = 8
    const height = 8
    const alpha = new Uint8ClampedArray(width * height)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (x === 3 || x === 4 || y === 3 || y === 4) alpha[y * width + x] = 255
      }
    }

    const layout = alphaMaskToCollisionLayout(alpha, width, height, { gridSize: 8 })
    expect(layout.gridWidth).toBe(8)
    expect(layout.gridHeight).toBe(8)

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const normalizedX = (x + 0.5) / width - 0.5
        const normalizedY = 0.5 - (y + 0.5) / height
        const covered = layout.rectangles.some((rectangle) => rectangleContains(rectangle, normalizedX, normalizedY))
        expect(covered, `cell ${x},${y}`).toBe(alpha[y * width + x] > 0)
      }
    }
  })

  it('returns no panel rectangles for a fully transparent image', () => {
    const layout = alphaMaskToCollisionLayout(new Uint8ClampedArray(64), 8, 8, { gridSize: 8 })
    expect(layout.rectangles).toEqual([])
  })

  it('caps pathological alpha masks to a bounded number of compound shapes', () => {
    const width = 64
    const height = 64
    const alpha = new Uint8ClampedArray(width * height)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if ((x + y) % 2 === 0) alpha[y * width + x] = 255
      }
    }

    const layout = alphaMaskToCollisionLayout(alpha, width, height)
    expect(layout.rectangles.length).toBeLessThanOrEqual(MAX_ACRYLIC_CONTOUR_RECTS)
  })
})

describe('image acrylic Rapier collision geometry', () => {
  it('aligns the bottom of every panel with the top of its visible base', () => {
    for (const shape of ['rectangle', 'ellipse', 'contour'] as const) {
      const result = createAcrylicColliderGeometry({
        imageWidth: 1.2,
        imageHeight: 1.8,
        offset: 0.08,
        shape,
        base
      })
      expect(result.panel.centerY - result.panel.height / 2).toBeCloseTo(result.base.height)
      expect(result.base.centerY + result.base.height / 2).toBeCloseTo(result.panel.centerY - result.panel.height / 2)
    }
  })

  it('keeps the rectangular plate collision at its visible corners', () => {
    const result = geometry('rectangle')
    expect(pointHitsCollider(result, { x: 0.9, y: result.panel.centerY + 0.9, z: 0 })).toBe(true)
  })

  it('does not collide at the invisible bounding-box corners of an ellipse plate', () => {
    const result = geometry('ellipse')
    expect(pointHitsCollider(result, { x: 0, y: result.panel.centerY + 0.8, z: 0 })).toBe(true)
    expect(pointHitsCollider(result, { x: 0.8, y: result.panel.centerY + 0.8, z: 0 })).toBe(false)
  })

  it('uses the image alpha contour instead of a full rectangular plate', () => {
    const alpha = new Uint8ClampedArray(64)
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        if (x === 3 || x === 4 || y === 3 || y === 4) alpha[y * 8 + x] = 255
      }
    }
    const layout = alphaMaskToCollisionLayout(alpha, 8, 8, { gridSize: 8 })
    const result = geometry('contour', layout.rectangles)

    expect(pointHitsCollider(result, { x: 0, y: result.panel.centerY + 0.75, z: 0 })).toBe(true)
    expect(pointHitsCollider(result, { x: -0.75, y: result.panel.centerY + 0.75, z: 0 })).toBe(false)
  })

  it('uses an oval base instead of its rectangular bounding box', () => {
    const result = geometry('ellipse')
    expect(pointHitsCollider(result, { x: 0.4, y: result.base.centerY, z: 0 })).toBe(true)
    expect(pointHitsCollider(result, { x: 0.45, y: result.base.centerY, z: 0.225 })).toBe(false)
  })

  it('applies non-uniform item scale to the same collision silhouette', () => {
    const result = geometry('ellipse')
    const scaledCenterY = result.panel.centerY * 0.5
    expect(pointHitsCollider(result, { x: 1.6, y: scaledCenterY, z: 0 }, { x: 2, y: 0.5, z: 3 })).toBe(true)
    expect(pointHitsCollider(result, { x: 1.6, y: scaledCenterY + 0.4, z: 0 }, { x: 2, y: 0.5, z: 3 })).toBe(false)
  })
})
