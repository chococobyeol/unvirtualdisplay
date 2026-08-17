import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { BuiltinObjectType, DisplayItem } from '../../../shared/types'
import { CLEAR_ACRYLIC_IOR, CLEAR_ACRYLIC_TRANSMISSION } from './acrylicMaterial'
import { createBuiltInObject, createDisplayCaseObject } from './builtInObjects'

function builtInItem(type: BuiltinObjectType, options: DisplayItem['builtin'] = { type }): DisplayItem {
  return {
    id: `test-${type}`,
    name: type,
    kind: 'builtin',
    format: 'object',
    assetUrl: '',
    relativePath: '',
    visible: true,
    builtin: options,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    },
    physics: { collision: true, preventToppling: true, placementLocked: false },
    animation: { enabled: false, clipIndex: 0, loop: true, speed: 1 }
  }
}

describe('built-in scene objects', () => {
  it('keeps the freeform primary case visually and physically empty', () => {
    const freeform = createDisplayCaseObject('custom')

    expect(freeform.root.children).toHaveLength(0)
    expect(freeform.colliders).toHaveLength(0)
  })

  it('reuses the display case geometry as a movable object', () => {
    const displayCase = createBuiltInObject(builtInItem('displayCase', {
      type: 'displayCase',
      casePreset: 'glass2'
    }))

    expect(displayCase.root.children.length).toBeGreaterThan(8)
    expect(displayCase.colliders.length).toBeGreaterThanOrEqual(5)
    expect(displayCase.bounds.max.y).toBeGreaterThan(2.8)
  })

  it('keeps the primary display case aligned with the established shelf coordinates', () => {
    const primaryCase = createDisplayCaseObject('modern1')

    expect(primaryCase.bounds.min.y).toBeCloseTo(-0.18, 5)
    expect(primaryCase.colliders[0].position[1]).toBeCloseTo(-0.09, 5)
  })

  it('builds every acrylic tier as a floor-supported U-shaped bridge', () => {
    const steps = createBuiltInObject(builtInItem('acrylicSteps', {
      type: 'acrylicSteps',
      steps: 4
    }))
    const treads = steps.colliders.filter((part) => part.halfExtents[0] > 1)
    const supports = steps.colliders.filter((part) => part.halfExtents[0] < 0.05)

    expect(steps.colliders).toHaveLength(12)
    expect(treads).toHaveLength(4)
    expect(supports).toHaveLength(8)
    expect(supports.every((part) => Math.abs(part.position[1] - part.halfExtents[1]) < 1e-6)).toBe(true)
    for (const tread of treads) {
      const tierSupports = supports.filter((part) => Math.abs(part.position[2] - tread.position[2]) < 1e-6)
      expect(tierSupports).toHaveLength(2)
      expect(tierSupports[0].position[0]).toBeCloseTo(-tierSupports[1].position[0], 6)
      expect(tierSupports[0].position[1] + tierSupports[0].halfExtents[1]).toBeCloseTo(
        tread.position[1] - tread.halfExtents[1],
        6
      )
    }
    expect(steps.bounds.max.y).toBeGreaterThan(1.5)
  })

  it('leaves the acrylic case front open for exhibit placement', () => {
    const acrylicCase = createBuiltInObject(builtInItem('acrylicCase'))

    expect(acrylicCase.colliders).toHaveLength(5)
    expect(acrylicCase.colliders.some((part) => part.position[2] > 1)).toBe(false)
  })

  it('uses rounded, flush-fitting panels for the acrylic case shell', () => {
    const acrylicCase = createBuiltInObject(builtInItem('acrylicCase'))
    const clearPanels: THREE.Mesh[] = []
    acrylicCase.root.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.isMesh && mesh.material instanceof THREE.MeshPhysicalMaterial) clearPanels.push(mesh)
    })
    const lid = clearPanels.find((panel) => (panel.geometry as THREE.BoxGeometry).parameters.height === 0.05)
    const walls = clearPanels.filter((panel) => panel !== lid)

    expect(clearPanels).toHaveLength(5)
    expect(clearPanels.every((panel) => panel.geometry.type === 'RoundedBoxGeometry')).toBe(true)
    expect(lid).toBeDefined()
    expect(lid!.position.y - 0.025).toBeCloseTo(Math.max(...walls.map((wall) => {
      const height = (wall.geometry as THREE.BoxGeometry).parameters.height
      return wall.position.y + height / 2
    })), 5)
  })

  it('creates visibly different low, standard, and tall acrylic cases', () => {
    const low = createBuiltInObject(builtInItem('acrylicCase', { type: 'acrylicCase', acrylicCaseVariant: 'low' }))
    const standard = createBuiltInObject(builtInItem('acrylicCase', { type: 'acrylicCase', acrylicCaseVariant: 'standard' }))
    const tall = createBuiltInObject(builtInItem('acrylicCase', { type: 'acrylicCase', acrylicCaseVariant: 'tall' }))

    expect(low.bounds.max.y).toBeLessThan(standard.bounds.max.y)
    expect(tall.bounds.max.y).toBeGreaterThan(standard.bounds.max.y)
    expect(low.bounds.max.x).toBeGreaterThan(tall.bounds.max.x)
  })

  it('can use physically transmissive acrylic for non-nested renders', () => {
    const objects = [
      createBuiltInObject(builtInItem('acrylicCase'), { acrylicRenderMode: 'physical' }),
      createBuiltInObject(builtInItem('acrylicSteps'), { acrylicRenderMode: 'physical' })
    ]

    for (const object of objects) {
      const materials: THREE.MeshPhysicalMaterial[] = []
      object.root.traverse((child) => {
        const mesh = child as THREE.Mesh
        if (mesh.isMesh && mesh.material instanceof THREE.MeshPhysicalMaterial) materials.push(mesh.material)
      })
      expect(materials.length).toBeGreaterThan(0)
      expect(materials.every((material) => material.opacity === 1)).toBe(true)
      expect(materials.every((material) => material.transparent === false)).toBe(true)
      expect(materials.every((material) => material.transmission === CLEAR_ACRYLIC_TRANSMISSION)).toBe(true)
      expect(materials.every((material) => material.ior === CLEAR_ACRYLIC_IOR)).toBe(true)
      expect(materials.every((material) => material.depthWrite)).toBe(true)
    }
  })

  it('uses nested-safe alpha blending by default', () => {
    const acrylicCase = createBuiltInObject(builtInItem('acrylicCase'))
    const materials: THREE.MeshPhysicalMaterial[] = []
    acrylicCase.root.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.isMesh && mesh.material instanceof THREE.MeshPhysicalMaterial) materials.push(mesh.material)
    })

    expect(materials.length).toBeGreaterThan(0)
    expect(materials.every((material) => material.transparent)).toBe(true)
    expect(materials.every((material) => material.transmission === 0)).toBe(true)
    expect(materials.every((material) => material.opacity === 0.08)).toBe(true)
    expect(materials.every((material) => material.depthWrite === false)).toBe(true)
  })

  it.each<BuiltinObjectType>(['pedestal', 'shelf'])('creates a bounded %s object', (type) => {
    const object = createBuiltInObject(builtInItem(type))

    expect(object.root.children.length).toBeGreaterThan(0)
    expect(object.colliders.length).toBeGreaterThan(0)
    expect(object.bounds.isEmpty()).toBe(false)
  })

  it.each<BuiltinObjectType>(['displayCase', 'acrylicCase', 'acrylicSteps', 'pedestal', 'shelf'])(
    'uses the floor as the transform origin for %s',
    (type) => {
      const object = createBuiltInObject(builtInItem(type))

      expect(object.bounds.min.y).toBeCloseTo(0, 5)
    }
  )

  it('includes both shelf supports in its collision shape', () => {
    const shelf = createBuiltInObject(builtInItem('shelf'))

    expect(shelf.colliders).toHaveLength(3)
    expect(shelf.colliders.every((part) => part.position[1] - part.halfExtents[1] >= -1e-6)).toBe(true)
  })
})
