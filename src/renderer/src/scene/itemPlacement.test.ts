import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { TransformState } from '../../../shared/types'
import { findOpenFloorPosition, findOpenImportPosition, fitImportedItemScale, isPlacementBelowSafetyFloor, transformedItemBounds } from './itemPlacement'

const transform: TransformState = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 }
}

const itemBounds = new THREE.Box3(
  new THREE.Vector3(-0.75, 0, -0.3),
  new THREE.Vector3(0.75, 1.2, 0.3)
)

describe('findOpenImportPosition', () => {
  it('places new items on the base of a single-tier display', () => {
    const position = findOpenImportPosition(itemBounds, transform, [], 'modern1')

    expect(position.x).toBe(0)
    expect(position.y).toBe(0)
    expect(position.z).toBe(0)
  })

  it('uses the upper shelf first in a two-tier display', () => {
    const position = findOpenImportPosition(itemBounds, transform, [], 'modern2')

    expect(position.x).toBe(0)
    expect(position.y).toBeCloseTo(1.47)
    expect(position.z).toBe(0)
  })

  it('uses the center of the top shelf when it is empty', () => {
    const position = findOpenImportPosition(itemBounds, transform, [])

    expect(position.x).toBe(0)
    expect(position.y).toBeCloseTo(2.83)
    expect(position.z).toBe(0)
  })

  it('chooses the nearest clear position instead of overlapping an item', () => {
    const occupied = [new THREE.Box3(
      new THREE.Vector3(-0.75, 2.83, -0.3),
      new THREE.Vector3(0.75, 4.03, 0.3)
    )]

    const position = findOpenImportPosition(itemBounds, transform, occupied)
    const placed = itemBounds.clone().translate(position).expandByScalar(0.079)

    expect(position.y).toBeCloseTo(2.83)
    expect(placed.intersectsBox(occupied[0])).toBe(false)
  })

  it('continues on the next shelf when the top shelf is full', () => {
    const occupied = [new THREE.Box3(
      new THREE.Vector3(-2.48, 2.8, -1.12),
      new THREE.Vector3(2.48, 4.2, 1.12)
    )]

    const position = findOpenImportPosition(itemBounds, transform, occupied)

    expect(position.y).toBeCloseTo(1.47)
  })

  it('uses the floor in front of the case when every shelf is full', () => {
    const occupied = [new THREE.Box3(
      new THREE.Vector3(-2.48, -0.1, -1.12),
      new THREE.Vector3(2.48, 4.2, 1.12)
    )]

    const position = findOpenImportPosition(itemBounds, transform, occupied)

    expect(position.y).toBeCloseTo(-0.18)
    expect(position.z).toBeGreaterThan(1.12)
  })

  it('places regular imports directly on the freeform floor', () => {
    const position = findOpenImportPosition(itemBounds, transform, [], 'custom')

    expect(position).toMatchObject({ x: 0, y: 0, z: 0 })
  })

  it('spreads regular imports across the freeform floor instead of stacking them', () => {
    const occupied = [itemBounds.clone()]
    const position = findOpenImportPosition(itemBounds, transform, occupied, 'custom')

    expect(position.y).toBe(0)
    expect(Math.abs(position.x) + Math.abs(position.z)).toBeGreaterThan(0)
    expect(itemBounds.clone().translate(position).intersectsBox(occupied[0])).toBe(false)
  })

  it('finds a clear floor position for structural objects', () => {
    const occupied = [itemBounds.clone()]
    const position = findOpenFloorPosition(itemBounds, transform, occupied)
    const placed = itemBounds.clone().translate(position).expandByScalar(0.079)

    expect(position.y).toBe(0)
    expect(position.z).toBe(0)
    expect(placed.intersectsBox(occupied[0])).toBe(false)
  })

  it('includes the saved position when calculating rendered bounds', () => {
    const placed = transformedItemBounds(itemBounds, {
      ...transform,
      position: { x: 1.2, y: 2.83, z: -0.4 },
      scale: { x: 0.6, y: 0.6, z: 0.6 }
    })

    expect(placed.min.x).toBeCloseTo(0.75)
    expect(placed.min.y).toBeCloseTo(2.83)
    expect(placed.min.z).toBeCloseTo(-0.58)
  })

  it('marks an item visibly sunk below the catch floor for recovery', () => {
    expect(isPlacementBelowSafetyFloor(itemBounds, {
      ...transform,
      position: { x: -1.29, y: -0.543, z: -0.08 },
      scale: { x: 0.6, y: 0.6, z: 0.6 }
    })).toBe(true)

    expect(isPlacementBelowSafetyFloor(itemBounds, {
      ...transform,
      position: { x: 0, y: -0.18, z: 2 }
    })).toBe(false)
  })

  it('uniformly shrinks a new import to the safe shelf height', () => {
    const oversized = new THREE.Box3(
      new THREE.Vector3(-0.75, 0, -0.35),
      new THREE.Vector3(0.75, 1.2, 0.35)
    )

    const scale = fitImportedItemScale(oversized, transform)

    expect(scale.x).toBeCloseTo(0.8)
    expect(scale.y).toBeCloseTo(0.8)
    expect(scale.z).toBeCloseTo(0.8)
  })

  it('does not enlarge an import that already fits safely', () => {
    const compact = new THREE.Box3(
      new THREE.Vector3(-0.45, 0, -0.25),
      new THREE.Vector3(0.45, 0.8, 0.25)
    )

    expect(fitImportedItemScale(compact, transform)).toEqual(transform.scale)
  })

  it('uses the same fitted scale regardless of which shelf receives the item', () => {
    const oversized = new THREE.Box3(
      new THREE.Vector3(-0.75, 0, -0.35),
      new THREE.Vector3(0.75, 1.2, 0.35)
    )

    const topShelf = fitImportedItemScale(oversized, {
      ...transform,
      position: { x: -1.4, y: 2.83, z: 0.6 }
    })
    const bottomShelf = fitImportedItemScale(oversized, {
      ...transform,
      position: { x: 1.2, y: 0, z: -0.8 }
    })

    expect(topShelf).toEqual(bottomShelf)
    expect(topShelf).toEqual({ x: 0.8, y: 0.8, z: 0.8 })
  })
})
