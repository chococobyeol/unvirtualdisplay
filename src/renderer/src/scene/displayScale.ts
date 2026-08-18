import type { Vec3 } from '../../../shared/types'

export interface ScalableColliderBox {
  halfExtents: [number, number, number]
  position: [number, number, number]
}

const MINIMUM_SCALE_MAGNITUDE = 0.001

function safeScaleAxis(value: number): number {
  if (!Number.isFinite(value)) return 1
  if (Math.abs(value) >= MINIMUM_SCALE_MAGNITUDE) return value
  return value < 0 ? -MINIMUM_SCALE_MAGNITUDE : MINIMUM_SCALE_MAGNITUDE
}

export function inverseDisplayScale(scale: Vec3): Vec3 {
  return {
    x: 1 / safeScaleAxis(scale.x),
    y: 1 / safeScaleAxis(scale.y),
    z: 1 / safeScaleAxis(scale.z)
  }
}

export function scaleCaseCollider(collider: ScalableColliderBox, scale: Vec3): ScalableColliderBox {
  return {
    halfExtents: [
      Math.max(MINIMUM_SCALE_MAGNITUDE, collider.halfExtents[0] * Math.abs(scale.x)),
      Math.max(MINIMUM_SCALE_MAGNITUDE, collider.halfExtents[1] * Math.abs(scale.y)),
      Math.max(MINIMUM_SCALE_MAGNITUDE, collider.halfExtents[2] * Math.abs(scale.z))
    ],
    position: [
      collider.position[0] * scale.x,
      collider.position[1] * scale.y,
      collider.position[2] * scale.z
    ]
  }
}
