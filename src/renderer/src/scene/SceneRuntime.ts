import RAPIER from '@dimforge/rapier3d-compat'
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
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
import { findOpenImportPosition, isPlacementBelowSafetyFloor } from './itemPlacement'
import { hitsVisibleTransformHandle, pickSceneSelection } from './sceneSelection'

interface SceneCallbacks {
  onSelect: (id: string | null) => void
  onTransform: (id: string, transform: TransformState, remember?: boolean) => void
  onCameraPreview: (camera: CameraSettings) => void
  onCamera: (camera: CameraSettings) => void
}

interface RuntimeItem {
  id: string
  root: THREE.Group
  bounds: THREE.Box3
  body: RAPIER.RigidBody | null
  mixer: THREE.AnimationMixer | null
  clips: THREE.AnimationClip[]
  vrm: VRM | null
  snapshot: DisplayItem
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

const ENVIRONMENT_GROUP = 0x0001
const ITEM_GROUP = 0x0002
const groupMask = (memberships: number, filters: number): number => (memberships << 16) | filters
let rapierInitialization: Promise<void> | null = null

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

function createAcrylicCutoutTexture(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  panelWidth: number,
  panelHeight: number,
  offset: number
): THREE.CanvasTexture {
  const scale = Math.min(1, 256 / Math.max(sourceWidth, sourceHeight))
  const sampleWidth = Math.max(1, Math.round(sourceWidth * scale))
  const sampleHeight = Math.max(1, Math.round(sourceHeight * scale))
  const density = Math.min(sampleWidth / panelWidth, sampleHeight / panelHeight)
  const radius = Math.max(1, Math.min(48, Math.round(offset * density)))
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
  return texture
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
  private readonly gltfLoader = new GLTFLoader()
  private readonly fbxLoader = new FBXLoader()
  private readonly objLoader = new OBJLoader()
  private world: RAPIER.World | null = null
  private project: DisplayProject | null = null
  private animationFrame = 0
  private resizeObserver: ResizeObserver
  private selectedId: string | null = null
  private transformMode: TransformMode = 'translate'
  private draggingTransform = false
  private dragTarget: DragTarget | null = null
  private settlementReported = true
  private casePreset: CasePreset | null = null
  private projectId: string | null = null
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
    this.controls.maxDistance = 12
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
    this.keyLight.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024)
    this.scene.add(this.fillLight, this.keyLight, this.keyLight.target)

