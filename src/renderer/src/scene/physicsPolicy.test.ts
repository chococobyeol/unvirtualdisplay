import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, describe, expect, it } from 'vitest'
import type { AcrylicCaseVariant, CasePreset, DisplayItem } from '../../../shared/types'
import { createBuiltInObject } from './builtInObjects'
import {
  addBuiltInItemColliders,
  bodyCanSyncSettledTransform,
  bodyNeedsRebuild,
  bodyOverlapsCollisionScene,
  configureItemRigidBody,
  createItemRigidBodyDescriptor,
  environmentCollisionGroups,
  findNearestClearBodyPosition,
  itemCollisionGroups,
  resolveRestoredBodyOverlaps
} from './physicsPolicy'

function pedestalItem(options: { y?: number, locked?: boolean, collision?: boolean } = {}): DisplayItem {
  return {
    id: crypto.randomUUID(),
    name: 'Square pedestal',
    kind: 'builtin',
    format: 'object',
    assetUrl: '',
    relativePath: '',
    visible: true,
    builtin: { type: 'pedestal' },
    transform: {
      position: { x: 0, y: options.y ?? 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    },
    physics: {
      collision: options.collision ?? true,
      preventToppling: true,
      placementLocked: options.locked ?? false
    },
    animation: { enabled: false, clipIndex: 0, loop: true, speed: 1 }
  }
}

function acrylicStepsItem(y = 0): DisplayItem {
  return {
    ...pedestalItem({ y }),
    name: 'Acrylic steps',
    builtin: { type: 'acrylicSteps', steps: 3 },
    physics: { collision: true, preventToppling: false, placementLocked: false }
  }
}

function displayCaseItem(casePreset: CasePreset = 'modern3'): DisplayItem {
  return {
    ...pedestalItem(),
    name: 'Modern display case',
    builtin: { type: 'displayCase', casePreset }
  }
}

function acrylicCaseItem(variant: AcrylicCaseVariant, y: number): DisplayItem {
  return {
    ...pedestalItem({ y }),
    name: `Acrylic case ${variant}`,
    builtin: { type: 'acrylicCase', acrylicCaseVariant: variant }
  }
}

function addFloor(world: RAPIER.World): void {
  const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0))
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(10, 0.1, 10).setCollisionGroups(environmentCollisionGroups()),
    floor
  )
}

function addPedestal(world: RAPIER.World, item: DisplayItem): RAPIER.RigidBody {
  const built = createBuiltInObject(item)
  const body = world.createRigidBody(createItemRigidBodyDescriptor(item, { x: 0, y: 0, z: 0, w: 1 }))
  configureItemRigidBody(body, item)
  addBuiltInItemColliders(world, body, item, built.colliders, item.transform.scale)
  return body
}

function settle(world: RAPIER.World, frames = 240): void {
  world.timestep = 1 / 60
  for (let frame = 0; frame < frames; frame += 1) world.step()
}

function addKinematicBox(world: RAPIER.World, item: DisplayItem, x: number): RAPIER.RigidBody {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, 0.5, 0))
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setCollisionGroups(itemCollisionGroups(item)),
    body
  )
  return body
}

beforeAll(async () => {
  await RAPIER.init()
})

