import RAPIER from '@dimforge/rapier3d-compat'
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { ViewportGizmo } from 'three-viewport-gizmo'
import type {
  CameraSettings,
  CasePreset,
  DisplayItem,
  DisplayProject,
  QualityPreset,
  TransformMode,
  TransformState
} from '../../../shared/types'
import { createDefaultDisplayTransform, DISPLAY_CASE_SELECTION_ID } from '../../../shared/types'
import { cameraSettingsEqual, shouldApplySyncedCamera } from '../../../shared/camera'
import { findOpenFloorPosition, findOpenImportPosition, fitImportedItemScale, isPlacementBelowSafetyFloor } from './itemPlacement'
import { getCaseLayout } from './caseLayout'
import { createBuiltInObject, createDisplayCaseObject, type ColliderBox } from './builtInObjects'
import { createClearAcrylicMaterial } from './acrylicMaterial'
import {
  acrylicOffsetPixelRadius,
  acrylicStandBaseDimensions,
  clampAcrylicOffset,
  DEFAULT_ACRYLIC_OFFSET
} from './acrylicStand'
import {
  alphaMaskToCollisionLayout,
  createAcrylicColliderDesc,
  createAcrylicColliderGeometry,
  type AcrylicColliderGeometry
} from './imageAcrylicCollider'
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
import { isPhysicsSceneHydrated, restoredItemSupportPriority } from './sceneHydration'
import { pickSceneSelection, transformAxisAtPointer } from './sceneSelection'
import { prepareImportedModelForScene } from './importedModel'

interface SceneCallbacks {
  onSelect: (id: string | null) => void
  onTransform: (id: string, transform: TransformState, remember?: boolean) => void
  onCameraPreview: (camera: CameraSettings) => void
  onCamera: (camera: CameraSettings) => void
  onAssetError: (id: string, error: string | null) => void
}

interface RuntimeItem {
  id: string
  root: THREE.Group
  bounds: THREE.Box3
  body: RAPIER.RigidBody | null
  bodyWorldGeneration: number
  mixer: THREE.AnimationMixer | null
  clips: THREE.AnimationClip[]
  vrm: VRM | null
  snapshot: DisplayItem
  loadWarning?: string
  builtinColliders?: readonly ColliderBox[]
  acrylicCollider?: AcrylicColliderGeometry
  colliderShape?: RAPIER.Shape
  colliderScaleKey?: string
}

interface DragTarget {
  id: string
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  scale: THREE.Vector3
  safePosition: THREE.Vector3 | null
  safeQuaternion: THREE.Quaternion | null
  safeScale: THREE.Vector3 | null
}

let rapierInitialization: Promise<void> | null = null
const MAX_CAMERA_DISTANCE = 30
const RESTORED_PHYSICS_STABILIZATION_FRAMES = 90

function initializeRapier(): Promise<void> {
  rapierInitialization ??= RAPIER.init()
  return rapierInitialization
}

function cloneItem(item: DisplayItem): DisplayItem {
  return structuredClone(item)
}

function vector3(value: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(value.x, value.y, value.z)
}

function transformOf(object: THREE.Object3D): TransformState {
  return {
    position: { x: object.position.x, y: object.position.y, z: object.position.z },
    rotation: { x: object.rotation.x, y: object.rotation.y, z: object.rotation.z },
    scale: { x: object.scale.x, y: object.scale.y, z: object.scale.z }
  }
}

function transformsDiffer(a: TransformState, b: TransformState, epsilon = 0.002): boolean {
  const keys: (keyof TransformState)[] = ['position', 'rotation', 'scale']
  return keys.some((key) => Math.abs(a[key].x - b[key].x) > epsilon || Math.abs(a[key].y - b[key].y) > epsilon || Math.abs(a[key].z - b[key].z) > epsilon)
}

function prioritizeViewportGizmoHitTesting(gizmo: ViewportGizmo): void {
  const internals = gizmo as unknown as {
    _camera: THREE.Camera
    _domElement: HTMLDivElement
    _domRect: DOMRect
    _focus: THREE.Object3D | null
    _handleClick: (event: PointerEvent) => void
    _handleHover: (event: PointerEvent) => void
    _intersections: THREE.Object3D[]
    _setOrientation: (position: THREE.Vector3) => void
  }
  const originalHandleClick = internals._handleClick.bind(gizmo)
  const pointer = new THREE.Vector2()
  const raycaster = new THREE.Raycaster()
  const hitMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    colorWrite: false
  })
  const detailTargets: THREE.Mesh[] = []

  for (const x of [-0.94, 0.94]) {
    for (const y of [-0.94, 0.94]) {
      for (const z of [-0.94, 0.94]) {
        const target = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), hitMaterial.clone())
        target.position.set(x, y, z)
        target.userData.detailRank = 3
        target.userData.viewDirection = target.position.clone().normalize()
        detailTargets.push(target)
      }
    }
  }

  const edgePositions: [number, number, number][] = []
  for (const a of [-0.96, 0.96]) {
    for (const b of [-0.96, 0.96]) {
      edgePositions.push([0, a, b], [a, 0, b], [a, b, 0])
    }
  }
  for (const [x, y, z] of edgePositions) {
    const target = new THREE.Mesh(new THREE.BoxGeometry(
      x === 0 ? 1.25 : 0.3,
      y === 0 ? 1.25 : 0.3,
      z === 0 ? 1.25 : 0.3
    ), hitMaterial.clone())
    target.position.set(x, y, z)
    target.userData.detailRank = 2
    target.userData.viewDirection = target.position.clone().normalize()
    detailTargets.push(target)
  }
  hitMaterial.dispose()
  gizmo.add(...detailTargets)
  gizmo.updateMatrixWorld(true)
  const detailWorldPosition = new THREE.Vector3()
  const helperViewDirection = internals._camera.position.clone().normalize()
  const detailRank = (object: THREE.Object3D): number => object.userData.detailRank ?? [object.position.x, object.position.y, object.position.z]
    .filter((value) => Math.abs(value) > 0.2).length

  for (const target of detailTargets) {
    const targetDirection = target.position.clone().normalize()
    target.userData.visualTarget = internals._intersections.find((candidate) => (
      detailRank(candidate) === detailRank(target)
      && candidate.position.clone().normalize().dot(targetDirection) > 0.995
    ))
  }

  const setHovered = (object: THREE.Object3D, hovered: boolean): void => {
    const state = (hovered ? object.userData.hover : object.userData) as {
      color?: THREE.ColorRepresentation
      opacity?: number
      scale?: number
    }
    const material = (object as THREE.Mesh).material as THREE.MeshBasicMaterial | THREE.SpriteMaterial | undefined
    if (typeof state.scale === 'number') object.scale.setScalar(state.scale)
    if (!material) return
    if (typeof state.opacity === 'number') material.opacity = state.opacity
    if (material.map) {
      const offsetX = material.map.userData.offsetX as number | undefined
      if (typeof offsetX === 'number') material.map.offset.x = (hovered ? 0.5 : 0) + offsetX
    } else if (state.color !== undefined) {
      material.color.set(state.color)
    }
  }

  const pickTarget = (event: PointerEvent): THREE.Object3D | null => {
    const rect = internals._domRect
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    )
    raycaster.setFromCamera(pointer, internals._camera)
    const intersections = raycaster.intersectObjects([...detailTargets, ...internals._intersections], false)
      .filter((intersection) => {
        const object = intersection.object
        if (!object.visible) return false
        if (detailRank(object) <= 1) return true
        object.getWorldPosition(detailWorldPosition)
        return detailWorldPosition.dot(helperViewDirection) >= -0.02
      })
    intersections.sort((a, b) => detailRank(b.object) - detailRank(a.object) || a.distance - b.distance)
    return intersections[0]?.object ?? null
  }

  internals._handleClick = (event): void => {
    const selected = pickTarget(event)
    if (!selected) {
      originalHandleClick(event)
      return
    }

    if (internals._focus) setHovered(internals._focus, false)
    internals._focus = null
    const direction = (selected.userData.viewDirection as THREE.Vector3 | undefined) ?? selected.position.clone().normalize()
    internals._setOrientation(direction)
    gizmo.dispatchEvent({ type: 'change' })
  }

  internals._handleHover = (event): void => {
    const selected = pickTarget(event)
    const visualTarget = (selected?.userData.visualTarget as THREE.Object3D | undefined)
      ?? (selected?.userData.hover ? selected : null)
    if (internals._focus === visualTarget) return
    internals._domElement.style.cursor = visualTarget ? 'pointer' : ''
    if (internals._focus) setHovered(internals._focus, false)
    internals._focus = visualTarget
    if (visualTarget) setHovered(visualTarget, true)
  }
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    mesh.geometry?.dispose()
    const materials = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : []
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose()
      }
      material.dispose()
    }
  })
}