    this.gltfLoader.register((parser) => new VRMLoaderPlugin(parser))
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
    this.resize()
    this.animate()
  }

  async syncProject(project: DisplayProject): Promise<void> {
    if (this.disposed) return
    const isNewProject = this.projectId !== project.id
    const previousItemIds = new Set(this.project?.items.map((item) => item.id) ?? [])
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
        runtime.snapshot.assetUrl !== item.assetUrl ||
        runtime.snapshot.imageDisplayType !== item.imageDisplayType ||
        runtime.snapshot.acrylicShape !== item.acrylicShape ||
        runtime.snapshot.acrylicOffset !== item.acrylicOffset
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

    if (this.world && this.variant === 'editor') {
      this.world.timestep = Math.min(delta, 1 / 30)
      this.advanceDraggedBody(this.world.timestep)
      this.world.step()
      let anyMoving = false
      let anyChanged = false

      for (const runtime of this.items.values()) {
        const body = runtime.body
        if (!body) continue
        const isDraggedBody = this.draggingTransform && this.dragTarget?.id === runtime.id
        if (body.bodyType() === RAPIER.RigidBodyType.Dynamic || isDraggedBody) {
          if (this.draggingTransform && body.bodyType() === RAPIER.RigidBodyType.Dynamic) {
            this.limitPushedBodyVelocity(body)
          }
          const position = body.translation()
          const rotation = body.rotation()
          runtime.root.position.set(position.x, position.y, position.z)
          runtime.root.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w)
          if (isDraggedBody && this.dragTarget) runtime.root.scale.copy(this.dragTarget.scale)
          if (!isDraggedBody && isPlacementBelowSafetyFloor(runtime.bounds, transformOf(runtime.root))) {
            this.moveRuntimeToOpenPosition(runtime)
            anyMoving = true
            anyChanged = true
            continue
          }
          if (isDraggedBody && this.dragTarget && !this.isBodyOverlappingEnvironment(body)) {
            this.dragTarget.safePosition = runtime.root.position.clone()
            this.dragTarget.safeQuaternion = runtime.root.quaternion.clone()
            this.dragTarget.safeScale = runtime.root.scale.clone()
          }
          if (body.bodyType() === RAPIER.RigidBodyType.Dynamic && !body.isSleeping()) anyMoving = true
          if (transformsDiffer(transformOf(runtime.root), runtime.snapshot.transform)) anyChanged = true
        }
        runtime.mixer?.update(runtime.snapshot.animation.enabled ? delta * runtime.snapshot.animation.speed : 0)
        runtime.vrm?.update(delta)
      }


      if (this.draggingTransform || anyMoving) {
        this.settlementReported = false
      } else if (anyChanged && !this.settlementReported) {
        this.settlementReported = true
        for (const runtime of this.items.values()) {
          const transform = transformOf(runtime.root)
          if (transformsDiffer(transform, runtime.snapshot.transform)) {
            runtime.snapshot.transform = transform
            this.callbacks.onTransform(runtime.id, transform, false)
          }
        }
      }
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
      for (const body of this.staticBodies.splice(0)) this.world.removeRigidBody(body)
    }

    const palette = preset === 'warm'
      ? { base: 0x6b4932, back: 0x493326, frame: 0x2f231c, shelf: 0x8a6244 }
      : preset === 'glass'
        ? { base: 0x272a2c, back: 0x9eaaa8, frame: 0x27292b, shelf: 0x494f51 }
        : { base: 0xd7d0c3, back: 0xc6c0b4, frame: 0x45413d, shelf: 0xb4aea3 }

    const baseMaterial = new THREE.MeshStandardMaterial({ color: palette.base, roughness: preset === 'warm' ? 0.72 : 0.48, metalness: 0.03 })
    const backMaterial = new THREE.MeshStandardMaterial({ color: palette.back, roughness: 0.78, side: THREE.DoubleSide })
    const shelfMaterial = new THREE.MeshStandardMaterial({ color: palette.shelf, roughness: preset === 'warm' ? 0.65 : 0.42, metalness: preset === 'glass' ? 0.25 : 0.02 })
    const frameMaterial = new THREE.MeshStandardMaterial({ color: palette.frame, roughness: 0.42, metalness: 0.35 })

    const addBox = (size: [number, number, number], position: [number, number, number], material: THREE.Material, shadows = true): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material)
      mesh.position.set(...position)
      mesh.castShadow = shadows
      mesh.receiveShadow = shadows
      this.caseLayer.add(mesh)
      return mesh
    }

    addBox([5.4, 0.18, 2.7], [0, -0.09, 0], baseMaterial)
    addBox([5.25, 3.9, 0.12], [0, 1.88, -1.29], backMaterial)
    addBox([4.95, 0.1, 2.4], [0, 1.42, 0], shelfMaterial)
    addBox([4.95, 0.1, 2.4], [0, 2.78, 0], shelfMaterial)

    if (preset === 'glass') {
      const glass = new THREE.MeshPhysicalMaterial({ color: 0xdceeed, transparent: true, opacity: 0.13, roughness: 0.08, metalness: 0, transmission: 0.25, depthWrite: false, side: THREE.DoubleSide })
      const left = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 3.9), glass)
      left.rotation.y = Math.PI / 2
      left.position.set(-2.64, 1.88, 0)
      const right = left.clone()
      right.position.x = 2.64
      this.caseLayer.add(left, right)
    }

    for (const x of [-2.64, 2.64]) {
      addBox([0.1, 4.05, 0.1], [x, 1.92, -1.25], frameMaterial)
      addBox([0.1, 4.05, 0.1], [x, 1.92, 1.25], frameMaterial)
    }
    addBox([5.38, 0.1, 0.1], [0, 3.93, -1.25], frameMaterial)
    addBox([5.38, 0.1, 0.1], [0, 3.93, 1.25], frameMaterial)

    if (this.variant === 'editor') {
      const grid = new THREE.GridHelper(5.2, 20, 0x6f6558, 0x403b35)
      grid.position.y = 0.008
      const materials = Array.isArray(grid.material) ? grid.material : [grid.material]
      materials.forEach((material) => { material.transparent = true; material.opacity = 0.22 })
      this.caseLayer.add(grid)
    }

    this.addStaticCollider([2.7, 0.09, 1.35], [0, -0.09, 0])
    this.addStaticCollider([2.58, 0.05, 1.22], [0, 1.42, 0])
    this.addStaticCollider([2.58, 0.05, 1.22], [0, 2.78, 0])
    this.addStaticCollider([2.64, 1.95, 0.06], [0, 1.88, -1.29])
    this.addStaticCollider([0.05, 1.95, 1.3], [-2.66, 1.88, 0])
    this.addStaticCollider([0.05, 1.95, 1.3], [2.66, 1.88, 0])
    // A wide invisible floor sits directly beneath the case base so items that
    // fall over an edge settle below the display instead of falling forever.
    this.addStaticCollider([24, 0.08, 24], [0, -0.26, 0])
    this.settlementReported = false
  }

  private addStaticCollider(halfExtents: [number, number, number], position: [number, number, number]): void {
    if (!this.world) return
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...position))
    const collider = RAPIER.ColliderDesc.cuboid(...halfExtents).setCollisionGroups(groupMask(ENVIRONMENT_GROUP, ITEM_GROUP))
    this.world.createCollider(collider, body)
    this.staticBodies.push(body)
  }

  private async addItem(item: DisplayItem, autoPlace = false): Promise<void> {
    const loadToken = Symbol(item.id)
    this.pendingItemLoads.set(item.id, loadToken)
    let loaded: RuntimeItem | null = null
    try {
      loaded = item.kind === 'image' ? await this.createImageItem(item) : await this.createModelItem(item)
    } catch (error) {
      console.error(`Failed to load ${item.name}`, error)
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
      this.items.has(item.id)
    ) {
      if (loaded) disposeObject(loaded.root)
      if (!this.disposed && latest && !this.items.has(item.id) && !this.pendingItemLoads.has(item.id)) {
        void this.addItem(latest, autoPlace)
      }
      return
    }

    const placedItem = cloneItem(latest)
    const requiresRecovery = isPlacementBelowSafetyFloor(loaded.bounds, placedItem.transform)
    if (autoPlace || requiresRecovery) {
      const occupied = [...this.items.values()]
        .filter((runtime) => runtime.snapshot.visible !== false)
        .map((runtime) => {
          runtime.root.updateMatrix()
          return runtime.bounds.clone().applyMatrix4(runtime.root.matrix)
        })
      const position = findOpenImportPosition(loaded.bounds, placedItem.transform, occupied)
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
    this.settlementReported = false
  }

  private async createModelItem(item: DisplayItem): Promise<RuntimeItem> {
    let content: THREE.Object3D
    let clips: THREE.AnimationClip[] = []
    let vrm: VRM | null = null

    if (['glb', 'gltf', 'vrm'].includes(item.format)) {
      const gltf = await this.gltfLoader.loadAsync(item.assetUrl) as GLTF
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
      const fbx = await this.fbxLoader.loadAsync(item.assetUrl)
      content = fbx
      clips = fbx.animations
    } else {
      content = await this.objLoader.loadAsync(item.assetUrl)
    }

    content.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      mesh.receiveShadow = true
      if (Array.isArray(mesh.material)) mesh.material.forEach((material) => { material.side = THREE.FrontSide })
    })

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
    return { id: item.id, root, bounds, body: null, mixer, clips, vrm, snapshot: cloneItem(item) }
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
    const acrylicOffset = Math.max(0.005, item.acrylicOffset ?? 0.045)
    const frameThickness = 0.075
    const frameOuterBottom = 0.02
    const imageBottom = type === 'acrylic'
      ? 0.08 + acrylicOffset
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

    const clear = new THREE.MeshPhysicalMaterial({ color: 0xe9f4f2, transparent: true, opacity: 0.28, roughness: 0.14, transmission: 0.2, depthWrite: false })
    clear.forceSinglePass = true
    const dark = new THREE.MeshStandardMaterial({ color: 0x302c28, roughness: 0.55 })
    const cream = new THREE.MeshStandardMaterial({ color: 0xe2d8c9, roughness: 0.6 })

    if (type === 'acrylic') {
      const offset = acrylicOffset
      const shape = item.acrylicShape ?? 'contour'
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
          const cutoutMaterial = new THREE.MeshPhysicalMaterial({
            map: cutout,
            color: 0xffffff,
            transparent: true,
            opacity: 0.42,
            roughness: 0.12,
            transmission: 0.18,
            depthWrite: false,
            side: THREE.DoubleSide
          })
          cutoutMaterial.forceSinglePass = true
          backing = new THREE.Mesh(new THREE.PlaneGeometry(panelWidth + offset * 2, panelHeight + offset * 2), cutoutMaterial)
        } catch (error) {
          console.warn(`Could not generate acrylic outline for ${item.name}`, error)
          backing = new THREE.Mesh(new THREE.BoxGeometry(panelWidth + offset * 2, panelHeight + offset * 2, 0.04), clear)
        }
      }
      backing.position.copy(image.position).setZ(0)
      backing.renderOrder = 10
      const base = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(0.24, panelWidth * 0.34), Math.max(0.28, panelWidth * 0.38), 0.08, 32), clear)
      base.position.y = 0.04
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
    return { id: item.id, root, bounds, body: null, mixer: null, clips: [], vrm: null, snapshot: cloneItem(item) }
  }

  private createErrorItem(item: DisplayItem): RuntimeItem {
    const root = new THREE.Group()
    const material = new THREE.MeshStandardMaterial({ color: 0x6f3430, roughness: 0.7 })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), material)
    mesh.position.y = 0.35
    root.add(mesh)
    return { id: item.id, root, bounds: new THREE.Box3().setFromObject(root), body: null, mixer: null, clips: [], vrm: null, snapshot: cloneItem(item) }
  }

  private syncRuntimeItem(runtime: RuntimeItem, item: DisplayItem, force = false): void {
    const transformChanged = transformsDiffer(runtime.snapshot.transform, item.transform)
    const physicsChanged = JSON.stringify(runtime.snapshot.physics) !== JSON.stringify(item.physics)
    const visibilityChanged = (runtime.snapshot.visible !== false) !== (item.visible !== false)
    const missingPhysics = this.variant === 'editor' && item.visible !== false && !runtime.body
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
    if (runtime.body) this.world.removeRigidBody(runtime.body)
    runtime.body = null

    const item = runtime.snapshot
    if (item.visible === false) return
    const quaternion = runtime.root.quaternion
    const freeImage = item.kind === 'image' && !item.physics.preventToppling && !item.physics.placementLocked
    const descriptor = item.physics.placementLocked
      ? RAPIER.RigidBodyDesc.fixed()
      : RAPIER.RigidBodyDesc.dynamic()
        .setCanSleep(true)
        .setLinearDamping(freeImage ? 2.6 : 1.8)
        .setAngularDamping(freeImage ? 5.5 : 2.8)
        .setCcdEnabled(true)
        .setAdditionalSolverIterations(freeImage ? 2 : 0)
    descriptor.setTranslation(item.transform.position.x, item.transform.position.y, item.transform.position.z)
    descriptor.setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w })
    const body = this.world.createRigidBody(descriptor)
    if (item.physics.preventToppling && !item.physics.placementLocked) body.lockRotations(true, true)

    const collider = item.kind === 'image'
      ? this.createImageCollider(runtime, item)
      : this.createDetailedCollider(runtime, item) ?? this.createBoundsCollider(runtime, item)
    collider
      .setFriction(0.72)
      .setRestitution(0)
      .setContactSkin(0.003)
      .setCollisionGroups(groupMask(ITEM_GROUP, ENVIRONMENT_GROUP | (item.physics.collision ? ITEM_GROUP : 0)))
    this.world.createCollider(collider, body)
    runtime.body = body
    this.settlementReported = false
  }

  private createImageCollider(runtime: RuntimeItem, item: DisplayItem): RAPIER.ColliderDesc {
    const scale = item.transform.scale
    const scaleKey = `image:${scale.x.toFixed(4)}:${scale.y.toFixed(4)}:${scale.z.toFixed(4)}`
    if (runtime.colliderShape && runtime.colliderScaleKey === scaleKey) {
      return new RAPIER.ColliderDesc(runtime.colliderShape)
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
    const position = findOpenImportPosition(runtime.bounds, transform, occupied)
    runtime.root.position.copy(position)
    transform.position = { x: position.x, y: position.y, z: position.z }
    runtime.snapshot.transform = structuredClone(transform)
    const localItem = this.project?.items.find((candidate) => candidate.id === runtime.id)
    if (localItem) localItem.transform = structuredClone(transform)
    this.rebuildPhysics(runtime)
    this.callbacks.onTransform(runtime.id, transform, false)
    this.settlementReported = false
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
    if (runtime.body && this.world) this.world.removeRigidBody(runtime.body)
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
    if (this.selectedId === DISPLAY_CASE_SELECTION_ID) {
      this.draggingTransform = dragging
      this.dragTarget = null
      this.controls.enabled = !dragging
      if (!dragging) this.callbacks.onTransform(DISPLAY_CASE_SELECTION_ID, transformOf(this.displayRoot), true)
      return
    }
    const runtime = this.selectedId ? this.items.get(this.selectedId) : null
    if (!runtime?.body || !this.world) return
    this.draggingTransform = dragging
    this.controls.enabled = !dragging
    if (dragging) {
      runtime.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true)
      runtime.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      runtime.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
      const startsClear = !this.isBodyOverlappingEnvironment(runtime.body)
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
      let restoredSafePose = false
      if (this.isBodyOverlappingEnvironment(runtime.body)) {
        const safePosition = this.dragTarget?.safePosition ?? this.findNearestClearPosition(runtime.body)
        if (safePosition) {
          runtime.body.setTranslation(safePosition, true)
          if (this.dragTarget?.safeQuaternion) runtime.body.setRotation(this.dragTarget.safeQuaternion, true)
          restoredSafePose = true
        }
      }
      const translation = runtime.body.translation()
      const rotation = runtime.body.rotation()
      runtime.root.position.set(translation.x, translation.y, translation.z)
      runtime.root.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w)
      if (this.dragTarget?.id === runtime.id) {
        const scale = restoredSafePose
          ? this.dragTarget.safeScale ?? this.dragTarget.scale
          : this.dragTarget.scale
        runtime.root.scale.copy(scale)
      }
      this.dragTarget = null
      const transform = transformOf(runtime.root)
      runtime.snapshot.transform = transform
      this.rebuildPhysics(runtime)
      this.callbacks.onTransform(runtime.id, transform, true)
    }
  }

  private handleTransformObjectChange(): void {
    if (this.selectedId === DISPLAY_CASE_SELECTION_ID && this.draggingTransform) {
      this.selectionHelper.update()
      return
    }
    const runtime = this.selectedId ? this.items.get(this.selectedId) : null
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

  private limitPushedBodyVelocity(body: RAPIER.RigidBody): void {
    const linear = body.linvel()
    const linearLength = Math.hypot(linear.x, linear.y, linear.z)
    if (linearLength > 2.5) {
      const factor = 2.5 / linearLength
      body.setLinvel({ x: linear.x * factor, y: linear.y * factor, z: linear.z * factor }, true)
    }

    const angular = body.angvel()
    const angularLength = Math.hypot(angular.x, angular.y, angular.z)
    if (angularLength > 4) {
      const factor = 4 / angularLength
      body.setAngvel({ x: angular.x * factor, y: angular.y * factor, z: angular.z * factor }, true)
    }
  }

  private isBodyOverlappingEnvironment(body: RAPIER.RigidBody): boolean {
    if (!this.world) return false
    for (let index = 0; index < body.numColliders(); index += 1) {
      const collider = body.collider(index)
      const intersection = this.world.intersectionWithShape(
        collider.translation(),
        collider.rotation(),
        collider.shape,
        RAPIER.QueryFilterFlags.ONLY_FIXED,
        groupMask(ITEM_GROUP, ENVIRONMENT_GROUP),
        collider,
        body
      )
      if (intersection) return true
    }
    return false
  }

  private findNearestClearPosition(body: RAPIER.RigidBody): THREE.Vector3 | null {
    if (!this.world || body.numColliders() === 0) return null
    const collider = body.collider(0)
    const colliderPosition = collider.translation()
    const bodyPosition = body.translation()
    const directions = [
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1)
    ]

    for (let distance = 0.02; distance <= 2.5; distance += 0.02) {
      for (const direction of directions) {
        const offset = direction.clone().multiplyScalar(distance)
        const candidateColliderPosition = new THREE.Vector3(colliderPosition.x, colliderPosition.y, colliderPosition.z).add(offset)
        const intersection = this.world.intersectionWithShape(
          candidateColliderPosition,
          collider.rotation(),
          collider.shape,
          RAPIER.QueryFilterFlags.ONLY_FIXED,
          groupMask(ITEM_GROUP, ENVIRONMENT_GROUP),
          collider,
          body
        )
        if (!intersection) {
          return new THREE.Vector3(bodyPosition.x, bodyPosition.y, bodyPosition.z).add(offset)
        }
      }
    }
    return null
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

    const controlsHelper = this.transformControls?.getHelper() ?? null
    if (hitsVisibleTransformHandle(this.raycaster, controlsHelper)) return

    // The native TransformControls picker is deliberately much wider than the
    // rendered arrows. Disable it for this pointerdown unless a visible handle
    // was hit, so ordinary scene clicks reach the object actually under them.
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
