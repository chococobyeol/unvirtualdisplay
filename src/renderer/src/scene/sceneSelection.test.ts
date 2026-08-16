import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { DISPLAY_CASE_SELECTION_ID } from '../../../shared/types'
import { pickSceneSelection } from './sceneSelection'

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
  it('selects an exhibit even when the case is closer to the camera', () => {
    const item = new THREE.Group()
    item.userData.itemId = 'figure-1'
    item.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))
    item.updateMatrixWorld(true)

    const caseLayer = new THREE.Group()
    const frontPanel = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 0.1))
    frontPanel.position.z = 2
    caseLayer.add(frontPanel)
    caseLayer.updateMatrixWorld(true)

    expect(pickSceneSelection(centerRay(), [item], caseLayer)).toBe('figure-1')
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