function roundedColor(warmth: number): THREE.Color {
  return new THREE.Color().setHSL(0.095, 0.28, 0.92 + warmth * 0.025)
}

interface AcrylicCutout {
  texture: THREE.CanvasTexture
  colliderRects: ReturnType<typeof alphaMaskToCollisionLayout>['rectangles']
}

function createAcrylicCutoutTexture(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  panelWidth: number,
  panelHeight: number,
  offset: number
): AcrylicCutout {
  const scale = Math.min(1, 256 / Math.max(sourceWidth, sourceHeight))
  const sampleWidth = Math.max(1, Math.round(sourceWidth * scale))
  const sampleHeight = Math.max(1, Math.round(sourceHeight * scale))
  const density = Math.min(sampleWidth / panelWidth, sampleHeight / panelHeight)
  const radius = acrylicOffsetPixelRadius(offset, density)
  const width = sampleWidth + radius * 2
  const height = sampleHeight + radius * 2

  const sample = document.createElement('canvas')
  sample.width = sampleWidth
  sample.height = sampleHeight
  const sampleContext = sample.getContext('2d', { willReadFrequently: true })
  if (!sampleContext) throw new Error('Canvas 2D context is unavailable')
  sampleContext.drawImage(source, 0, 0, sampleWidth, sampleHeight)
  const sourcePixels = sampleContext.getImageData(0, 0, sampleWidth, sampleHeight).data

  const alpha = new Uint8ClampedArray(width * height)
  for (let y = 0; y < sampleHeight; y += 1) {
    for (let x = 0; x < sampleWidth; x += 1) {
      alpha[(y + radius) * width + x + radius] = sourcePixels[(y * sampleWidth + x) * 4 + 3]
    }
  }

  const horizontal = new Uint8ClampedArray(alpha.length)
  const dilated = new Uint8ClampedArray(alpha.length)
  for (let y = 0; y < height; y += 1) {
    const row = y * width
    for (let x = 0; x < width; x += 1) {
      let maximum = 0
      for (let dx = -radius; dx <= radius; dx += 1) {
        const sampleX = x + dx
        if (sampleX >= 0 && sampleX < width) maximum = Math.max(maximum, alpha[row + sampleX])
      }
      horizontal[row + x] = maximum
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let maximum = 0
      for (let dy = -radius; dy <= radius; dy += 1) {
        const sampleY = y + dy
        if (sampleY >= 0 && sampleY < height) maximum = Math.max(maximum, horizontal[sampleY * width + x])
      }
      dilated[y * width + x] = maximum
    }
  }

  const output = document.createElement('canvas')
  output.width = width
  output.height = height
  const outputContext = output.getContext('2d')
  if (!outputContext) throw new Error('Canvas 2D context is unavailable')
  const outputImage = outputContext.createImageData(width, height)
  for (let index = 0; index < dilated.length; index += 1) {
    const pixel = index * 4
    outputImage.data[pixel] = 224
    outputImage.data[pixel + 1] = 243
    outputImage.data[pixel + 2] = 246
    outputImage.data[pixel + 3] = dilated[index]
  }
  outputContext.putImageData(outputImage, 0, 0)
  const texture = new THREE.CanvasTexture(output)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  return {
    texture,
    colliderRects: alphaMaskToCollisionLayout(dilated, width, height).rectangles
  }
}

export class SceneRuntime {
  private readonly canvas: HTMLCanvasElement
  private readonly variant: 'editor' | 'display'
  private readonly callbacks: SceneCallbacks
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(36, 1, 0.02, 100)
  private readonly renderer: THREE.WebGLRenderer
  private readonly controls: OrbitControls
  private readonly viewportGizmo: ViewportGizmo | null
  private readonly transformControls: TransformControls | null
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2()
  private readonly timer = new THREE.Timer()
  private readonly displayRoot = new THREE.Group()
  private readonly itemLayer = new THREE.Group()
  private readonly caseLayer = new THREE.Group()
  private readonly selectionHelper = new THREE.BoxHelper(new THREE.Object3D(), 0xe7b872)
  private readonly items = new Map<string, RuntimeItem>()
  private readonly pendingItemLoads = new Map<string, symbol>()
  private readonly staticBodies: RAPIER.RigidBody[] = []
  private readonly dracoLoader = new DRACOLoader()
  private readonly ktx2Loader = new KTX2Loader()
  private world: RAPIER.World | null = null
  private worldGeneration = 0
  private project: DisplayProject | null = null
  private animationFrame = 0
  private resizeObserver: ResizeObserver
  private selectedId: string | null = null
  private transformMode: TransformMode = 'translate'
  private draggingTransform = false
  private activeTransformId: string | null = null
  private dragTarget: DragTarget | null = null
  private casePreset: CasePreset | null = null
  private projectId: string | null = null
  private restoringPhysicsProjectId: string | null = null
  private physicsStabilizationFrames = 0
  private quality: QualityPreset
  private keyLight: THREE.SpotLight
  private fillLight: THREE.HemisphereLight
  private disposed = false
  private applyingCamera = false
  private cameraPreviewFrame = 0
  private cameraInteractionActive = false

