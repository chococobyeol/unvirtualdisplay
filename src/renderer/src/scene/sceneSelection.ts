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

type TransformHoverControls = {
  axis: string | null
  pointerHover: (pointer: PointerEvent | null) => void
}

export function transformAxisAtPointer(
  controls: TransformHoverControls | null,
  pointer: THREE.Vector2,
  button: number
): string | null {
  // Use TransformControls' own picker at the exact pointerdown coordinate.
  // This handles direct presses as well as prior hover and prevents a stale
  // highlighted axis from surviving after the pointer moved away.
  if (!controls) return null
  controls.pointerHover({ x: pointer.x, y: pointer.y, button } as unknown as PointerEvent)
  return controls.axis
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
