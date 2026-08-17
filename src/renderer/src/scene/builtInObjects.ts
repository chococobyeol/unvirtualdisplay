import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { AcrylicCaseVariant, CasePreset, DisplayItem } from '../../../shared/types'
import { CASE_PRESET_META } from '../../../shared/types'
import { createClearAcrylicMaterial, type AcrylicRenderMode } from './acrylicMaterial'
import { getCaseLayout } from './caseLayout'

export interface ColliderBox {
  halfExtents: [number, number, number]
  position: [number, number, number]
}

export interface BuiltObject {
  root: THREE.Group
  bounds: THREE.Box3
  colliders: ColliderBox[]
}

export interface BuiltObjectOptions {
  acrylicRenderMode?: AcrylicRenderMode
}

type BoxSize = [number, number, number]
type BoxPosition = [number, number, number]

function addBox(
  root: THREE.Group,
  size: BoxSize,
  position: BoxPosition,
  material: THREE.Material,
  castShadow = true,
  renderOrder = 0
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material)
  mesh.position.set(...position)
  mesh.castShadow = castShadow
  mesh.receiveShadow = castShadow
  mesh.renderOrder = renderOrder
  root.add(mesh)
  return mesh
}

function addRoundedBox(
  root: THREE.Group,
  size: BoxSize,
  position: BoxPosition,
  material: THREE.Material,
  radius: number,
  castShadow = true,
  renderOrder = 0
): THREE.Mesh {
  const safeRadius = Math.min(radius, Math.min(...size) * 0.48)
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(size[0], size[1], size[2], 3, safeRadius), material)
  mesh.position.set(...position)
  mesh.castShadow = castShadow
  mesh.receiveShadow = castShadow
  mesh.renderOrder = renderOrder
  root.add(mesh)
  return mesh
}

function collider(size: BoxSize, position: BoxPosition): ColliderBox {
  return {
    halfExtents: [size[0] / 2, size[1] / 2, size[2] / 2],
    position
  }
}

function finish(root: THREE.Group, colliders: ColliderBox[], normalizeToFloor = true): BuiltObject {
  root.updateMatrixWorld(true)
  const initialBounds = new THREE.Box3().setFromObject(root)
  if (normalizeToFloor && !initialBounds.isEmpty() && Math.abs(initialBounds.min.y) > 1e-6) {
    const groundOffset = -initialBounds.min.y
    for (const child of root.children) child.position.y += groundOffset
    for (const part of colliders) part.position[1] += groundOffset
    root.updateMatrixWorld(true)
  }
  return { root, bounds: new THREE.Box3().setFromObject(root), colliders }
}

