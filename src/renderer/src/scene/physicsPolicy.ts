import RAPIER from '@dimforge/rapier3d-compat'
import type { DisplayItem, Vec3 } from '../../../shared/types'
import type { ColliderBox } from './builtInObjects'

export const ENVIRONMENT_GROUP = 0x0001
export const ITEM_GROUP = 0x0002
const OVERLAP_DEPTH_TOLERANCE = 0.005

const CLEAR_POSITION_DIRECTIONS: readonly Vec3[] = (() => {
  const directions: Vec3[] = []
  for (const x of [-1, 0, 1]) {
    for (const y of [-1, 0, 1]) {
      for (const z of [-1, 0, 1]) {
        const length = Math.hypot(x, y, z)
        if (length === 0) continue
        directions.push({ x: x / length, y: y / length, z: z / length })
      }
    }
  }
  directions.sort((left, right) => {
    const verticalRank = (direction: Vec3): number => direction.y > 0.1 ? 0 : direction.y < -0.1 ? 2 : 1
    const axisCount = (direction: Vec3): number => [direction.x, direction.y, direction.z]
      .filter((value) => Math.abs(value) > 0.1).length
    return verticalRank(left) - verticalRank(right) || axisCount(left) - axisCount(right)
  })
  return directions
})()

export function groupMask(memberships: number, filters: number): number {
  return (memberships << 16) | filters
}

export function environmentCollisionGroups(): number {
  return groupMask(ENVIRONMENT_GROUP, ITEM_GROUP)
}

export function itemCollisionGroups(item: DisplayItem): number {
  return groupMask(ITEM_GROUP, ENVIRONMENT_GROUP | (item.physics.collision ? ITEM_GROUP : 0))
}

function registeredBody(
  world: RAPIER.World,
  body: RAPIER.RigidBody | null,
  bodyWorldGeneration: number,
  currentWorldGeneration: number
): RAPIER.RigidBody | null {
  if (body === null || bodyWorldGeneration !== currentWorldGeneration) return null

  // Do not call a method on `body` before checking the current world's
  // registry. A wrapper left behind after its WASM body was removed can throw
  // and poison Rapier's internal borrow state even when that error is caught.
  const currentBody = world.bodies.get(body.handle)
  return currentBody?.isEnabled() ? currentBody : null
}

export function bodyNeedsRebuild(
  world: RAPIER.World,
  body: RAPIER.RigidBody | null,
  bodyWorldGeneration: number,
  currentWorldGeneration: number
): boolean {
  return registeredBody(world, body, bodyWorldGeneration, currentWorldGeneration) === null
}

export function bodyCanSyncSettledTransform(
  world: RAPIER.World,
  body: RAPIER.RigidBody,
  bodyWorldGeneration: number,
  currentWorldGeneration: number,
  dragging: boolean
): boolean {
  if (dragging) return false
  const currentBody = registeredBody(world, body, bodyWorldGeneration, currentWorldGeneration)
  return currentBody !== null && (
    currentBody.bodyType() !== RAPIER.RigidBodyType.Dynamic || currentBody.isSleeping()
  )
}

/**
 * Tests a body's collider shapes against everything their collision groups
 * actually permit. In particular, this includes other display items when
 * item-to-item collision is enabled; filtering to fixed environment bodies
 * would incorrectly accept an interpenetrating item pose as safe.
 */
export function bodyOverlapsCollisionScene(
  world: RAPIER.World,
  body: RAPIER.RigidBody,
  offset: Vec3 = { x: 0, y: 0, z: 0 },
  scanAllColliders = false
): boolean {
  for (let index = 0; index < body.numColliders(); index += 1) {
    const collider = body.collider(index)
    const translation = collider.translation()
    const candidateTranslation = {
      x: translation.x + offset.x,
      y: translation.y + offset.y,
      z: translation.z + offset.z
    }
    let hasMeaningfulPenetration = false
    const overlaps = (otherCollider: RAPIER.Collider): boolean => {
      const contact = collider.shape.contactShape(
        candidateTranslation,
        collider.rotation(),
        otherCollider.shape,
        otherCollider.translation(),
        otherCollider.rotation(),
        0
      )
      return Boolean(contact && contact.distance < -OVERLAP_DEPTH_TOLERANCE)
    }

    if (scanAllColliders) {
      const ownGroups = collider.collisionGroups()
      const ownMemberships = ownGroups >>> 16
      const ownFilter = ownGroups & 0xffff
      world.forEachCollider((otherCollider) => {
        if (hasMeaningfulPenetration || otherCollider.handle === collider.handle || otherCollider.isSensor()) return
        if (otherCollider.parent()?.handle === body.handle) return
        const otherGroups = otherCollider.collisionGroups()
        const otherMemberships = otherGroups >>> 16
        const otherFilter = otherGroups & 0xffff
        if ((ownMemberships & otherFilter) === 0 || (otherMemberships & ownFilter) === 0) return
        hasMeaningfulPenetration = overlaps(otherCollider)
      })
    } else {
      world.intersectionsWithShape(
        candidateTranslation,
        collider.rotation(),
        collider.shape,
        (otherCollider) => {
          hasMeaningfulPenetration = overlaps(otherCollider)
          return !hasMeaningfulPenetration
        },
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        collider.collisionGroups(),
        collider,
        body
      )
    }
    if (hasMeaningfulPenetration) return true
  }
  return false
}

