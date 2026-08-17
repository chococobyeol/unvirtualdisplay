import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { DISPLAY_CASE_SELECTION_ID } from '../../../shared/types'
import { pickSceneSelection, transformAxisAtPointer } from './sceneSelection'

function centerRay(): THREE.Raycaster {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.set(0, 0, 5)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera)
  return raycaster
}

describe('pickSceneSelection', () => {
  it('selects the case when its opaque surface is closer to the camera', () => {
    const item = new THREE.Group()
    item.userData.itemId = 'figure-1'
    item.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))
    item.updateMatrixWorld(true)

    const caseLayer = new THREE.Group()
    const frontPanel = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 0.1))
    frontPanel.position.z = 2
    caseLayer.add(frontPanel)
    caseLayer.updateMatrixWorld(true)

    expect(pickSceneSelection(centerRay(), [item], caseLayer)).toBe(DISPLAY_CASE_SELECTION_ID)
  })

  it('selects an exhibit when its surface is in front of the case', () => {
    const item = new THREE.Group()
    item.userData.itemId = 'figure-1'
    const itemMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
    itemMesh.position.z = 2
    item.add(itemMesh)
    item.updateMatrixWorld(true)

    const caseLayer = new THREE.Group()
    caseLayer.add(new THREE.Mesh(new THREE.BoxGeometry(3, 3, 0.1)))
    caseLayer.updateMatrixWorld(true)

    expect(pickSceneSelection(centerRay(), [item], caseLayer)).toBe('figure-1')
  })

  it('skips any item marked for selection pass-through and selects the item behind it', () => {
    const front = new THREE.Group()
    front.userData.itemId = 'acrylic-case'
    front.userData.selectionPassThrough = true
    const frontMesh = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 0.1))
    frontMesh.position.z = 2
    front.add(frontMesh)
    front.updateMatrixWorld(true)

    const behind = new THREE.Group()
    behind.userData.itemId = 'figure-inside'
    behind.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))
    behind.updateMatrixWorld(true)

    expect(pickSceneSelection(centerRay(), [front, behind], null)).toBe('figure-inside')
  })

  it('applies selection pass-through to opaque models and images as the same common behavior', () => {
    const passThroughItem = new THREE.Group()
    passThroughItem.userData.itemId = 'opaque-item'
    passThroughItem.userData.selectionPassThrough = true
    passThroughItem.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 1)))
    passThroughItem.updateMatrixWorld(true)

    expect(pickSceneSelection(centerRay(), [passThroughItem], null)).toBeNull()
  })

  it('restores normal scene selection as soon as pass-through is disabled', () => {
    const item = new THREE.Group()
    item.userData.itemId = 'selectable-again'
    item.userData.selectionPassThrough = false
    item.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))
    item.updateMatrixWorld(true)

    expect(pickSceneSelection(centerRay(), [item], null)).toBe('selectable-again')
  })

  it('selects an exhibit through a transparent case surface', () => {
    const item = new THREE.Group()
    item.userData.itemId = 'figure-1'
    item.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))
    item.updateMatrixWorld(true)

    const caseLayer = new THREE.Group()
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 3),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.13, depthWrite: false })
    )
    glass.position.z = 2
    caseLayer.add(glass)
    caseLayer.updateMatrixWorld(true)

    expect(pickSceneSelection(centerRay(), [item], caseLayer)).toBe('figure-1')
  })

  it('still selects a transparent case surface when nothing is behind it', () => {
    const caseLayer = new THREE.Group()
    caseLayer.add(new THREE.Mesh(
      new THREE.PlaneGeometry(3, 3),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.13, depthWrite: false })
    ))
    caseLayer.updateMatrixWorld(true)

    expect(pickSceneSelection(centerRay(), [], caseLayer)).toBe(DISPLAY_CASE_SELECTION_ID)
  })

  it('selects the case when no exhibit is under the pointer', () => {
    const item = new THREE.Group()
    item.userData.itemId = 'figure-1'
    const itemMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
    itemMesh.position.x = 4
    item.add(itemMesh)
    item.updateMatrixWorld(true)

    const caseLayer = new THREE.Group()
    caseLayer.add(new THREE.Mesh(new THREE.BoxGeometry(3, 3, 0.1)))
    caseLayer.updateMatrixWorld(true)

    expect(pickSceneSelection(centerRay(), [item], caseLayer)).toBe(DISPLAY_CASE_SELECTION_ID)
  })

  it('returns no selection when the pointer hits empty space', () => {
    expect(pickSceneSelection(centerRay(), [], null)).toBeNull()
  })
})

describe('transformAxisAtPointer', () => {
  it('confirms the actual rotation picker used by TransformControls hover', () => {
    const element = {
      style: {},
      addEventListener(): void {},
      removeEventListener(): void {}
    } as unknown as HTMLElement
    const camera = new THREE.PerspectiveCamera(45, 10 / 7, 0.1, 100)
    camera.position.set(4, 3, 7)
    camera.lookAt(0, 1, 0)
    const scene = new THREE.Scene()
    const object = new THREE.Group()
    object.position.set(0, 1, 0)
    scene.add(object)
    const controls = new TransformControls(camera, element)
    scene.add(controls.getHelper())
    controls.attach(object).setMode('rotate')
    scene.updateMatrixWorld(true)
    const pointer = new THREE.Vector2(-0.14, -0.35)

    controls.pointerHover({ x: pointer.x, y: pointer.y, button: -1 } as unknown as PointerEvent)
    const highlightedAxis = controls.axis

    expect(highlightedAxis).not.toBeNull()
    expect(transformAxisAtPointer(controls, pointer, 0)).toBe(highlightedAxis)
    controls.dispose()
  })

  it('uses the same native axis that was already highlighted', () => {
    const pointer = new THREE.Vector2(0.2, -0.35)
    const calls: Array<{ x: number; y: number; button: number }> = []
    const controls = {
      axis: 'Y' as string | null,
      pointerHover(next: PointerEvent | null): void {
        if (!next) return
        calls.push({ x: next.x, y: next.y, button: next.button })
        this.axis = 'Y'
      }
    }

    expect(transformAxisAtPointer(controls, pointer, 0)).toBe('Y')
    expect(calls).toEqual([{ x: 0.2, y: -0.35, button: 0 }])
  })

  it('refreshes the native picker for a direct press without prior hover', () => {
    let refreshed = false
    const controls = {
      axis: null as string | null,
      pointerHover(): void {
        refreshed = true
        this.axis = 'Y'
      }
    }

    expect(transformAxisAtPointer(controls, new THREE.Vector2(), 0)).toBe('Y')
    expect(refreshed).toBe(true)
  })

  it('rejects a stale highlighted axis when the pointerdown no longer hits it', () => {
    const controls = {
      axis: 'Z' as string | null,
      pointerHover(): void { this.axis = null }
    }

    expect(transformAxisAtPointer(controls, new THREE.Vector2(0.8, 0.8), 0)).toBeNull()
  })
})
