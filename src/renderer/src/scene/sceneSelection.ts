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

function isVisibleThroughRoot(object: THREE.Object3D, root: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object
  while (current) {
    if (!current.visible) return false
    if (current === root) return true
    current = current.parent
  }
  return false
}

function rootContaining(object: THREE.Object3D, roots: THREE.Object3D[]): THREE.Object3D | null {
  let current: THREE.Object3D | null = object
  while (current) {
    if (roots.includes(current)) return current
    current = current.parent
  }
  return null
}

function isPassThroughCaseSurface(object: THREE.Object3D): boolean {
  if (object instanceof THREE.Line || object instanceof THREE.LineSegments) return true
  const material = (object as THREE.Mesh).material
  if (!material) return false
  const materials = Array.isArray(material) ? material : [material]
  return materials.length > 0 && materials.every((entry) =>
    entry.transparent && (entry.opacity < 0.5 || entry.depthWrite === false)
  )
}

export function pickItemSelection(raycaster: THREE.Raycaster, itemRoots: THREE.Object3D[]): string | null {
  for (const hit of raycaster.intersectObjects(itemRoots, true)) {
    const root = rootContaining(hit.object, itemRoots)
    if (!root || !isVisibleThroughRoot(hit.object, root)) continue
    const itemId = itemIdFromHit(hit.object)
    if (itemId) return itemId
  }
  return null
}

export function hitsVisibleTransformHandle(raycaster: THREE.Raycaster, gizmo: THREE.Object3D | null): boolean {
  if (!gizmo?.visible) return false
  return raycaster.intersectObject(gizmo, true)
    .some((hit) => {
      if (!isVisibleThroughRoot(hit.object, gizmo)) return false

      // TransformControls includes a 100000x100000 drag plane beneath the
      // rendered arrows. Its object remains visible for raycasting while only
      // its material is hidden, so treating it as a handle blocks every scene
      // click after the first selection.
      if ((hit.object as THREE.Object3D & { isTransformControlsPlane?: boolean }).isTransformControlsPlane) {
        return false
      }

      const material = (hit.object as THREE.Mesh).material
      if (!material) return false
      const materials = Array.isArray(material) ? material : [material]
      return materials.some((entry) => entry.visible && (!entry.transparent || entry.opacity > 0.01))
    })
}

export function pickSceneSelection(
  raycaster: THREE.Raycaster,
  itemRoots: THREE.Object3D[],
  caseLayer: THREE.Object3D | null
): string | null {
  const roots = caseLayer ? [...itemRoots, caseLayer] : itemRoots
  let passThroughCaseHit = false

  for (const hit of raycaster.intersectObjects(roots, true)) {
    const itemRoot = rootContaining(hit.object, itemRoots)
    if (itemRoot) {
      if (!isVisibleThroughRoot(hit.object, itemRoot)) continue
      const itemId = itemIdFromHit(hit.object)
      if (itemId) return itemId
      continue
    }

    if (!caseLayer || !isVisibleThroughRoot(hit.object, caseLayer)) continue
    if (isPassThroughCaseSurface(hit.object)) {
      passThroughCaseHit = true
      continue
    }
    return DISPLAY_CASE_SELECTION_ID
  }

  return passThroughCaseHit ? DISPLAY_CASE_SELECTION_ID : null
}