/** Finds the closest collision-free translation around an invalid pose. */
export function findNearestClearBodyPosition(
  world: RAPIER.World,
  body: RAPIER.RigidBody,
  maximumDistance = 4,
  scanAllColliders = false
): Vec3 | null {
  const origin = body.translation()
  if (!bodyOverlapsCollisionScene(world, body, { x: 0, y: 0, z: 0 }, scanAllColliders)) {
    return { x: origin.x, y: origin.y, z: origin.z }
  }

  const distances: number[] = []
  for (let distance = 0.02; distance <= Math.min(0.2, maximumDistance) + 0.0001; distance += 0.02) distances.push(distance)
  for (let distance = 0.25; distance <= Math.min(1, maximumDistance) + 0.0001; distance += 0.05) distances.push(distance)
  for (let distance = 1.1; distance <= maximumDistance + 0.0001; distance += 0.1) distances.push(distance)

  for (const distance of distances) {
    for (const direction of CLEAR_POSITION_DIRECTIONS) {
      const offset = {
        x: direction.x * distance,
        y: direction.y * distance,
        z: direction.z * distance
      }
      if (!bodyOverlapsCollisionScene(world, body, offset, scanAllColliders)) {
        return { x: origin.x + offset.x, y: origin.y + offset.y, z: origin.z + offset.z }
      }
    }
  }
  return null
}

export interface RestoredBodyEntry {
  body: RAPIER.RigidBody
  preservePosition: boolean
}

export interface RestoredBodyResolution {
  moved: Map<number, Vec3>
  unresolved: Set<number>
}

/**
 * Resolves meaningful penetrations before the first restored physics step.
 * Later entries move first, allowing callers to place supports before the
 * contents that should be repaired around them.
 */
export function resolveRestoredBodyOverlaps(
  world: RAPIER.World,
  entries: readonly RestoredBodyEntry[],
  maximumDistance = 1
): RestoredBodyResolution {
  const moved = new Map<number, Vec3>()
  const unresolved = new Set<number>()

  // setTranslation updates the body immediately, but attached collider world
  // transforms are propagated lazily. The overlap queries below read collider
  // transforms directly, so keep them in sync while repairing multiple bodies.
  world.propagateModifiedBodyPositionsToColliders()

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const { body, preservePosition } = entries[index]
    if (body.bodyType() === RAPIER.RigidBodyType.Dynamic) {
      body.setLinvel({ x: 0, y: 0, z: 0 }, false)
      body.setAngvel({ x: 0, y: 0, z: 0 }, false)
    }
    if (preservePosition || !bodyOverlapsCollisionScene(world, body, { x: 0, y: 0, z: 0 }, true)) continue

    const clear = findNearestClearBodyPosition(world, body, maximumDistance, true)
    if (!clear) {
      unresolved.add(body.handle)
      continue
    }
    body.setTranslation(clear, false)
    world.propagateModifiedBodyPositionsToColliders()
    moved.set(body.handle, clear)
  }

  return { moved, unresolved }
}

export function createItemRigidBodyDescriptor(
  item: DisplayItem,
  quaternion: { x: number, y: number, z: number, w: number },
  freeImage = false
): RAPIER.RigidBodyDesc {
  const descriptor = item.physics.placementLocked
    ? RAPIER.RigidBodyDesc.fixed()
    : RAPIER.RigidBodyDesc.dynamic()
      .setCanSleep(true)
      .setLinearDamping(freeImage ? 2.6 : 1.8)
      .setAngularDamping(freeImage ? 5.5 : 2.8)
      .setCcdEnabled(true)
      .setAdditionalSolverIterations(freeImage ? 2 : 0)
  descriptor.setTranslation(item.transform.position.x, item.transform.position.y, item.transform.position.z)
  descriptor.setRotation(quaternion)
  return descriptor
}

export function configureItemRigidBody(body: RAPIER.RigidBody, item: DisplayItem): void {
  if (item.physics.preventToppling && !item.physics.placementLocked) body.lockRotations(true, true)
}

export function addBuiltInItemColliders(
  world: RAPIER.World,
  body: RAPIER.RigidBody,
  item: DisplayItem,
  parts: readonly ColliderBox[],
  scale: Vec3
): void {
  for (const part of parts) {
    const collider = RAPIER.ColliderDesc.cuboid(
      Math.max(0.01, Math.abs(part.halfExtents[0] * scale.x)),
      Math.max(0.01, Math.abs(part.halfExtents[1] * scale.y)),
      Math.max(0.01, Math.abs(part.halfExtents[2] * scale.z))
    )
      .setTranslation(
        part.position[0] * scale.x,
        part.position[1] * scale.y,
        part.position[2] * scale.z
      )
      .setFriction(0.72)
      .setRestitution(0)
      .setContactSkin(0.003)
      .setCollisionGroups(itemCollisionGroups(item))
    world.createCollider(collider, body)
  }
}
