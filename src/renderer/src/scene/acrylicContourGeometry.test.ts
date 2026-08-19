import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { ACRYLIC_PANEL_DEPTH } from './imageAcrylicCollider'
import {
  alphaMaskToAcrylicShapes,
  connectAcrylicMaskComponents,
  createAcrylicContourCapGeometry,
  createAcrylicContourGeometry
} from './acrylicContourGeometry'

function mask(rows: readonly string[]): { alpha: Uint8ClampedArray, width: number, height: number } {
  const height = rows.length
  const width = rows[0].length
  const alpha = new Uint8ClampedArray(width * height)
  rows.forEach((row, y) => [...row].forEach((value, x) => {
    if (value === '#') alpha[y * width + x] = 255
  }))
  return { alpha, width, height }
}

describe('image acrylic contour geometry', () => {
  it('offsets the traced vector contour instead of expanding source pixels', () => {
    const source = mask([
      '.......',
      '..###..',
      '..###..',
      '..###..',
      '.......'
    ])
    const plain = createAcrylicContourGeometry({ ...source, worldWidth: 1.4, worldHeight: 1, offset: 0 })!
    const offset = createAcrylicContourGeometry({ ...source, worldWidth: 1.4, worldHeight: 1, offset: 0.1 })!
    plain.geometry.computeBoundingBox()
    offset.geometry.computeBoundingBox()

    expect(offset.geometry.boundingBox!.min.x).toBeLessThan(plain.geometry.boundingBox!.min.x - 0.09)
    expect(offset.geometry.boundingBox!.max.x).toBeGreaterThan(plain.geometry.boundingBox!.max.x + 0.09)
    expect(offset.paths[0].some((point) => (
      Math.abs(point.x * source.width / 1.4 - Math.round(point.x * source.width / 1.4)) > 1e-3
    ))).toBe(true)
    plain.geometry.dispose()
    offset.geometry.dispose()
  })

  it('turns the visible alpha silhouette into a continuous wall with real depth', () => {
    const source = mask([
      '..##..',
      '.####.',
      '######',
      '..##..'
    ])
    const contour = createAcrylicContourGeometry({
      ...source,
      worldWidth: 1.2,
      worldHeight: 0.8,
      simplifyTolerance: 0
    })

    expect(contour).not.toBeNull()
    contour!.geometry.computeBoundingBox()
    expect(contour!.geometry.boundingBox!.max.z - contour!.geometry.boundingBox!.min.z).toBeCloseTo(ACRYLIC_PANEL_DEPTH)
    expect(contour!.geometry.index).not.toBeNull()
    expect(contour!.geometry.getAttribute('normal').count).toBe(contour!.geometry.getAttribute('position').count)
    contour!.geometry.dispose()
  })

  it('rounds pixel-grid corners with curves while retaining the traced silhouette', () => {
    const source = mask([
      '..###..',
      '.#####.',
      '#######',
      '.#####.',
      '..###..'
    ])
    const [shape] = alphaMaskToAcrylicShapes({ ...source, worldWidth: 1.4, worldHeight: 1 })
    const [unsmoothed] = alphaMaskToAcrylicShapes({
      ...source,
      worldWidth: 1.4,
      worldHeight: 1,
      cornerRadius: 0
    })

    expect(shape.curves.some((curve) => 'isQuadraticBezierCurve' in curve)).toBe(true)
    expect(unsmoothed.curves.some((curve) => 'isQuadraticBezierCurve' in curve)).toBe(false)
  })

  it('shares indexed side-wall vertices instead of splitting every visible facet', () => {
    const source = mask([
      '..###..',
      '.#####.',
      '#######',
      '.#####.',
      '..###..'
    ])
    const geometry = createAcrylicContourGeometry({ ...source, worldWidth: 1.4, worldHeight: 1 })!.geometry
    const referenced = new Set(Array.from(geometry.index!.array))
    expect(geometry.index!.count).toBeGreaterThan(geometry.getAttribute('position').count)
    expect(referenced.size).toBe(geometry.getAttribute('position').count)
    geometry.dispose()
  })

  it('keeps detailed contour triangulation out of the clear front and back surfaces', () => {
    const caps = createAcrylicContourCapGeometry(1.2, 0.8)
    const positions = caps.getAttribute('position')
    const indices = caps.index!
    expect(indices.count).toBe(12)
    for (let triangle = 0; triangle < indices.count; triangle += 3) {
      const z = [0, 1, 2].map((offset) => positions.getZ(indices.getX(triangle + offset)))
      expect(new Set(z).size).toBe(1)
    }
    caps.dispose()
  })

  it('fills transparent internal gaps as clear acrylic instead of cutting holes', () => {
    const source = mask([
      '#####',
      '#...#',
      '#...#',
      '#####'
    ])
    const shapes = alphaMaskToAcrylicShapes({ ...source, worldWidth: 1, worldHeight: 1 })

    expect(shapes).toHaveLength(1)
    expect(shapes[0].holes).toHaveLength(0)
    const triangles = THREE.ShapeUtils.triangulateShape(shapes[0].getPoints(), [])
    expect(triangles.length).toBeGreaterThan(0)
  })

  it('joins disconnected artwork into one manufacturable clear plate', () => {
    const source = mask([
      '##....',
      '##....',
      '....##',
      '....##'
    ])
    const connected = connectAcrylicMaskComponents(source.alpha, source.width, source.height, { bridgeRadius: 1 })
    const shapes = alphaMaskToAcrylicShapes({ ...source, alpha: connected, worldWidth: 1.2, worldHeight: 0.8 })
    expect(shapes).toHaveLength(1)
  })

  it('does not grow a bridge toward tiny opaque export noise', () => {
    const source = mask([
      '...........',
      '.####......',
      '.####......',
      '.####......',
      '.####.....#',
      '...........'
    ])
    const connected = connectAcrylicMaskComponents(source.alpha, source.width, source.height)
    const shapes = alphaMaskToAcrylicShapes({ ...source, alpha: connected, worldWidth: 2.2, worldHeight: 1.2 })

    expect(connected[4 * source.width + 10]).toBe(0)
    expect(shapes).toHaveLength(1)
  })

  it('ignores nearly transparent alpha specks without bridging them', () => {
    const source = mask([
      '.........',
      '.####....',
      '.####....',
      '.####....',
      '.........'
    ])
    source.alpha[4 * source.width + 8] = 8
    const connected = connectAcrylicMaskComponents(source.alpha, source.width, source.height)
    const shapes = alphaMaskToAcrylicShapes({ ...source, alpha: connected, worldWidth: 1.8, worldHeight: 1 })

    expect(connected.slice(4 * source.width + 4, 4 * source.width + 8)).toEqual(new Uint8ClampedArray(4))
    expect(shapes).toHaveLength(1)
  })

  it('bridges corner-touching pixels that extrusion would otherwise split', () => {
    const source = mask([
      '##..',
      '##..',
      '..##',
      '..##'
    ])
    const connected = connectAcrylicMaskComponents(source.alpha, source.width, source.height, { bridgeRadius: 1 })
    const shapes = alphaMaskToAcrylicShapes({ ...source, alpha: connected, worldWidth: 1, worldHeight: 1 })
    expect(shapes).toHaveLength(1)
  })

  it('returns no panel geometry for a fully transparent image', () => {
    expect(createAcrylicContourGeometry({
      alpha: new Uint8ClampedArray(16),
      width: 4,
      height: 4,
      worldWidth: 1,
      worldHeight: 1
    })).toBeNull()
  })
})