describe('item physics policy', () => {
  it('rebuilds a stale body reference after its body has been removed', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic())

    expect(bodyNeedsRebuild(world, body, 1, 1)).toBe(false)
    world.removeRigidBody(body)
    expect(bodyNeedsRebuild(world, body, 1, 1)).toBe(true)
    world.free()
  })

  it('does not touch a body wrapper owned by an older physics world', () => {
    const oldWorld = new RAPIER.World({ x: 0, y: 0, z: 0 })
    const oldBody = oldWorld.createRigidBody(RAPIER.RigidBodyDesc.dynamic())
    const currentWorld = new RAPIER.World({ x: 0, y: 0, z: 0 })

    expect(bodyNeedsRebuild(currentWorld, oldBody, 1, 2)).toBe(true)
    oldWorld.free()
    currentWorld.free()
  })

  it('syncs each settled body without waiting for unrelated moving bodies', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
    const settled = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic())
    const moving = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic())
    settled.sleep()
    moving.setLinvel({ x: 1, y: 0, z: 0 }, true)

    expect(bodyCanSyncSettledTransform(world, settled, 1, 1, false)).toBe(true)
    expect(bodyCanSyncSettledTransform(world, moving, 1, 1, false)).toBe(false)
    expect(bodyCanSyncSettledTransform(world, settled, 1, 1, true)).toBe(false)
    world.free()
  })

  it.each<[CasePreset, boolean]>([
    ['modern3', false],
    ['wood3', false],
    ['glass3', true]
  ])('matches the visible side wall of %s in the collision scene', (preset, expectedCollision) => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
    const displayItem = displayCaseItem(preset)
    displayItem.physics.placementLocked = true
    addPedestal(world, displayItem)

    const probeItem = pedestalItem({ locked: true })
    probeItem.transform.position = { x: 2.64, y: 1, z: 0 }
    const probe = world.createRigidBody(createItemRigidBodyDescriptor(
      probeItem,
      { x: 0, y: 0, z: 0, w: 1 }
    ))
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.15, 0.15, 0.15).setCollisionGroups(itemCollisionGroups(probeItem)),
      probe
    )
    world.step()

    expect(bodyOverlapsCollisionScene(world, probe, undefined, true)).toBe(expectedCollision)
    world.free()
  })

  it('drops an unlocked built-in object onto the floor', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    addFloor(world)
    const body = addPedestal(world, pedestalItem({ y: 3 }))

    expect(body.bodyType()).toBe(RAPIER.RigidBodyType.Dynamic)
    settle(world)
    expect(body.translation().y).toBeCloseTo(0, 1)
    world.free()
  })

  it('only keeps a built-in object suspended when placement lock is enabled', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    addFloor(world)
    const body = addPedestal(world, pedestalItem({ y: 3, locked: true }))

    expect(body.bodyType()).toBe(RAPIER.RigidBodyType.Fixed)
    settle(world)
    expect(body.translation().y).toBe(3)
    world.free()
  })

  it('lets one structural object settle on another structural object', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    addFloor(world)
    addPedestal(world, pedestalItem({ locked: true }))
    const top = addPedestal(world, pedestalItem({ y: 2 }))

    settle(world)
    expect(top.translation().y).toBeGreaterThan(0.55)
    expect(top.translation().y).toBeLessThan(0.75)
    world.free()
  })

  it.each<AcrylicCaseVariant>(['low', 'standard'])(
    'lets the %s acrylic case bridge the open top frame of a freeform display case',
    (variant) => {
      const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
      addFloor(world)
      const displayItem = displayCaseItem()
      const display = createBuiltInObject(displayItem)
      const displayBody = addPedestal(world, displayItem)
      const acrylic = addPedestal(world, acrylicCaseItem(variant, display.bounds.max.y + 0.5))

      settle(world, 480)

      expect(acrylic.translation().y - displayBody.translation().y).toBeCloseTo(display.bounds.max.y, 1)
      world.free()
    }
  )

  it('keeps an environment collider even when item-to-item collision is disabled', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    addFloor(world)
    const item = pedestalItem({ y: 2, collision: false })
    const body = addPedestal(world, item)

    expect(body.numColliders()).toBeGreaterThan(0)
    expect(body.collider(0).collisionGroups()).toBe(itemCollisionGroups(item))
    settle(world)
    expect(body.translation().y).toBeCloseTo(0, 1)
    world.free()
  })

  it('lets the U-supported acrylic steps recover from a small physical tilt', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    addFloor(world)
    const item = acrylicStepsItem(0.15)
    const built = createBuiltInObject(item)
    const tilt = 0.04
    const body = world.createRigidBody(createItemRigidBodyDescriptor(item, {
      x: Math.sin(tilt / 2),
      y: 0,
      z: 0,
      w: Math.cos(tilt / 2)
    }))
    addBuiltInItemColliders(world, body, item, built.colliders, item.transform.scale)

    settle(world, 480)

    expect(body.translation().y).toBeCloseTo(0, 1)
    expect(Math.abs(body.rotation().x)).toBeLessThan(0.015)
    expect(Math.abs(body.rotation().z)).toBeLessThan(0.015)
    world.free()
  })

  it('does not accept an item-to-item overlap as a safe drag pose', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
    const item = pedestalItem()
    const dragged = addKinematicBox(world, item, 0)
    addKinematicBox(world, pedestalItem(), 0.1)
    world.step()

    expect(bodyOverlapsCollisionScene(world, dragged)).toBe(true)
    world.free()
  })

  it('can validate a freshly rebuilt collider before the next physics step', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
    const dragged = addKinematicBox(world, pedestalItem(), 0)
    addKinematicBox(world, pedestalItem(), 0.1)

    expect(bodyOverlapsCollisionScene(world, dragged, { x: 0, y: 0, z: 0 }, true)).toBe(true)
    world.free()
  })

  it('resolves restored penetrations from later contents before moving their earlier support', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    addFloor(world)
    const supportItem = pedestalItem()
    const contentItem = pedestalItem()
    const support = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.5, 0))
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(1, 0.5, 1).setCollisionGroups(itemCollisionGroups(supportItem)),
      support
    )
    const content = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.8, 0))
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.25, 0.25, 0.25).setCollisionGroups(itemCollisionGroups(contentItem)),
      content
    )

    const resolution = resolveRestoredBodyOverlaps(world, [
      { body: support, preservePosition: false },
      { body: content, preservePosition: false }
    ])

    expect(resolution.unresolved.size).toBe(0)
    expect(resolution.moved.has(content.handle)).toBe(true)
    expect(resolution.moved.has(support.handle)).toBe(false)
    expect(support.translation()).toMatchObject({ x: 0, y: 0.5, z: 0 })
    expect(bodyOverlapsCollisionScene(world, content, { x: 0, y: 0, z: 0 }, true)).toBe(false)

    settle(world)
    expect(Math.abs(support.translation().x)).toBeLessThan(0.02)
    expect(Math.abs(support.translation().z)).toBeLessThan(0.02)
    expect(Math.abs(content.translation().x)).toBeLessThan(0.02)
    expect(Math.abs(content.translation().z)).toBeLessThan(0.02)
    expect(support.translation().y).toBeCloseTo(0.5, 1)
    expect(content.translation().y).toBeCloseTo(1.25, 1)
    world.free()
  })

  it('still treats ordinary floor contact as a valid drag pose', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    addFloor(world)
    const body = addPedestal(world, pedestalItem({ y: 2 }))
    settle(world)

    expect(bodyOverlapsCollisionScene(world, body)).toBe(false)
    world.free()
  })

  it('does not mistake a resolved push contact for interpenetration', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
    world.timestep = 1 / 60
    const dragged = addKinematicBox(world, pedestalItem(), 0)
    const pushedItem = pedestalItem()
    const pushed = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(1, 0.5, 0))
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setCollisionGroups(itemCollisionGroups(pushedItem)),
      pushed
    )

    dragged.setNextKinematicTranslation({ x: 0.1, y: 0.5, z: 0 })
    world.step()

    expect(pushed.translation().x).toBeGreaterThan(1)
    expect(bodyOverlapsCollisionScene(world, dragged)).toBe(false)
    world.free()
  })

  it('detects deep penetration when the pushed item is trapped against a wall', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
    world.timestep = 1 / 60
    const dragged = addKinematicBox(world, pedestalItem(), 0)
    const pushedItem = pedestalItem()
    const pushed = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(1, 0.5, 0))
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setCollisionGroups(itemCollisionGroups(pushedItem)),
      pushed
    )
    const wall = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(2, 0.5, 0))
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setCollisionGroups(environmentCollisionGroups()),
      wall
    )

    dragged.setNextKinematicTranslation({ x: 0.1, y: 0.5, z: 0 })
    world.step()

    expect(bodyOverlapsCollisionScene(world, dragged)).toBe(true)
    const clearPosition = findNearestClearBodyPosition(world, dragged)
    expect(clearPosition).not.toBeNull()
    if (!clearPosition) throw new Error('Expected a nearby clear drop position')
    expect(Math.hypot(
      clearPosition.x - dragged.translation().x,
      clearPosition.y - dragged.translation().y,
      clearPosition.z - dragged.translation().z
    )).toBeLessThan(0.25)
    world.free()
  })

  it('keeps active drag collision inspection non-blocking so the item can escape again', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
    world.timestep = 1 / 60
    const dragged = addKinematicBox(world, pedestalItem(), 0)
    const pushedItem = pedestalItem()
    const pushed = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(1, 0.5, 0))
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setCollisionGroups(itemCollisionGroups(pushedItem)),
      pushed
    )
    const wall = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(2, 0.5, 0))
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setCollisionGroups(environmentCollisionGroups()),
      wall
    )

    dragged.setNextKinematicTranslation({ x: 0.1, y: 0.5, z: 0 })
    world.step()
    expect(bodyOverlapsCollisionScene(world, dragged)).toBe(true)
    expect(dragged.translation().x).toBeCloseTo(0.1)

    dragged.setNextKinematicTranslation({ x: -0.1, y: 0.5, z: 0 })
    world.step()
    expect(dragged.translation().x).toBeCloseTo(-0.1)
    expect(bodyOverlapsCollisionScene(world, dragged)).toBe(false)
    world.free()
  })

  it('respects an exhibit whose item-to-item collision is disabled', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
    const dragged = addKinematicBox(world, pedestalItem({ collision: false }), 0)
    addKinematicBox(world, pedestalItem(), 0.1)
    world.step()

    expect(bodyOverlapsCollisionScene(world, dragged)).toBe(false)
    world.free()
  })

  it('finds a clear escape position when a drag starts inside another item', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
    const dragged = addKinematicBox(world, pedestalItem(), 0)
    addKinematicBox(world, pedestalItem(), 0.1)
    world.step()

    const clearPosition = findNearestClearBodyPosition(world, dragged)
    expect(clearPosition).not.toBeNull()
    if (!clearPosition) throw new Error('Expected a clear recovery position')
    const origin = dragged.translation()
    expect(bodyOverlapsCollisionScene(world, dragged, {
      x: clearPosition.x - origin.x,
      y: clearPosition.y - origin.y,
      z: clearPosition.z - origin.z
    })).toBe(false)
    world.free()
  })

  it('checks every collider on a compound display object', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
    const item = pedestalItem()
    const dragged = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0.5, 0))
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.25, 0.25, 0.25)
        .setTranslation(-2, 0, 0)
        .setCollisionGroups(itemCollisionGroups(item)),
      dragged
    )
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5)
        .setTranslation(1, 0, 0)
        .setCollisionGroups(itemCollisionGroups(item)),
      dragged
    )
    addKinematicBox(world, pedestalItem(), 1.1)
    world.step()

    expect(bodyOverlapsCollisionScene(world, dragged)).toBe(true)
    world.free()
  })
})