  constructor(
    canvas: HTMLCanvasElement,
    variant: 'editor' | 'display',
    quality: QualityPreset,
    callbacks: SceneCallbacks
  ) {
    this.canvas = canvas
    this.variant = variant
    this.quality = quality
    this.callbacks = callbacks
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: quality !== 'low',
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true
    })
    this.timer.connect(document)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.shadowMap.enabled = quality !== 'low'
    this.renderer.shadowMap.type = quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap
    this.renderer.setClearColor(0x000000, variant === 'display' ? 0 : 1)

    if (variant === 'editor') this.scene.background = new THREE.Color(0x181715)
    this.displayRoot.add(this.caseLayer, this.itemLayer)
    this.scene.add(this.displayRoot)
    this.selectionHelper.visible = false
    this.selectionHelper.material.depthTest = false
    this.selectionHelper.material.transparent = true
    this.selectionHelper.material.opacity = 0.78
    this.scene.add(this.selectionHelper)

    this.camera.position.set(4.8, 3.2, 6.8)
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enabled = true
    this.controls.enableDamping = false
    this.controls.minDistance = 2.3
    this.controls.maxDistance = MAX_CAMERA_DISTANCE
    this.controls.maxPolarAngle = Math.PI
    this.controls.mouseButtons.LEFT = variant === 'editor' ? THREE.MOUSE.PAN : null
    this.controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE
    this.controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE
    this.controls.target.set(0, 1.35, 0)
    this.controls.addEventListener('start', this.beginCameraInteraction)
    this.controls.addEventListener('change', this.queueCameraPreview)
    this.controls.addEventListener('end', this.reportCamera)

    const viewportGizmo = variant === 'editor'
      ? new ViewportGizmo(this.camera, this.renderer, {
        container: canvas.parentElement ?? document.body,
        type: 'cube',
        size: 86,
        placement: 'top-right',
        offset: { top: 12, right: 12, bottom: 0, left: 0 },
        animated: true,
        speed: 1.6,
        resolution: 160,
        radius: 0.22,
        className: 'scene-view-gizmo',
        font: { family: 'Inter, system-ui, sans-serif', weight: 600 },
        background: {
          enabled: true,
          color: '#282521',
          opacity: 0.98,
          hover: { color: '#302b25', opacity: 1 }
        },
        corners: {
          enabled: true,
          color: '#514a41',
          opacity: 0.86,
          scale: 0.16,
          radius: 0.3,
          smoothness: 16,
          hover: { color: '#e0aa5c', opacity: 1, scale: 0.2 }
        },
        edges: {
          enabled: true,
          color: '#49433b',
          opacity: 0.82,
          scale: 0.18,
          radius: 0.24,
          smoothness: 14,
          hover: { color: '#e0aa5c', opacity: 1, scale: 0.72 }
        },
        x: { label: 'R', scale: 0.62, color: '#3b3731', labelColor: '#d0c8bc', hover: { scale: 0.64, color: '#66533b', labelColor: '#f1d4a8' } },
        nx: { label: 'L', scale: 0.62, color: '#302d29', labelColor: '#aaa299', hover: { scale: 0.64, color: '#594a38', labelColor: '#ead0aa' } },
        y: { label: 'T', scale: 0.62, color: '#413c35', labelColor: '#ddd4c7', hover: { scale: 0.64, color: '#6b583e', labelColor: '#f5d9ae' } },
        ny: { label: 'B', scale: 0.62, color: '#302d29', labelColor: '#aaa299', hover: { scale: 0.64, color: '#594a38', labelColor: '#ead0aa' } },
        z: { label: 'F', scale: 0.62, color: '#37332e', labelColor: '#cbc3b8', hover: { scale: 0.64, color: '#66533b', labelColor: '#f1d4a8' } },
        nz: { label: 'BK', scale: 0.62, color: '#302d29', labelColor: '#aaa299', hover: { scale: 0.64, color: '#594a38', labelColor: '#ead0aa' } }
      })
      : null
    if (viewportGizmo) {
      prioritizeViewportGizmoHitTesting(viewportGizmo)
      viewportGizmo.attachControls(this.controls)
    }
    this.viewportGizmo = viewportGizmo
    this.viewportGizmo?.addEventListener('start', this.beginCameraInteraction)
    this.viewportGizmo?.addEventListener('change', this.queueCameraPreview)
    this.viewportGizmo?.addEventListener('end', this.reportCamera)

    this.transformControls = variant === 'editor' ? new TransformControls(this.camera, canvas) : null
    if (this.transformControls) {
      this.scene.add(this.transformControls.getHelper())
      this.transformControls.setSize(0.78)
      this.transformControls.addEventListener('dragging-changed', (event) => this.handleTransformDragging(Boolean(event.value)))
      this.transformControls.addEventListener('objectChange', () => this.handleTransformObjectChange())
    }

    this.fillLight = new THREE.HemisphereLight(0xfff4e2, 0x272d38, 1.45)
    this.keyLight = new THREE.SpotLight(0xffe2b8, 60, 18, Math.PI / 4.5, 0.62, 1.4)
    this.keyLight.position.set(2.4, 6, 4.2)
    this.keyLight.target.position.set(0, 1.2, 0)
    this.keyLight.castShadow = true
    this.keyLight.shadow.normalBias = 0.018
    this.keyLight.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024)
    this.scene.add(this.fillLight, this.keyLight, this.keyLight.target)

    this.ktx2Loader.detectSupport(this.renderer)
    // Capture selection before TransformControls. Otherwise the case gizmo's
    // broad invisible picker can swallow clicks on exhibits behind it.
    this.canvas.addEventListener('pointerdown', this.handlePointerDown, true)
    this.canvas.addEventListener('contextmenu', this.handleContextMenu)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas)
  }

  async initialize(): Promise<void> {
    await initializeRapier()
    if (this.disposed) return
    this.world = new RAPIER.World({ x: 0, y: -7.2, z: 0 })
    this.worldGeneration += 1
    this.resize()
    this.animate()
  }

  async syncProject(project: DisplayProject): Promise<void> {
    if (this.disposed) return
    const isNewProject = this.projectId !== project.id
    const previousItemIds = new Set(this.project?.items.map((item) => item.id) ?? [])
    if (isNewProject) {
      this.restoringPhysicsProjectId = project.id
      this.physicsStabilizationFrames = 0
    }
    this.project = structuredClone(project)
    this.projectId = project.id

    const displayTransform = project.displayTransform ?? createDefaultDisplayTransform()
    if (transformsDiffer(transformOf(this.displayRoot), displayTransform)) {
      this.displayRoot.position.copy(vector3(displayTransform.position))
      this.displayRoot.rotation.set(displayTransform.rotation.x, displayTransform.rotation.y, displayTransform.rotation.z)
      this.displayRoot.scale.copy(vector3(displayTransform.scale))
      this.displayRoot.updateMatrixWorld(true)
    }

    const runtimeCamera = {
      position: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      target: { x: this.controls.target.x, y: this.controls.target.y, z: this.controls.target.z },
      fov: this.camera.fov
    }
    if (isNewProject || shouldApplySyncedCamera(runtimeCamera, project.camera, this.cameraInteractionActive)) {
      this.setCamera(project.camera)
    }

    this.updateLighting(project)
    if (this.casePreset !== project.casePreset || (this.world && this.staticBodies.length === 0)) {
      this.buildCase(project.casePreset)
    }
    this.caseLayer.visible = project.caseVisible !== false

    const incomingIds = new Set(project.items.map((item) => item.id))
    for (const id of this.pendingItemLoads.keys()) {
      if (!incomingIds.has(id)) this.pendingItemLoads.delete(id)
    }
    for (const [id, runtime] of this.items) {
      if (!incomingIds.has(id)) this.removeRuntimeItem(runtime)
    }

    for (const item of project.items) {
      const runtime = this.items.get(item.id)
      const requiresReload = runtime && (
        runtime.snapshot.kind !== item.kind ||
        runtime.snapshot.assetUrl !== item.assetUrl ||
        runtime.snapshot.imageDisplayType !== item.imageDisplayType ||
        runtime.snapshot.acrylicShape !== item.acrylicShape ||
        runtime.snapshot.acrylicOffset !== item.acrylicOffset ||
        JSON.stringify(runtime.snapshot.builtin) !== JSON.stringify(item.builtin)
      )
      if (requiresReload) this.removeRuntimeItem(runtime, true)
      const current = this.items.get(item.id)
      if (!current && !this.pendingItemLoads.has(item.id)) {
        const autoPlace = this.variant === 'editor' && !isNewProject && !previousItemIds.has(item.id)
        void this.addItem(item, autoPlace)
      } else {
        if (current) this.syncRuntimeItem(current, item)
      }
    }

    this.setSelection(this.selectedId)
  }

  setSelection(id: string | null): void {
    this.selectedId = id
    // TransformControls mutates its attached object directly. Keep that object
    // fixed for the entire gesture even if a project sync requests another
    // selection before pointerup.
    if (this.draggingTransform) return
    if (id === DISPLAY_CASE_SELECTION_ID) {
      this.selectionHelper.setFromObject(this.displayRoot)
      const caseVisible = this.project?.caseVisible !== false
      this.selectionHelper.visible = this.variant === 'editor' && caseVisible
      if (caseVisible) this.transformControls?.attach(this.displayRoot)
      else this.transformControls?.detach()
      return
    }
    const runtime = id ? this.items.get(id) : null
    if (!runtime || runtime.snapshot.visible === false) {
      this.selectionHelper.visible = false
      this.transformControls?.detach()
      return
    }

    this.selectionHelper.setFromObject(runtime.root)
    this.selectionHelper.visible = this.variant === 'editor'
    if (runtime.snapshot.physics.placementLocked) this.transformControls?.detach()
    else this.transformControls?.attach(runtime.root)
  }

  setTransformMode(mode: TransformMode): void {
    this.transformMode = mode
    this.transformControls?.setMode(mode)
  }

  private attachedTransformId(): string | null {
    const attached = this.transformControls?.object
    if (!attached) return null
    if (attached === this.displayRoot) return DISPLAY_CASE_SELECTION_ID
    for (const runtime of this.items.values()) {
      if (runtime.root === attached) return runtime.id
    }
    return null
  }

  private getCameraSettings(): CameraSettings {
    return {
      position: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      target: { x: this.controls.target.x, y: this.controls.target.y, z: this.controls.target.z },
      fov: this.camera.fov
    }
  }

  private beginCameraInteraction = (): void => {
    this.cameraInteractionActive = true
  }

  private reportCamera = (): void => {
    this.cameraInteractionActive = false
    this.flushCameraPreview()
    const camera = this.getCameraSettings()
    const saved = this.project?.camera
    if (saved && cameraSettingsEqual(saved, camera)) return
    this.callbacks.onCamera(camera)
  }

  private queueCameraPreview = (): void => {
    if (this.applyingCamera || this.disposed || this.cameraPreviewFrame) return
    this.cameraPreviewFrame = requestAnimationFrame(() => {
      this.cameraPreviewFrame = 0
      if (!this.applyingCamera && !this.disposed) this.callbacks.onCameraPreview(this.getCameraSettings())
    })
  }

  private flushCameraPreview(): void {
    if (this.cameraPreviewFrame) cancelAnimationFrame(this.cameraPreviewFrame)
    this.cameraPreviewFrame = 0
    if (!this.applyingCamera && !this.disposed) this.callbacks.onCameraPreview(this.getCameraSettings())
  }

  setCamera(camera: CameraSettings): void {
    this.applyingCamera = true
    try {
      this.camera.position.copy(vector3(camera.position))
      this.camera.fov = camera.fov
      this.camera.updateProjectionMatrix()
      this.controls.target.copy(vector3(camera.target))
      this.controls.update()
    } finally {
      this.applyingCamera = false
    }
  }

  syncCamera(camera: CameraSettings): void {
    if (!shouldApplySyncedCamera(this.getCameraSettings(), camera, this.cameraInteractionActive)) return
    this.setCamera(camera)
  }

  capture(): Promise<Blob | null> {
    this.renderer.render(this.scene, this.camera)
    return new Promise((resolve) => this.canvas.toBlob(resolve, 'image/png'))
  }

  setQuality(quality: QualityPreset): void {
    if (quality === this.quality) return
    this.quality = quality
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : quality === 'balanced' ? 1.5 : 1))
    this.renderer.shadowMap.enabled = quality !== 'low'
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.animationFrame)
    cancelAnimationFrame(this.cameraPreviewFrame)
    this.resizeObserver.disconnect()
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown, true)
    this.canvas.removeEventListener('contextmenu', this.handleContextMenu)
    this.controls.dispose()
    this.viewportGizmo?.dispose()
    this.transformControls?.dispose()
    this.timer.dispose()
    for (const runtime of [...this.items.values()]) this.removeRuntimeItem(runtime)
    this.pendingItemLoads.clear()
    disposeObject(this.caseLayer)
    this.dracoLoader.dispose()
    this.ktx2Loader.dispose()
    this.renderer.dispose()
    this.world?.free()
    this.world = null
  }

  private animate = (timestamp?: number): void => {
    if (this.disposed) return
    this.animationFrame = requestAnimationFrame(this.animate)
    this.timer.update(timestamp)
    const delta = Math.min(this.timer.getDelta(), 1 / 20)
    this.controls.update()

    const physicsSceneHydrated = isPhysicsSceneHydrated(
      this.project?.items.map((item) => item.id) ?? [],
      this.items.keys(),
      this.pendingItemLoads.keys()
    )
    if (this.world && this.variant === 'editor' && physicsSceneHydrated) {
      this.world.timestep = Math.min(delta, 1 / 30)
      for (const runtime of this.items.values()) {
        if (
          runtime.snapshot.visible !== false &&
          bodyNeedsRebuild(this.world, runtime.body, runtime.bodyWorldGeneration, this.worldGeneration)
        ) {
          this.rebuildPhysics(runtime)
        }
      }
      this.prepareRestoredPhysics()
      const stabilizingRestoredScene = this.physicsStabilizationFrames > 0
      this.advanceDraggedBody(this.world.timestep)
      this.world.step()

      for (const runtime of this.items.values()) {
        const body = runtime.body
        if (!body) continue
        const isDraggedBody = this.draggingTransform && this.dragTarget?.id === runtime.id
        if (body.bodyType() === RAPIER.RigidBodyType.Dynamic || isDraggedBody) {
          if (body.bodyType() === RAPIER.RigidBodyType.Dynamic && (this.draggingTransform || stabilizingRestoredScene)) {
            this.limitBodyVelocity(
              body,
              stabilizingRestoredScene ? 0.6 : 2.5,
              stabilizingRestoredScene ? 1 : 4
            )
          }
          const position = body.translation()
          const rotation = body.rotation()
          runtime.root.position.set(position.x, position.y, position.z)
          runtime.root.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w)
          if (isDraggedBody && this.dragTarget) runtime.root.scale.copy(this.dragTarget.scale)
          if (!isDraggedBody && isPlacementBelowSafetyFloor(runtime.bounds, transformOf(runtime.root))) {
            this.moveRuntimeToOpenPosition(runtime)
            continue
          }
          const transform = transformOf(runtime.root)
          if (
            bodyCanSyncSettledTransform(
              this.world,
              body,
              runtime.bodyWorldGeneration,
              this.worldGeneration,
              this.draggingTransform || isDraggedBody || stabilizingRestoredScene
            ) &&
            transformsDiffer(transform, runtime.snapshot.transform)
          ) {
            runtime.snapshot.transform = transform
            this.callbacks.onTransform(runtime.id, transform, false)
          }
        }
        runtime.mixer?.update(runtime.snapshot.animation.enabled ? delta * runtime.snapshot.animation.speed : 0)
        runtime.vrm?.update(delta)
      }
      if (stabilizingRestoredScene) this.physicsStabilizationFrames -= 1
    } else {
      for (const runtime of this.items.values()) {
        runtime.mixer?.update(runtime.snapshot.animation.enabled ? delta * runtime.snapshot.animation.speed : 0)
        runtime.vrm?.update(delta)
      }
    }

    if (this.selectionHelper.visible) this.selectionHelper.update()
    this.renderer.render(this.scene, this.camera)
    this.viewportGizmo?.render()
  }

  private resize(): void {
    const width = Math.max(1, this.canvas.clientWidth)
    const height = Math.max(1, this.canvas.clientHeight)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality === 'high' ? 2 : this.quality === 'balanced' ? 1.5 : 1))
    this.renderer.setSize(width, height, false)
    this.viewportGizmo?.update()
  }

  private updateLighting(project: DisplayProject): void {
    const intensity = project.lighting.intensity
    const azimuth = THREE.MathUtils.degToRad(project.lighting.azimuth ?? 30)
    const elevation = THREE.MathUtils.degToRad(project.lighting.elevation ?? 45)
    const distance = 6.8
    const horizontalDistance = Math.cos(elevation) * distance
    const target = this.keyLight.target.position
    this.keyLight.position.set(
      target.x + Math.sin(azimuth) * horizontalDistance,
      target.y + Math.sin(elevation) * distance,
      target.z + Math.cos(azimuth) * horizontalDistance
    )
    this.fillLight.intensity = 1.1 * intensity
    this.keyLight.intensity = 58 * intensity
    this.keyLight.color.copy(roundedColor(project.lighting.warmth))
    this.keyLight.castShadow = project.lighting.shadows && this.quality !== 'low'
    this.renderer.shadowMap.enabled = project.lighting.shadows && this.quality !== 'low'
  }

  private buildCase(preset: CasePreset): void {
    this.casePreset = preset
    disposeObject(this.caseLayer)
    this.caseLayer.clear()
    if (this.world) {
      for (const body of this.staticBodies.splice(0)) this.removePhysicsBody(body)
    }

    const builtCase = createDisplayCaseObject(preset)
    this.caseLayer.add(builtCase.root)
    const layout = getCaseLayout(preset)

    if (this.variant === 'editor') {
      const caseSize = builtCase.bounds.getSize(new THREE.Vector3())
      const gridSize = preset === 'custom' ? 10 : Math.max(caseSize.x, caseSize.z)
      const gridDivisions = preset === 'custom' ? 40 : Math.max(12, Math.round(gridSize / 0.26))
      const grid = new THREE.GridHelper(gridSize, gridDivisions, 0x6f6558, 0x403b35)
      grid.position.y = (layout.placementSurfaces.at(-1) ?? 0) + 0.008
      const materials = Array.isArray(grid.material) ? grid.material : [grid.material]
      materials.forEach((material) => { material.transparent = true; material.opacity = 0.22 })
      this.caseLayer.add(grid)
    }

    for (const part of builtCase.colliders) this.addStaticCollider(part.halfExtents, part.position)
    // A wide invisible floor sits directly beneath the case base so items that
    // fall over an edge settle below the display instead of falling forever.
    this.addStaticCollider([24, 0.08, 24], [0, layout.placementBounds.floorSurface - 0.08, 0])
    for (const runtime of this.items.values()) runtime.body?.wakeUp()
  }

  private addStaticCollider(halfExtents: [number, number, number], position: [number, number, number]): void {
    if (!this.world) return
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...position))
    const collider = RAPIER.ColliderDesc.cuboid(...halfExtents).setCollisionGroups(environmentCollisionGroups())
    this.world.createCollider(collider, body)
    this.staticBodies.push(body)
  }

  private removePhysicsBody(body: RAPIER.RigidBody, bodyWorldGeneration = this.worldGeneration): void {
    if (!this.world || bodyWorldGeneration !== this.worldGeneration) return
    const currentBody = this.world.bodies.get(body.handle)
    if (currentBody) this.world.removeRigidBody(currentBody)
  }

  private async addItem(item: DisplayItem, autoPlace = false): Promise<void> {
    const loadToken = Symbol(item.id)
    this.pendingItemLoads.set(item.id, loadToken)
    let loaded: RuntimeItem | null = null
    let loadError: string | null = null
    try {
      loaded = item.kind === 'builtin'
        ? this.createBuiltInItem(item)
        : item.kind === 'image'
          ? await this.createImageItem(item)
          : await this.createModelItem(item)
    } catch (error) {
      console.error(`Failed to load ${item.name}`, error)
      loadError = error instanceof Error ? error.message : String(error)
      loaded = this.createErrorItem(item)
    }

    const latest = this.project?.items.find((candidate) => candidate.id === item.id)
    const isCurrentLoad = this.pendingItemLoads.get(item.id) === loadToken
    if (isCurrentLoad) this.pendingItemLoads.delete(item.id)
    if (
      !loaded ||
      this.disposed ||
      !isCurrentLoad ||
      !latest ||
      latest.assetUrl !== item.assetUrl ||
      latest.imageDisplayType !== item.imageDisplayType ||
      latest.acrylicShape !== item.acrylicShape ||
      latest.acrylicOffset !== item.acrylicOffset ||
      JSON.stringify(latest.builtin) !== JSON.stringify(item.builtin) ||
      this.items.has(item.id)
    ) {
      if (loaded) disposeObject(loaded.root)
      if (!this.disposed && latest && !this.items.has(item.id) && !this.pendingItemLoads.has(item.id)) {
        void this.addItem(latest, autoPlace)
      }
      return
    }

    this.callbacks.onAssetError(item.id, loadError ?? loaded.loadWarning ?? null)

    const placedItem = cloneItem(latest)
    if (autoPlace && placedItem.kind !== 'builtin') placedItem.transform.scale = fitImportedItemScale(loaded.bounds, placedItem.transform)
    const requiresRecovery = isPlacementBelowSafetyFloor(loaded.bounds, placedItem.transform)
    if (autoPlace || requiresRecovery) {
      const occupied = [...this.items.values()]
        .filter((runtime) => runtime.snapshot.visible !== false)
        .map((runtime) => {
          runtime.root.updateMatrix()
          return runtime.bounds.clone().applyMatrix4(runtime.root.matrix)
        })
      const casePreset = this.project?.casePreset ?? 'modern3'
      const baseSurface = getCaseLayout(casePreset).placementSurfaces.at(-1) ?? 0
      const position = placedItem.kind === 'builtin'
        ? findOpenFloorPosition(loaded.bounds, placedItem.transform, occupied, baseSurface)
        : findOpenImportPosition(loaded.bounds, placedItem.transform, occupied, casePreset)
      placedItem.transform.position = { x: position.x, y: position.y, z: position.z }
      const localItem = this.project?.items.find((candidate) => candidate.id === item.id)
      if (localItem) localItem.transform = structuredClone(placedItem.transform)
    }

    loaded.root.userData.itemId = item.id
    this.itemLayer.add(loaded.root)
    this.items.set(item.id, loaded)
    this.syncRuntimeItem(loaded, placedItem, true)
    if (autoPlace || requiresRecovery) this.callbacks.onTransform(item.id, placedItem.transform, false)
    if (this.selectedId === item.id) this.setSelection(item.id)
  }

  private async createModelItem(item: DisplayItem): Promise<RuntimeItem> {
    let content: THREE.Object3D
    let clips: THREE.AnimationClip[] = []
    let vrm: VRM | null = null
    const resourceErrors = new Set<string>()
    const manager = new THREE.LoadingManager()
    manager.onError = (url) => {
      resourceErrors.add(url)
      if (this.items.has(item.id) && this.project?.items.some((candidate) => candidate.id === item.id && candidate.assetUrl === item.assetUrl)) {
        this.callbacks.onAssetError(item.id, `Could not load linked resource: ${url}`)
      }
    }

    if (['glb', 'gltf', 'vrm'].includes(item.format)) {
      const loader = new GLTFLoader(manager)
        .setDRACOLoader(this.dracoLoader)
        .setKTX2Loader(this.ktx2Loader)
        .setMeshoptDecoder(MeshoptDecoder)
        .register((parser) => new VRMLoaderPlugin(parser))
      const gltf = await loader.loadAsync(item.assetUrl) as GLTF
      vrm = (gltf.userData.vrm as VRM | undefined) ?? null
      if (vrm) {
        VRMUtils.removeUnnecessaryVertices(vrm.scene)
        VRMUtils.combineSkeletons(vrm.scene)
        VRMUtils.rotateVRM0(vrm)
        content = vrm.scene
      } else {
        content = gltf.scene
      }
      clips = gltf.animations
    } else if (item.format === 'fbx') {
      const fbx = await new FBXLoader(manager).loadAsync(item.assetUrl)
      content = fbx
      clips = fbx.animations
    } else {
      content = await this.loadObjWithMaterials(item.assetUrl, manager)
    }

    prepareImportedModelForScene(content)

    const root = new THREE.Group()
    root.add(content)
    const sourceBounds = new THREE.Box3().setFromObject(content)
    const size = sourceBounds.getSize(new THREE.Vector3())
    const heightScale = 1.25 / Math.max(size.y, 0.001)
    const widthScale = 1.55 / Math.max(size.x, size.z, 0.001)
    const normalizationScale = Math.min(heightScale, widthScale, 100)
    content.scale.multiplyScalar(normalizationScale)
    content.updateMatrixWorld(true)
    const normalized = new THREE.Box3().setFromObject(content)
    const center = normalized.getCenter(new THREE.Vector3())
    content.position.x -= center.x
    content.position.y -= normalized.min.y
    content.position.z -= center.z
    content.updateMatrixWorld(true)

    const bounds = new THREE.Box3().setFromObject(root)
    const mixer = clips.length > 0 ? new THREE.AnimationMixer(content) : null
    return {
      id: item.id,
      root,
      bounds,
      body: null,
      bodyWorldGeneration: 0,
      mixer,
      clips,
      vrm,
      snapshot: cloneItem(item),
      loadWarning: resourceErrors.size > 0
        ? `Could not load linked resource: ${[...resourceErrors][0]}`
        : undefined
    }
  }

  private async loadObjWithMaterials(assetUrl: string, manager: THREE.LoadingManager): Promise<THREE.Group> {
    const response = await fetch(assetUrl)
    if (!response.ok) throw new Error(`OBJ request failed (${response.status})`)
    const source = await response.text()
    const loader = new OBJLoader(manager)
    const materialReference = source.split(/\r?\n/)
      .map((line) => line.trim().match(/^mtllib\s+(.+)$/i)?.[1]?.trim())
      .find((value): value is string => Boolean(value))
    if (materialReference) {
      const materials = await new MTLLoader(manager).loadAsync(new URL(materialReference, assetUrl).toString())
      materials.preload()
      loader.setMaterials(materials)
    }
    return loader.parse(source)
  }

  private createBuiltInItem(item: DisplayItem): RuntimeItem {
    const built = createBuiltInObject(item, {
      // Three's screen-space transmission pass cannot show another
      // transmissive/transparent object behind the first one. Acrylic cases,
      // steps and image stands are intentionally nestable, so use one shared
      // alpha-blended material path in both editor and widget views.
      acrylicRenderMode: 'alphaBlend'
    })
    return {
      id: item.id,
      root: built.root,
      bounds: built.bounds,
      body: null,
      bodyWorldGeneration: 0,
      mixer: null,
      clips: [],
      vrm: null,
      snapshot: cloneItem(item),
      builtinColliders: built.colliders
    }
  }

  private async createImageItem(item: DisplayItem): Promise<RuntimeItem> {
    const texture = await new THREE.TextureLoader().loadAsync(item.assetUrl)
    texture.colorSpace = THREE.SRGBColorSpace
    const width = Math.max(1, texture.image?.naturalWidth ?? texture.image?.width ?? 1)
    const height = Math.max(1, texture.image?.naturalHeight ?? texture.image?.height ?? 1)
    const aspect = width / height
    const maximumWidth = 1.8
    const maximumHeight = 1.18
    const panelWidth = aspect > maximumWidth / maximumHeight ? maximumWidth : maximumHeight * aspect
    const panelHeight = aspect > maximumWidth / maximumHeight ? maximumWidth / aspect : maximumHeight
    const root = new THREE.Group()
    const type = item.imageDisplayType ?? 'acrylic'
    const acrylicOffset = clampAcrylicOffset(item.acrylicOffset ?? DEFAULT_ACRYLIC_OFFSET)
    const acrylicBase = acrylicStandBaseDimensions(panelWidth)
    const frameThickness = 0.075
    const frameOuterBottom = 0.02
    const imageBottom = type === 'acrylic'
      ? acrylicBase.height + acrylicOffset
      : type === 'frame'
        ? frameOuterBottom + frameThickness
        : 0.03
    const imageMaterial = new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      alphaTest: type === 'acrylic' ? 0.035 : 0,
      polygonOffset: type === 'acrylic',
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      roughness: type === 'photocard' ? 0.5 : 0.24,
      metalness: 0,
      side: THREE.DoubleSide
    })
    imageMaterial.forceSinglePass = true
    const image = new THREE.Mesh(new THREE.PlaneGeometry(panelWidth, panelHeight), imageMaterial)
    const imageSurfaceZ = type === 'acrylic' ? 0.04 : type === 'panel' ? 0.042 : 0.024
    image.position.set(0, imageBottom + panelHeight / 2, imageSurfaceZ)
    image.renderOrder = type === 'acrylic' ? 12 : 2
    image.castShadow = true
    root.add(image)

    const acrylicRenderMode = 'alphaBlend'
    const clear = createClearAcrylicMaterial({
      mode: acrylicRenderMode,
      color: 0xffffff,
      roughness: 0.05,
      thickness: 0.04,
      alphaOpacity: 0.09
    })
    const dark = new THREE.MeshStandardMaterial({ color: 0x302c28, roughness: 0.55 })
    const cream = new THREE.MeshStandardMaterial({ color: 0xe2d8c9, roughness: 0.6 })
    let acrylicCollider: AcrylicColliderGeometry | undefined

    if (type === 'acrylic') {
      const offset = acrylicOffset
      const shape = item.acrylicShape ?? 'contour'
      let collisionShape = shape
      let contourRects: AcrylicColliderGeometry['panel']['contourRects'] = []
      let backing: THREE.Mesh
      if (shape === 'rectangle') {
        backing = new THREE.Mesh(new THREE.BoxGeometry(panelWidth + offset * 2, panelHeight + offset * 2, 0.04), clear)
      } else if (shape === 'ellipse') {
        const ellipse = new THREE.Shape()
        ellipse.absellipse(0, 0, panelWidth / 2 + offset, panelHeight / 2 + offset, 0, Math.PI * 2, false, 0)
        const geometry = new THREE.ExtrudeGeometry(ellipse, { depth: 0.04, bevelEnabled: false, curveSegments: 48 })
        geometry.translate(0, 0, -0.02)
        backing = new THREE.Mesh(geometry, clear)
      } else {
        try {
          const cutout = createAcrylicCutoutTexture(texture.image as CanvasImageSource, width, height, panelWidth, panelHeight, offset)
          const cutoutMaterial = createClearAcrylicMaterial({
            mode: acrylicRenderMode,
            map: cutout.texture,
            color: 0xffffff,
            roughness: 0.04,
            thickness: 0.02,
            alphaOpacity: 0.11,
            alphaTest: 0.01,
            side: THREE.DoubleSide
          })
          backing = new THREE.Mesh(new THREE.PlaneGeometry(panelWidth + offset * 2, panelHeight + offset * 2), cutoutMaterial)
          contourRects = cutout.colliderRects
        } catch (error) {
          console.warn(`Could not generate acrylic outline for ${item.name}`, error)
          backing = new THREE.Mesh(new THREE.BoxGeometry(panelWidth + offset * 2, panelHeight + offset * 2, 0.04), clear)
          collisionShape = 'rectangle'
        }
      }
      acrylicCollider = createAcrylicColliderGeometry({
        imageWidth: panelWidth,
        imageHeight: panelHeight,
        offset,
        shape: collisionShape,
        base: acrylicBase,
        contourRects
      })
      backing.position.copy(image.position).setZ(0)
      backing.renderOrder = 10
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(acrylicBase.width / 2, acrylicBase.width / 2, acrylicBase.height, 48),
        clear
      )
      base.scale.z = acrylicBase.depth / acrylicBase.width
      base.position.y = acrylicBase.height / 2
      base.renderOrder = 9
      base.castShadow = true
      root.add(backing, base)
    } else if (type === 'frame') {
      const outerWidth = panelWidth + frameThickness * 2
      const outerTop = imageBottom + panelHeight + frameThickness
      const frameShape = new THREE.Shape()
      frameShape.moveTo(-outerWidth / 2, frameOuterBottom)
      frameShape.lineTo(outerWidth / 2, frameOuterBottom)
      frameShape.lineTo(outerWidth / 2, outerTop)
      frameShape.lineTo(-outerWidth / 2, outerTop)
      frameShape.closePath()
      const opening = new THREE.Path()
      opening.moveTo(-panelWidth / 2, imageBottom)
      opening.lineTo(-panelWidth / 2, imageBottom + panelHeight)
      opening.lineTo(panelWidth / 2, imageBottom + panelHeight)
      opening.lineTo(panelWidth / 2, imageBottom)
      opening.closePath()
      frameShape.holes.push(opening)
      const frameGeometry = new THREE.ExtrudeGeometry(frameShape, { depth: 0.075, bevelEnabled: false })
      frameGeometry.translate(0, 0, -0.0375)
      const frame = new THREE.Mesh(frameGeometry, dark)
      frame.castShadow = true
      root.add(frame)
    } else {
      const backing = new THREE.Mesh(
        new THREE.BoxGeometry(panelWidth + 0.045, panelHeight + 0.045, type === 'photocard' ? 0.025 : 0.065),
        type === 'photocard' ? cream : clear
      )
      backing.position.copy(image.position).setZ(0)
      backing.castShadow = true
      root.add(backing)
    }

    const bounds = new THREE.Box3().setFromObject(root)
    return {
      id: item.id,
      root,
      bounds,
      body: null,
      bodyWorldGeneration: 0,
      mixer: null,
      clips: [],
      vrm: null,
      snapshot: cloneItem(item),
      acrylicCollider
    }
  }

  private createErrorItem(item: DisplayItem): RuntimeItem {
    const root = new THREE.Group()
    const material = new THREE.MeshStandardMaterial({ color: 0x6f3430, roughness: 0.7 })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), material)
    mesh.position.y = 0.35
    root.add(mesh)
    return {
      id: item.id,
      root,
      bounds: new THREE.Box3().setFromObject(root),
      body: null,
      bodyWorldGeneration: 0,
      mixer: null,
      clips: [],
      vrm: null,
      snapshot: cloneItem(item)
    }
  }

  private syncRuntimeItem(runtime: RuntimeItem, item: DisplayItem, force = false): void {
    const transformChanged = transformsDiffer(runtime.snapshot.transform, item.transform)
    const physicsChanged = JSON.stringify(runtime.snapshot.physics) !== JSON.stringify(item.physics)
    const visibilityChanged = (runtime.snapshot.visible !== false) !== (item.visible !== false)
    const missingPhysics = this.variant === 'editor' && item.visible !== false && (
      !this.world ||
      bodyNeedsRebuild(this.world, runtime.body, runtime.bodyWorldGeneration, this.worldGeneration)
    )
    const scaleChanged = transformsDiffer(
      { ...runtime.snapshot.transform, position: item.transform.position, rotation: item.transform.rotation },
      { ...item.transform, position: item.transform.position, rotation: item.transform.rotation }
    )

    if (force || transformChanged) {
      runtime.root.position.copy(vector3(item.transform.position))
      runtime.root.rotation.set(item.transform.rotation.x, item.transform.rotation.y, item.transform.rotation.z)
      runtime.root.scale.copy(vector3(item.transform.scale))
    }
    runtime.root.visible = item.visible !== false
    runtime.root.userData.selectionPassThrough = item.selectionPassThrough === true
    runtime.snapshot = cloneItem(item)
    this.configureAnimation(runtime)

    if (this.variant === 'editor' && (force || transformChanged || physicsChanged || scaleChanged || visibilityChanged || missingPhysics)) {
      this.rebuildPhysics(runtime)
    }
    if (runtime.id === this.selectedId) this.setSelection(runtime.id)
  }

  private configureAnimation(runtime: RuntimeItem): void {
    if (!runtime.mixer || runtime.clips.length === 0) return
    runtime.mixer.stopAllAction()
    runtime.mixer.setTime(0)
    if (runtime.snapshot.visible === false || !runtime.snapshot.animation.enabled) return
    const clip = runtime.clips[Math.min(runtime.snapshot.animation.clipIndex, runtime.clips.length - 1)]
    const action = runtime.mixer.clipAction(clip)
    action.setLoop(runtime.snapshot.animation.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity)
    action.clampWhenFinished = !runtime.snapshot.animation.loop
    action.play()
  }

  private rebuildPhysics(runtime: RuntimeItem): void {
    if (!this.world) return
    if (runtime.body) this.removePhysicsBody(runtime.body, runtime.bodyWorldGeneration)
    runtime.body = null
    runtime.bodyWorldGeneration = 0

    const item = runtime.snapshot
    if (item.visible === false) return
    const quaternion = runtime.root.quaternion
    const freeImage = item.kind === 'image' && !item.physics.preventToppling && !item.physics.placementLocked
    const descriptor = createItemRigidBodyDescriptor(
      item,
      { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w },
      freeImage
    )
    const body = this.world.createRigidBody(descriptor)
    configureItemRigidBody(body, item)

    if (item.kind === 'builtin') {
      addBuiltInItemColliders(this.world, body, item, runtime.builtinColliders ?? [], item.transform.scale)
      runtime.body = body
      runtime.bodyWorldGeneration = this.worldGeneration
      return
    }

    const collider = item.kind === 'image'
      ? this.createImageCollider(runtime, item)
      : this.createDetailedCollider(runtime, item) ?? this.createBoundsCollider(runtime, item)
    collider
      .setFriction(0.72)
      .setRestitution(0)
      .setContactSkin(0.003)
      .setCollisionGroups(itemCollisionGroups(item))
    this.world.createCollider(collider, body)
    runtime.body = body
    runtime.bodyWorldGeneration = this.worldGeneration
  }

  private createImageCollider(runtime: RuntimeItem, item: DisplayItem): RAPIER.ColliderDesc {
    const scale = item.transform.scale
    const scaleKey = `image:${item.imageDisplayType ?? 'acrylic'}:${item.acrylicShape ?? 'contour'}:${item.acrylicOffset ?? DEFAULT_ACRYLIC_OFFSET}:${scale.x.toFixed(4)}:${scale.y.toFixed(4)}:${scale.z.toFixed(4)}`
    if (runtime.colliderShape && runtime.colliderScaleKey === scaleKey) {
      return new RAPIER.ColliderDesc(runtime.colliderShape)
    }

    if (runtime.acrylicCollider) {
      const collider = createAcrylicColliderDesc(runtime.acrylicCollider, scale)
      runtime.colliderShape = collider.shape
      runtime.colliderScaleKey = scaleKey
      return collider
    }

    const panelBounds = new THREE.Box3()
    const baseBounds = new THREE.Box3()
    let hasPanel = false
    let hasBase = false
    runtime.root.updateMatrixWorld(true)
    for (const child of runtime.root.children) {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh || !mesh.geometry) continue
      mesh.geometry.computeBoundingBox()
      const geometryBounds = mesh.geometry.boundingBox
      if (!geometryBounds) continue
      mesh.updateMatrix()
      const localBounds = geometryBounds.clone().applyMatrix4(mesh.matrix)
      if (mesh.geometry.type === 'CylinderGeometry') {
        baseBounds.union(localBounds)
        hasBase = true
      } else {
        panelBounds.union(localBounds)
        hasPanel = true
      }
    }

    const shapes: RAPIER.Shape[] = []
    const positions: RAPIER.Vector[] = []
    const rotations: RAPIER.Rotation[] = []
    const identity = { x: 0, y: 0, z: 0, w: 1 }
    const addCuboid = (bounds: THREE.Box3, minimumDepth: number): void => {
      const size = bounds.getSize(new THREE.Vector3())
      const center = bounds.getCenter(new THREE.Vector3())
      shapes.push(new RAPIER.Cuboid(
        Math.max(0.025, Math.abs(size.x * scale.x) / 2),
        Math.max(0.025, Math.abs(size.y * scale.y) / 2),
        Math.max(minimumDepth, Math.abs(size.z * scale.z) / 2)
      ))
      positions.push({ x: center.x * scale.x, y: center.y * scale.y, z: center.z * scale.z })
      rotations.push(identity)
    }

    if (hasPanel) addCuboid(panelBounds, 0.025)
    if (hasBase) addCuboid(baseBounds, 0.045)
    if (shapes.length === 0) return this.createBoundsCollider(runtime, item)

    const collider = RAPIER.ColliderDesc.compound(shapes, positions, rotations)
    runtime.colliderShape = collider.shape
    runtime.colliderScaleKey = scaleKey
    return collider
  }

  private createDetailedCollider(runtime: RuntimeItem, item: DisplayItem): RAPIER.ColliderDesc | null {
    const scale = item.transform.scale
    const scaleKey = `${scale.x.toFixed(4)}:${scale.y.toFixed(4)}:${scale.z.toFixed(4)}`
    if (runtime.colliderShape && runtime.colliderScaleKey === scaleKey) {
      return new RAPIER.ColliderDesc(runtime.colliderShape)
    }

    runtime.root.updateWorldMatrix(true, true)
    const inverseRoot = runtime.root.matrixWorld.clone().invert()
    const meshes: THREE.Mesh[] = []
    let totalTriangles = 0
    runtime.root.traverse((object) => {
      const mesh = object as THREE.Mesh
      const positions = mesh.geometry?.getAttribute('position')
      if (!mesh.isMesh || !mesh.visible || !positions) return
      const triangleCount = Math.floor((mesh.geometry.index?.count ?? positions.count) / 3)
      if (triangleCount < 1) return
      meshes.push(mesh)
      totalTriangles += triangleCount
    })
    if (meshes.length === 0 || totalTriangles === 0) return null

    const maximumTriangles = 5000
    const vertices: number[] = []
    const indices: number[] = []
    const point = new THREE.Vector3()
    for (const mesh of meshes) {
      const positions = mesh.geometry.getAttribute('position')
      const index = mesh.geometry.index
      const triangleCount = Math.floor((index?.count ?? positions.count) / 3)
      const budget = Math.max(16, Math.floor(maximumTriangles * triangleCount / totalTriangles))
      const stride = Math.max(1, Math.ceil(triangleCount / budget))
      const relativeMatrix = inverseRoot.clone().multiply(mesh.matrixWorld)
      for (let triangle = 0; triangle < triangleCount; triangle += stride) {
        for (let corner = 0; corner < 3; corner += 1) {
          const offset = triangle * 3 + corner
          const vertexIndex = index ? index.getX(offset) : offset
          mesh.getVertexPosition(vertexIndex, point)
          point.applyMatrix4(relativeMatrix)
          point.set(point.x * scale.x, point.y * scale.y, point.z * scale.z)
          vertices.push(point.x, point.y, point.z)
          indices.push(indices.length)
        }
      }
    }
    if (indices.length < 12) return null

    const vertexArray = new Float32Array(vertices)
    const indexArray = new Uint32Array(indices)
    const detailed = RAPIER.ColliderDesc.convexDecomposition(vertexArray, indexArray, {
      concavity: 0.025,
      maxConvexHulls: 16,
      resolution: 64,
      planeDownsampling: 4,
      convexHullDownsampling: 4,
      convexHullApproximation: true
    }) ?? RAPIER.ColliderDesc.convexHull(vertexArray)
    if (!detailed) return null

    // Triangle downsampling can miss a character's lowest vertices. A compact
    // support pad reaches the visual bounds' true bottom, so the model cannot
    // appear buried in a shelf while its sampled collider rests above it.
    const size = runtime.bounds.getSize(new THREE.Vector3())
    const center = runtime.bounds.getCenter(new THREE.Vector3())
    const supportHalfHeight = 0.025
    const scaledBottom = Math.min(runtime.bounds.min.y * scale.y, runtime.bounds.max.y * scale.y)
    const support = new RAPIER.Cuboid(
      Math.max(0.04, Math.min(0.34, Math.abs(size.x * scale.x) * 0.22)),
      supportHalfHeight,
      Math.max(0.04, Math.min(0.28, Math.abs(size.z * scale.z) * 0.22))
    )
    const identity = { x: 0, y: 0, z: 0, w: 1 }
    const detailedShape = detailed.shape
    const shapes = detailedShape instanceof RAPIER.Compound ? [...detailedShape.shapes, support] : [detailedShape, support]
    const positions = detailedShape instanceof RAPIER.Compound
      ? [...detailedShape.positions, { x: center.x * scale.x, y: scaledBottom + supportHalfHeight, z: center.z * scale.z }]
      : [{ x: 0, y: 0, z: 0 }, { x: center.x * scale.x, y: scaledBottom + supportHalfHeight, z: center.z * scale.z }]
    const rotations = detailedShape instanceof RAPIER.Compound
      ? [...detailedShape.rotations, identity]
      : [identity, identity]
    const supported = RAPIER.ColliderDesc.compound(shapes, positions, rotations)
    runtime.colliderShape = supported.shape
    runtime.colliderScaleKey = scaleKey
    return supported
  }

  private moveRuntimeToOpenPosition(runtime: RuntimeItem): void {
    const transform = transformOf(runtime.root)
    const occupied = [...this.items.values()]
      .filter((candidate) => candidate !== runtime && candidate.snapshot.visible !== false)
      .map((candidate) => {
        candidate.root.updateMatrix()
        return candidate.bounds.clone().applyMatrix4(candidate.root.matrix)
      })
    const position = findOpenImportPosition(runtime.bounds, transform, occupied, this.project?.casePreset ?? 'modern3')
    runtime.root.position.copy(position)
    transform.position = { x: position.x, y: position.y, z: position.z }
    runtime.snapshot.transform = structuredClone(transform)
    const localItem = this.project?.items.find((candidate) => candidate.id === runtime.id)
    if (localItem) localItem.transform = structuredClone(transform)
    this.rebuildPhysics(runtime)
    this.callbacks.onTransform(runtime.id, transform, false)
  }

  private createBoundsCollider(runtime: RuntimeItem, item: DisplayItem): RAPIER.ColliderDesc {
    const size = runtime.bounds.getSize(new THREE.Vector3()).multiply(vector3(item.transform.scale))
    const center = runtime.bounds.getCenter(new THREE.Vector3()).multiply(vector3(item.transform.scale))
    return RAPIER.ColliderDesc.cuboid(
      Math.max(0.025, Math.abs(size.x) / 2),
      Math.max(0.025, Math.abs(size.y) / 2),
      Math.max(0.025, Math.abs(size.z) / 2)
    ).setTranslation(center.x, center.y, center.z)
  }

  private removeRuntimeItem(runtime: RuntimeItem, preserveSelection = false): void {
    if (runtime.id === this.selectedId) {
      if (preserveSelection) {
        this.selectionHelper.visible = false
        this.transformControls?.detach()
      } else {
        this.setSelection(null)
      }
    }
    if (runtime.body && this.world) this.removePhysicsBody(runtime.body, runtime.bodyWorldGeneration)
    runtime.body = null
    runtime.bodyWorldGeneration = 0
    if (this.dragTarget?.id === runtime.id) {
      this.dragTarget = null
      this.draggingTransform = false
      this.controls.enabled = true
    }
    runtime.mixer?.stopAllAction()
    this.itemLayer.remove(runtime.root)
    disposeObject(runtime.root)
    this.items.delete(runtime.id)
  }

  private handleTransformDragging(dragging: boolean): void {
    if (dragging) this.activeTransformId = this.attachedTransformId()
    const transformId = this.activeTransformId
    this.draggingTransform = dragging
    this.controls.enabled = !dragging
    if (transformId === DISPLAY_CASE_SELECTION_ID) {
      this.dragTarget = null
      if (!dragging) {
        this.callbacks.onTransform(DISPLAY_CASE_SELECTION_ID, transformOf(this.displayRoot), true)
        this.activeTransformId = null
        this.setSelection(this.selectedId)
      }
      return
    }
    const runtime = transformId ? this.items.get(transformId) : null
    if (!runtime?.body || !this.world) {
      if (!dragging) {
        this.activeTransformId = null
        this.setSelection(this.selectedId)
      }
      return
    }
    if (dragging) {
      runtime.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true)
      runtime.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      runtime.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
      const startsClear = !bodyOverlapsCollisionScene(this.world, runtime.body)
      this.dragTarget = {
        id: runtime.id,
        position: runtime.root.position.clone(),
        quaternion: runtime.root.quaternion.clone(),
        scale: runtime.root.scale.clone(),
        safePosition: startsClear ? runtime.root.position.clone() : null,
        safeQuaternion: startsClear ? runtime.root.quaternion.clone() : null,
        safeScale: startsClear ? runtime.root.scale.clone() : null
      }
    } else {
      const completedDragTarget = this.dragTarget
      let restoredPreviousPose = false
      if (bodyOverlapsCollisionScene(this.world, runtime.body)) {
        const nearestClearPosition = findNearestClearBodyPosition(this.world, runtime.body)
        if (nearestClearPosition) {
          runtime.body.setTranslation(nearestClearPosition, true)
        } else if (completedDragTarget?.safePosition) {
          runtime.body.setTranslation(completedDragTarget.safePosition, true)
          if (completedDragTarget.safeQuaternion) runtime.body.setRotation(completedDragTarget.safeQuaternion, true)
          restoredPreviousPose = true
        }
      }
      const translation = runtime.body.translation()
      const rotation = runtime.body.rotation()
      runtime.root.position.set(translation.x, translation.y, translation.z)
      runtime.root.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w)
      if (completedDragTarget?.id === runtime.id) {
        const scale = restoredPreviousPose
          ? completedDragTarget.safeScale ?? completedDragTarget.scale
          : completedDragTarget.scale
        runtime.root.scale.copy(scale)
      }
      let transform = transformOf(runtime.root)
      runtime.snapshot.transform = transform
      this.rebuildPhysics(runtime)

      // Scaling changes the collider only during rebuild. Validate that final
      // shape too, otherwise a large scale can create the same persisted
      // overlap even when the drag-time collider was clear.
      if (runtime.body && bodyOverlapsCollisionScene(this.world, runtime.body, { x: 0, y: 0, z: 0 }, true)) {
        const nearestClearPosition = findNearestClearBodyPosition(this.world, runtime.body, 4, true)
        if (nearestClearPosition) {
          runtime.root.position.set(nearestClearPosition.x, nearestClearPosition.y, nearestClearPosition.z)
        } else {
          if (completedDragTarget?.safePosition) runtime.root.position.copy(completedDragTarget.safePosition)
          if (completedDragTarget?.safeQuaternion) runtime.root.quaternion.copy(completedDragTarget.safeQuaternion)
          if (completedDragTarget?.safeScale) runtime.root.scale.copy(completedDragTarget.safeScale)
        }
        transform = transformOf(runtime.root)
        runtime.snapshot.transform = transform
        this.rebuildPhysics(runtime)
      }

      this.dragTarget = null
      this.callbacks.onTransform(runtime.id, transform, true)
      this.activeTransformId = null
      this.setSelection(this.selectedId)
    }
  }

  private handleTransformObjectChange(): void {
    if (this.activeTransformId === DISPLAY_CASE_SELECTION_ID && this.draggingTransform) {
      this.selectionHelper.update()
      return
    }
    const runtime = this.activeTransformId ? this.items.get(this.activeTransformId) : null
    if (!runtime?.body || !this.draggingTransform) return
    if (this.dragTarget?.id === runtime.id) {
      this.dragTarget.position.copy(runtime.root.position)
      this.dragTarget.quaternion.copy(runtime.root.quaternion)
      this.dragTarget.scale.copy(runtime.root.scale)
    }
    this.selectionHelper.update()
  }

  private advanceDraggedBody(timestep: number): void {
    if (!this.draggingTransform || !this.dragTarget) return
    const runtime = this.items.get(this.dragTarget.id)
    const body = runtime?.body
    if (!runtime || !body || body.bodyType() !== RAPIER.RigidBodyType.KinematicPositionBased) return

    const translation = body.translation()
    const currentPosition = new THREE.Vector3(translation.x, translation.y, translation.z)
    const offset = this.dragTarget.position.clone().sub(currentPosition)
    const maximumStep = 4 * timestep
    if (offset.lengthSq() > maximumStep * maximumStep) offset.setLength(maximumStep)
    const nextPosition = currentPosition.add(offset)
    body.setNextKinematicTranslation(nextPosition)

    const rotation = body.rotation()
    const currentRotation = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w)
    const angle = currentRotation.angleTo(this.dragTarget.quaternion)
    if (angle > 0.0001) currentRotation.slerp(this.dragTarget.quaternion, Math.min(1, (3 * timestep) / angle))
    body.setNextKinematicRotation(currentRotation)
  }

  private prepareRestoredPhysics(): void {
    if (!this.world || !this.project || this.restoringPhysicsProjectId !== this.project.id) return

    const entries = [...this.project.items]
      .sort((left, right) => restoredItemSupportPriority(left) - restoredItemSupportPriority(right))
      .flatMap((item) => {
        const body = this.items.get(item.id)?.body
        return body ? [{ body, preservePosition: item.physics.placementLocked }] : []
      })
    resolveRestoredBodyOverlaps(this.world, entries, 4)

    for (const runtime of this.items.values()) {
      const body = runtime.body
      if (!body) continue
      if (body.bodyType() === RAPIER.RigidBodyType.Dynamic) {
        body.setLinvel({ x: 0, y: 0, z: 0 }, false)
        body.setAngvel({ x: 0, y: 0, z: 0 }, false)
      }
      const position = body.translation()
      const rotation = body.rotation()
      runtime.root.position.set(position.x, position.y, position.z)
      runtime.root.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w)
    }

    this.restoringPhysicsProjectId = null
    this.physicsStabilizationFrames = RESTORED_PHYSICS_STABILIZATION_FRAMES
  }

  private limitBodyVelocity(body: RAPIER.RigidBody, maximumLinear: number, maximumAngular: number): void {
    const linear = body.linvel()
    const linearLength = Math.hypot(linear.x, linear.y, linear.z)
    if (linearLength > maximumLinear) {
      const factor = maximumLinear / linearLength
      body.setLinvel({ x: linear.x * factor, y: linear.y * factor, z: linear.z * factor }, true)
    }

    const angular = body.angvel()
    const angularLength = Math.hypot(angular.x, angular.y, angular.z)
    if (angularLength > maximumAngular) {
      const factor = maximumAngular / angularLength
      body.setAngvel({ x: angular.x * factor, y: angular.y * factor, z: angular.z * factor }, true)
    }
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.variant !== 'editor') return
    const rect = this.canvas.getBoundingClientRect()
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const itemRoots = [...this.items.values()]
      .filter((runtime) => runtime.snapshot.visible !== false)
      .map((runtime) => runtime.root)

    // TransformControls highlights its own (intentionally forgiving) picker,
    // not the thin rendered ring. Refresh that same picker at pointerdown so a
    // direct press or visible hover cannot fall through to the case behind it.
    if (transformAxisAtPointer(this.transformControls, this.pointer, event.button) !== null) return

    // When no axis was highlighted, keep the forgiving native picker from
    // claiming a normal scene click at pointerdown.
    if (this.transformControls) {
      const controls = this.transformControls
      const wasEnabled = controls.enabled
      controls.axis = null
      controls.enabled = false
      queueMicrotask(() => {
        if (!this.disposed) controls.enabled = wasEnabled
      })
    }

    const id = pickSceneSelection(this.raycaster, itemRoots, this.caseLayer.visible ? this.caseLayer : null)
    if (id === this.selectedId) return
    this.setSelection(id)
    this.callbacks.onSelect(id)
  }

  private handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault()
  }
}
