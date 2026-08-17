import * as THREE from 'three'
import type { CasePreset, TransformState } from '../../../shared/types'
import { getCaseLayout } from './caseLayout'

const CASE_MIN_X = -2.48
const CASE_MAX_X = 2.48
const CASE_MIN_Z = -1.12
const CASE_MAX_Z = 1.12
const FALLBACK_FLOOR_SURFACE = -0.18
const RECOVERY_FLOOR_LIMIT = -0.28
const PLACEMENT_STEP = 0.2
const ITEM_GAP = 0.08
// The top compartment has the least vertical clearance. New imports are
// uniformly shrunk to this envelope so their visual bounds and colliders do
// not start out intersecting a shelf, frame, or side wall.
const IMPORT_MAX_WIDTH = 1.6
const IMPORT_MAX_HEIGHT = 0.96
const IMPORT_MAX_DEPTH = 1.45

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

export function fitImportedItemScale(bounds: THREE.Box3, transform: TransformState): TransformState['scale'] {
  const renderedBounds = transformedItemBounds(bounds, {
    ...transform,
    position: { x: 0, y: 0, z: 0 }
  })
  const size = renderedBounds.getSize(new THREE.Vector3())
  const ratios = [
    size.x > 0.0001 ? IMPORT_MAX_WIDTH / size.x : 1,
    size.y > 0.0001 ? IMPORT_MAX_HEIGHT / size.y : 1,
    size.z > 0.0001 ? IMPORT_MAX_DEPTH / size.z : 1
  ].filter(Number.isFinite)
  const shrink = Math.min(1, ...ratios)
  if (!(shrink > 0) || shrink >= 1) return { ...transform.scale }
  const scaled = (value: number): number => Number((value * shrink).toFixed(6))
  return {
    x: scaled(transform.scale.x),
    y: scaled(transform.scale.y),
    z: scaled(transform.scale.z)
  }
}

function boxAt(bounds: THREE.Box3, position: THREE.Vector3): THREE.Box3 {
  return bounds.clone().translate(position)
}

function isClear(candidate: THREE.Box3, occupied: THREE.Box3[]): boolean {
  const padded = candidate.clone().expandByScalar(ITEM_GAP)
  return occupied.every((bounds) => !padded.intersectsBox(bounds))
}

export function findOpenFloorPosition(
  localBounds: THREE.Box3,
  transform: TransformState,
  occupied: THREE.Box3[]
): THREE.Vector3 {
  const bounds = transformedItemBounds(localBounds, {
    ...transform,
    position: { x: 0, y: 0, z: 0 }
  })
  const y = Math.abs(bounds.min.y) < 1e-7 ? 0 : -bounds.min.y
  const stepX = Math.max(1.2, bounds.max.x - bounds.min.x + ITEM_GAP * 3)
  const stepZ = Math.max(1.2, bounds.max.z - bounds.min.z + ITEM_GAP * 3)

  for (let radius = 0; radius <= 6; radius += 1) {
    const offsets: { x: number, z: number }[] = []
    for (let zIndex = -radius; zIndex <= radius; zIndex += 1) {
      for (let xIndex = -radius; xIndex <= radius; xIndex += 1) {
        if (radius > 0 && Math.abs(xIndex) !== radius && Math.abs(zIndex) !== radius) continue
        offsets.push({ x: xIndex, z: zIndex })
      }
    }
    offsets.sort((left, right) => {
      const leftDistance = Math.abs(left.x) + Math.abs(left.z)
      const rightDistance = Math.abs(right.x) + Math.abs(right.z)
      if (leftDistance !== rightDistance) return leftDistance - rightDistance
      if (Math.abs(left.z) !== Math.abs(right.z)) return Math.abs(left.z) - Math.abs(right.z)
      return left.x - right.x
    })
    for (const offset of offsets) {
      const x = offset.x === 0 ? 0 : offset.x * stepX
      const z = offset.z === 0 ? 0 : offset.z * stepZ
      const position = new THREE.Vector3(x, y, z)
      if (isClear(boxAt(bounds, position), occupied)) return position
    }
  }
  return new THREE.Vector3(0, y, 0)
}

export function findOpenImportPosition(
  localBounds: THREE.Box3,
  transform: TransformState,
  occupied: THREE.Box3[],
  casePreset: CasePreset = 'modern3'
): THREE.Vector3 {
  if (casePreset === 'custom') return findOpenFloorPosition(localBounds, transform, occupied)

  const bounds = transformedItemBounds(localBounds, {
    ...transform,
    position: { x: 0, y: 0, z: 0 }
  })
  const xCandidates = centeredCandidates(CASE_MIN_X - bounds.min.x, CASE_MAX_X - bounds.max.x)
  const zCandidates = centeredCandidates(CASE_MIN_Z - bounds.min.z, CASE_MAX_Z - bounds.max.z)

  for (const surface of getCaseLayout(casePreset).placementSurfaces) {
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
