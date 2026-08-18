import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { inverseDisplayScale, scaleCaseCollider } from './displayScale'

describe('display case scaling', () => {
  it('keeps exhibits at the same position and size while scaling only the case', () => {
    const displayRoot = new THREE.Group()
    const caseLayer = new THREE.Group()
    const itemLayer = new THREE.Group()
    const displayCase = new THREE.Object3D()
    const exhibit = new THREE.Object3D()
    displayRoot.position.set(2, 1, -3)
    displayRoot.rotation.y = 0.4
    displayCase.position.set(1, 0.5, -0.25)
    exhibit.position.set(0.75, 1.2, -0.4)
    exhibit.scale.set(0.8, 1.1, 0.9)
    caseLayer.add(displayCase)
    itemLayer.add(exhibit)
    displayRoot.add(caseLayer, itemLayer)
    displayRoot.updateMatrixWorld(true)

    const originalPosition = exhibit.getWorldPosition(new THREE.Vector3())
    const originalScale = exhibit.getWorldScale(new THREE.Vector3())

    displayRoot.scale.set(1.8, 0.65, 1.35)
    const inverse = inverseDisplayScale(displayRoot.scale)
    itemLayer.scale.set(inverse.x, inverse.y, inverse.z)
    displayRoot.updateMatrixWorld(true)

    expect(exhibit.getWorldPosition(new THREE.Vector3()).distanceTo(originalPosition)).toBeLessThan(1e-6)
    expect(exhibit.getWorldScale(new THREE.Vector3()).distanceTo(originalScale)).toBeLessThan(1e-6)
    expect(displayCase.getWorldScale(new THREE.Vector3()).toArray()).toEqual([1.8, 0.65, 1.35])
  })

  it('scales case collision dimensions and offsets without producing negative extents', () => {
    expect(scaleCaseCollider(
      { halfExtents: [1, 2, 3], position: [4, 5, 6] },
      { x: 2, y: 0.5, z: -3 }
    )).toEqual({
      halfExtents: [2, 1, 9],
      position: [8, 2.5, -18]
    })
  })

  it('keeps the compensation finite when a scale axis reaches zero', () => {
    const inverse = inverseDisplayScale({ x: 0, y: -0, z: Number.NaN })
    expect(Number.isFinite(inverse.x)).toBe(true)
    expect(Number.isFinite(inverse.y)).toBe(true)
    expect(Number.isFinite(inverse.z)).toBe(true)
  })
})
