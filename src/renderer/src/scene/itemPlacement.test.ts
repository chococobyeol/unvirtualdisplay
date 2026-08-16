import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { TransformState } from '../../../shared/types'
import { findOpenImportPosition } from './itemPlacement'

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

    expect(position.y).toBeCloseTo(0)
    expect(position.z).toBeGreaterThan(1.12)
  })
})
