import * as THREE from 'three'

export const CLEAR_ACRYLIC_TRANSMISSION = 0.92
export const CLEAR_ACRYLIC_IOR = 1.49

export type AcrylicRenderMode = 'physical' | 'alphaBlend'

interface AcrylicMaterialOptions {
  mode?: AcrylicRenderMode
  color?: THREE.ColorRepresentation
  roughness?: number
  thickness?: number
  alphaOpacity?: number
  map?: THREE.Texture | null
  alphaTest?: number
  side?: THREE.Side
}

export function createClearAcrylicMaterial({
  // Alpha blending is the safe default because Three's screen-space
  // transmission buffer omits transparent and other transmissive surfaces.
  // Physical transmission therefore makes nested acrylic disappear.
  mode = 'alphaBlend',
  color = 0xe8f3f2,
  roughness = 0.06,
  thickness = 0.04,
  alphaOpacity = 0.09,
  map = null,
  alphaTest = 0,
  side = THREE.FrontSide
}: AcrylicMaterialOptions = {}): THREE.MeshPhysicalMaterial {
  const physical = mode === 'physical'
  const material = new THREE.MeshPhysicalMaterial({
    color,
    map,
    transparent: !physical,
    opacity: physical ? 1 : alphaOpacity,
    roughness,
    metalness: 0,
    transmission: physical ? CLEAR_ACRYLIC_TRANSMISSION : 0,
    ior: CLEAR_ACRYLIC_IOR,
    thickness: physical ? thickness : 0,
    alphaTest,
    depthWrite: physical,
    side
  })
  if (!physical) material.forceSinglePass = true
  return material
}