export function createDisplayCaseObject(preset: CasePreset, normalizeToFloor = false): BuiltObject {
  const root = new THREE.Group()
  if (preset === 'custom') return finish(root, [], normalizeToFloor)

  const layout = getCaseLayout(preset)
  const style = CASE_PRESET_META[preset].style
  const palette = style === 'wood'
    ? { base: 0x6b4932, back: 0x493326, frame: 0x2f231c, shelf: 0x8a6244 }
    : style === 'glass'
      ? { base: 0x272a2c, back: 0x9eaaa8, frame: 0x27292b, shelf: 0x494f51 }
      : { base: 0xd7d0c3, back: 0xc6c0b4, frame: 0x45413d, shelf: 0xb4aea3 }

  const baseMaterial = new THREE.MeshStandardMaterial({ color: palette.base, roughness: style === 'wood' ? 0.72 : 0.48, metalness: 0.03 })
  const backMaterial = new THREE.MeshStandardMaterial({ color: palette.back, roughness: 0.78 })
  const shelfMaterial = new THREE.MeshStandardMaterial({ color: palette.shelf, roughness: style === 'wood' ? 0.65 : 0.42, metalness: style === 'glass' ? 0.25 : 0.02 })
  const frameMaterial = new THREE.MeshStandardMaterial({ color: palette.frame, roughness: 0.42, metalness: 0.35 })
  const colliders: ColliderBox[] = []

  const baseSize: BoxSize = [5.4, 0.18, 2.7]
  const basePosition: BoxPosition = [0, -0.09, 0]
  addBox(root, baseSize, basePosition, baseMaterial)
  colliders.push(collider(baseSize, basePosition))

  const backSize: BoxSize = [5.25, layout.backHeight, 0.12]
  const backPosition: BoxPosition = [0, layout.backCenterY, -1.29]
  addBox(root, backSize, backPosition, backMaterial, false)
  colliders.push(collider([5.28, layout.backHeight, 0.12], backPosition))

  const shelfSize: BoxSize = [4.95, 0.1, 2.4]
  const shelfColliderSize: BoxSize = [5.16, 0.1, 2.44]
  for (const shelfHeight of layout.shelfHeights) {
    const shelfPosition: BoxPosition = [0, shelfHeight, 0]
    addBox(root, shelfSize, shelfPosition, shelfMaterial)
    colliders.push(collider(shelfColliderSize, shelfPosition))
  }

  if (style === 'glass') {
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xdceeed,
      transparent: true,
      opacity: 0.13,
      roughness: 0.08,
      metalness: 0,
      transmission: 0.25,
      depthWrite: false,
      side: THREE.DoubleSide
    })
    glass.forceSinglePass = true
    const left = new THREE.Mesh(new THREE.PlaneGeometry(2.7, layout.backHeight), glass)
    left.rotation.y = Math.PI / 2
    left.position.set(-2.64, layout.backCenterY, 0)
    left.renderOrder = 4
    const right = left.clone()
    right.position.x = 2.64
    root.add(left, right)
  }

  const postSize: BoxSize = [0.1, layout.frameHeight, 0.1]
  for (const x of [-2.64, 2.64]) {
    for (const z of [-1.25, 1.25]) {
      const postPosition: BoxPosition = [x, layout.frameCenterY, z]
      addBox(root, postSize, postPosition, frameMaterial)
      if (style !== 'glass') colliders.push(collider(postSize, postPosition))
    }
  }
  const topRailSize: BoxSize = [5.38, 0.1, 0.1]
  for (const z of [-1.25, 1.25]) {
    const topRailPosition: BoxPosition = [0, layout.topHeight, z]
    addBox(root, topRailSize, topRailPosition, frameMaterial)
    colliders.push(collider(topRailSize, topRailPosition))
  }

  // Only the glass preset has visible side walls. Modern and wood presets are
  // open between their corner posts, so a full-depth side collider there
  // would behave like an invisible pane of glass.
  if (style === 'glass') {
    colliders.push(
      collider([0.1, layout.backHeight, 2.6], [-2.66, layout.backCenterY, 0]),
      collider([0.1, layout.backHeight, 2.6], [2.66, layout.backCenterY, 0])
    )
  }
  return finish(root, colliders, normalizeToFloor)
}

function createAcrylicCase(variant: AcrylicCaseVariant, renderMode: AcrylicRenderMode): BuiltObject {
  const root = new THREE.Group()
  const colliders: ColliderBox[] = []
  const profile = variant === 'low'
    ? { width: 3.5, depth: 2.7, wallHeight: 1.8 }
    : variant === 'tall'
      ? { width: 2.2, depth: 2.15, wallHeight: 3.55 }
      : { width: 3.1, depth: 2.65, wallHeight: 2.8 }
  const clear = createClearAcrylicMaterial({
    mode: renderMode,
    color: 0xffffff,
    roughness: 0.04,
    thickness: 0.055,
    alphaOpacity: 0.08
  })
  const base = new THREE.MeshStandardMaterial({ color: 0x302e2b, roughness: 0.38, metalness: 0.08 })
  const baseSize: BoxSize = [profile.width, 0.12, profile.depth]
  const basePosition: BoxPosition = [0, 0.06, 0]
  addRoundedBox(root, baseSize, basePosition, base, 0.035)
  colliders.push(collider(baseSize, basePosition))

  const wallHeight = profile.wallHeight
  const panelThickness = 0.05
  const wallCenter = 0.12 + wallHeight / 2
  const wallX = profile.width / 2 - panelThickness / 2
  const wallZ = profile.depth / 2 - panelThickness / 2
  const wallDepth = profile.depth - panelThickness * 2
  const parts: [BoxSize, BoxPosition][] = [
    [[profile.width, wallHeight, panelThickness], [0, wallCenter, -wallZ]],
    [[profile.width, wallHeight, panelThickness], [0, wallCenter, wallZ]],
    [[panelThickness, wallHeight, wallDepth], [-wallX, wallCenter, 0]],
    [[panelThickness, wallHeight, wallDepth], [wallX, wallCenter, 0]],
    [[profile.width, panelThickness, profile.depth], [0, 0.12 + wallHeight + panelThickness / 2, 0]]
  ]
  for (const [index, [size, position]] of parts.entries()) {
    addRoundedBox(root, size, position, clear, index === 4 ? 0.018 : 0.012, false, 6)
    // Keep the transparent front visually closed while leaving it open to the
    // editor, so exhibits can be moved into the case without disabling physics.
    if (index !== 1) colliders.push(collider(size, position))
  }
  return finish(root, colliders)
}

