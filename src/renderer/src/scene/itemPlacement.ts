import * as THREE from 'three'
import type { TransformState } from '../../../shared/types'

const CASE_MIN_X = -2.48
const CASE_MAX_X = 2.48
const CASE_MIN_Z = -1.12
const CASE_MAX_Z = 1.12
const SHELF_SURFACES = [2.83, 1.47, 0]
const FALLBACK_FLOOR_SURFACE = -0.18
const RECOVERY_FLOOR_LIMIT = -0.28
const PLACEMENT_STEP = 0.2
const ITEM_GAP = 0.08

function centeredCandidates(minimum: number, maximum: number): number[] {
  if (minimum > maximum) return []
  const candidates: number[] = []
  const add = (value: number): void => {
    if (value < minimum - 0.0001 || value > maximum + 0.0001) return
    if (!candidates.some((candidate) => Math.abs(candidate - value) < 0.0001)) candidates.push(value)
  }

  add(Math.min(maximum, Math.max(minimum, 0)))
  const furthest = Math.max(Math.abs(minimum), Math.abs(maximum))
  for (let distance = PLACEMENT_STEP; distance <= furthest + PLACEMENT_STEP / 2; distance += PLACEMENT_STEP) {
    add(-distance)
    add(distance)
  }
  add(minimum)
  add(maximum)
  return candidates
}

export function transformedItemBounds(bounds: THREE.Box3, transform: TransformState): THREE.Box3 {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(transform.position.x, transform.position.y, transform.position.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(transform.rotation.x, transform.rotation.y, transform.rotation.z)),
    new THREE.Vector3(transform.scale.x, transform.scale.y, transform.scale.z)
  )
  return bounds.clone().applyMatrix4(matrix)
}

export function isPlacementBelowSafetyFloor(bounds: THREE.Box3, transform: TransformState): boolean {
  return transformedItemBounds(bounds, transform).min.y < RECOVERY_FLOOR_LIMIT
}

function boxAt(bounds: THREE.Box3, position: THREE.Vector3): THREE.Box3 {
  return bounds.clone().translate(position)
}

function isClear(candidate: THREE.Box3, occupied: THREE.Box3[]): boolean {
  const padded = candidate.clone().expandByScalar(ITEM_GAP)
  return occupied.every((bounds) => !padded.intersectsBox(bounds))
}

export function findOpenImportPosition(
  localBounds: THREE.Box3,
  transform: TransformState,
  occupied: THREE.Box3[]
): THREE.Vector3 {
  const bounds = transformedItemBounds(localBounds, {
    ...transform,
    position: { x: 0, y: 0, z: 0 }
  })
  const xCandidates = centeredCandidates(CASE_MIN_X - bounds.min.x, CASE_MAX_X - bounds.max.x)
  const zCandidates = centeredCandidates(CASE_MIN_Z - bounds.min.z, CASE_MAX_Z - bounds.max.z)

  for (const surface of SHELF_SURFACES) {
    const y = surface - bounds.min.y
    for (const z of zCandidates) {
      for (const x of xCandidates) {
        const position = new THREE.Vector3(x, y, z)
        if (isClear(boxAt(bounds, position), occupied)) return position
      }
    }
  }

  // If all shelves are full, keep the new item visible and movable on the
  // invisible floor just in front of the case instead of overlapping a display.
  const floorY = FALLBACK_FLOOR_SURFACE - bounds.min.y
  const stagingX = centeredCandidates(CASE_MIN_X - bounds.min.x, CASE_MAX_X - bounds.max.x)
  for (let row = 0; row < 4; row += 1) {
    const z = CASE_MAX_Z + ITEM_GAP - bounds.min.z + row * (bounds.max.z - bounds.min.z + ITEM_GAP * 2)
    for (const x of stagingX) {
      const position = new THREE.Vector3(x, floorY, z)
      if (isClear(boxAt(bounds, position), occupied)) return position
    }
  }

  return new THREE.Vector3(0, floorY, CASE_MAX_Z + ITEM_GAP - bounds.min.z)
}
