import * as THREE from 'three'
import { DISPLAY_CASE_SELECTION_ID } from '../../../shared/types'

function itemIdFromHit(hit: THREE.Object3D | undefined): string | null {
  let current: THREE.Object3D | null = hit ?? null
  while (current) {
    if (typeof current.userData.itemId === 'string') return current.userData.itemId
    current = current.parent
  }
  return null
}

export function pickItemSelection(raycaster: THREE.Raycaster, itemRoots: THREE.Object3D[]): string | null {
  return itemIdFromHit(raycaster.intersectObjects(itemRoots, true)[0]?.object)
}

function isVisibleThroughRoot(object: THREE.Object3D, root: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object
  while (current) {
    if (!current.visible) return false
    if (current === root) return true
    current = current.parent
  }
  return false
}

export function hitsVisibleTransformHandle(raycaster: THREE.Raycaster, gizmo: THREE.Object3D | null): boolean {
  if (!gizmo?.visible) return false
  return raycaster.intersectObject(gizmo, true)
    .some((hit) => isVisibleThroughRoot(hit.object, gizmo))
}

export function pickSceneSelection(
  raycaster: THREE.Raycaster,
  itemRoots: THREE.Object3D[],
  caseLayer: THREE.Object3D | null
): string | null {
  // The case often sits in front of an exhibit along the same ray. Test the
  // exhibits separately so the case never steals a click meant for an item.
  const itemId = pickItemSelection(raycaster, itemRoots)
  if (itemId) return itemId

  if (caseLayer && raycaster.intersectObject(caseLayer, true).length > 0) {
    return DISPLAY_CASE_SELECTION_ID
  }
  return null
}