function createAcrylicSteps(stepCount: number, renderMode: AcrylicRenderMode): BuiltObject {
  const root = new THREE.Group()
  const colliders: ColliderBox[] = []
  const clear = createClearAcrylicMaterial({
    mode: renderMode,
    color: 0xffffff,
    roughness: 0.05,
    thickness: 0.045,
    alphaOpacity: 0.1
  })
  const steps = Math.min(5, Math.max(2, Math.round(stepCount)))
  const width = 2.8
  const treadDepth = 0.54
  const stepHeight = 0.38
  const panelThickness = 0.055
  const totalDepth = steps * treadDepth
  for (let index = 0; index < steps; index += 1) {
    const y = (index + 1) * stepHeight
    const z = totalDepth / 2 - treadDepth / 2 - index * treadDepth
    const treadSize: BoxSize = [width, panelThickness, treadDepth]
    const treadPosition: BoxPosition = [0, y, z]
    addRoundedBox(root, treadSize, treadPosition, clear, 0.012, true, 5)
    colliders.push(collider(treadSize, treadPosition))

    // Each tier is a real U-shaped acrylic bridge: a top plate carried by two
    // side panels whose floor contacts span the full tread depth. The previous
    // single rear panel formed an unstable cantilever in cross-section.
    const supportHeight = y - panelThickness / 2
    const supportSize: BoxSize = [panelThickness, supportHeight, treadDepth]
    const supportY = supportHeight / 2
    const supportX = width / 2 - panelThickness / 2
    for (const x of [-supportX, supportX]) {
      const supportPosition: BoxPosition = [x, supportY, z]
      addRoundedBox(root, supportSize, supportPosition, clear, 0.012, false, 4)
      colliders.push(collider(supportSize, supportPosition))
    }
  }
  return finish(root, colliders)
}

function createPedestal(): BuiltObject {
  const root = new THREE.Group()
  const material = new THREE.MeshStandardMaterial({ color: 0xc9c2b6, roughness: 0.52, metalness: 0.03 })
  const size: BoxSize = [1.25, 0.62, 1.25]
  const position: BoxPosition = [0, 0.31, 0]
  addBox(root, size, position, material)
  return finish(root, [collider(size, position)])
}

function createShelf(): BuiltObject {
  const root = new THREE.Group()
  const board = new THREE.MeshStandardMaterial({ color: 0xd8d2c7, roughness: 0.46, metalness: 0.02 })
  const bracket = new THREE.MeshStandardMaterial({ color: 0x494540, roughness: 0.42, metalness: 0.3 })
  const size: BoxSize = [2.7, 0.11, 1.2]
  const position: BoxPosition = [0, 0.055, 0]
  const bracketSize: BoxSize = [0.08, 0.32, 0.9]
  const leftBracketPosition: BoxPosition = [-1.12, -0.1, 0]
  const rightBracketPosition: BoxPosition = [1.12, -0.1, 0]
  addBox(root, size, position, board)
  addBox(root, bracketSize, leftBracketPosition, bracket)
  addBox(root, bracketSize, rightBracketPosition, bracket)
  return finish(root, [
    collider(size, position),
    collider(bracketSize, leftBracketPosition),
    collider(bracketSize, rightBracketPosition)
  ])
}

export function createBuiltInObject(item: DisplayItem, options: BuiltObjectOptions = {}): BuiltObject {
  const builtin = item.builtin
  const acrylicRenderMode = options.acrylicRenderMode ?? 'alphaBlend'
  if (!builtin) return createPedestal()
  if (builtin.type === 'displayCase') {
    const preset = builtin.casePreset && builtin.casePreset !== 'custom' ? builtin.casePreset : 'modern3'
    return createDisplayCaseObject(preset, true)
  }
  if (builtin.type === 'acrylicCase') return createAcrylicCase(builtin.acrylicCaseVariant ?? 'standard', acrylicRenderMode)
  if (builtin.type === 'acrylicSteps') return createAcrylicSteps(builtin.steps ?? 3, acrylicRenderMode)
  if (builtin.type === 'shelf') return createShelf()
  return createPedestal()
}
