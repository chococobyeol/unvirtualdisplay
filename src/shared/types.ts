export type Language = 'ko' | 'en' | 'ja' | 'zh-Hans'
export const CASE_PRESETS = [
  'modern1', 'modern2', 'modern3',
  'glass1', 'glass2', 'glass3',
  'wood1', 'wood2', 'wood3'
] as const
export type CasePreset = typeof CASE_PRESETS[number]
export type CaseStyle = 'modern' | 'glass' | 'wood'
export type CaseTier = 1 | 2 | 3

export const CASE_PRESET_META: Record<CasePreset, { style: CaseStyle, tier: CaseTier }> = {
  modern1: { style: 'modern', tier: 1 },
  modern2: { style: 'modern', tier: 2 },
  modern3: { style: 'modern', tier: 3 },
  glass1: { style: 'glass', tier: 1 },
  glass2: { style: 'glass', tier: 2 },
  glass3: { style: 'glass', tier: 3 },
  wood1: { style: 'wood', tier: 1 },
  wood2: { style: 'wood', tier: 2 },
  wood3: { style: 'wood', tier: 3 }
}

export function isCasePreset(value: unknown): value is CasePreset {
  return typeof value === 'string' && CASE_PRESETS.includes(value as CasePreset)
}

export function normalizeCasePreset(value: unknown): CasePreset {
  if (isCasePreset(value)) return value
  if (value === 'oneTier') return 'modern1'
  if (value === 'twoTier') return 'modern2'
  if (value === 'glass') return 'glass3'
  if (value === 'warm') return 'wood3'
  return 'modern3'
}
export type QualityPreset = 'low' | 'balanced' | 'high'
export type TransformMode = 'translate' | 'rotate' | 'scale'
export type DisplayItemKind = 'model' | 'image'
export type ImageDisplayType = 'acrylic' | 'panel' | 'frame' | 'photocard'
export type AcrylicShape = 'contour' | 'rectangle' | 'ellipse'
export type BackgroundMode = 'transparent' | 'solid' | 'image'
export type BackgroundFit = 'cover' | 'contain'
export type DisplayResizeEdge = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'

export const DISPLAY_CASE_SELECTION_ID = '__display_case__'

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface TransformState {
  position: Vec3
  rotation: Vec3
  scale: Vec3
}

export function createDefaultDisplayTransform(): TransformState {
  return {
    position: { x: 0, y: -0.65, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
  }
}

export interface PhysicsSettings {
  collision: boolean
  preventToppling: boolean
  placementLocked: boolean
}

export interface AnimationSettings {
  enabled: boolean
  clipIndex: number
  loop: boolean
  speed: number
}

export interface DisplayItem {
  id: string
  name: string
  kind: DisplayItemKind
  format: string
  assetUrl: string
  relativePath: string
  visible?: boolean
  imageDisplayType?: ImageDisplayType
  acrylicShape?: AcrylicShape
  acrylicOffset?: number
  transform: TransformState
  physics: PhysicsSettings
  animation: AnimationSettings
}

export interface CameraSettings {
  position: Vec3
  target: Vec3
  fov: number
}

export function createDefaultCameraSettings(): CameraSettings {
  return {
    position: { x: 4.8, y: 3.2, z: 6.8 },
    target: { x: 0, y: 1.25, z: 0 },
    fov: 36
  }
}

export interface LightingSettings {
  intensity: number
  warmth: number
  shadows: boolean
  azimuth: number
  elevation: number
}

export function createDefaultLightingSettings(): LightingSettings {
  return {
    intensity: 1,
    warmth: 0.55,
    shadows: true,
    azimuth: 30,
    elevation: 45
  }
}

export interface BackgroundSettings {
  mode: BackgroundMode
  color: string
  fit: BackgroundFit
  imageUrl?: string
  relativePath?: string
}

export interface DisplayProject {
  schemaVersion: 1
  revision: number
  id: string
  name: string
  casePreset: CasePreset
  caseVisible?: boolean
  displayTransform: TransformState
  items: DisplayItem[]
  camera: CameraSettings
  lighting: LightingSettings
  background: BackgroundSettings
  createdAt: string
  updatedAt: string
}

export interface ProjectSummary {
  id: string
  name: string
  itemCount: number
  updatedAt: string
}

export interface AppSettings {
  language: Language
  onboardingComplete: boolean
  alwaysOnTop: boolean
  clickThrough: boolean
  quality: QualityPreset
  displayBounds?: { x: number; y: number; width: number; height: number }
}

export interface BootstrapData {
  role: 'editor' | 'display'
  appVersion: string
  displayVisible: boolean
  projects: ProjectSummary[]
  activeProject: DisplayProject
  settings: AppSettings
}

export interface ImportedAsset {
  name: string
  extension: string
  kind: DisplayItemKind
  assetUrl: string
  relativePath: string
}

export interface ProjectEvent {
  project: DisplayProject
  projects: ProjectSummary[]
  activeProjectId: string
}

export interface CameraPreviewEvent {
  projectId: string
  camera: CameraSettings
}

export type ProjectResetScope = 'items' | 'all'

export interface SettingsEvent {
  settings: AppSettings
}

export interface UnvirtualApi {
  bootstrap: () => Promise<BootstrapData>
  createProject: (name?: string) => Promise<ProjectEvent>
  duplicateProject: (projectId: string) => Promise<ProjectEvent>
  deleteProject: (projectId: string) => Promise<ProjectEvent>
  reorderProjects: (projectIds: string[]) => Promise<ProjectEvent>
  activateProject: (projectId: string) => Promise<ProjectEvent>
  saveProject: (project: DisplayProject) => Promise<ProjectEvent>
  resetProject: (projectId: string, scope: ProjectResetScope) => Promise<ProjectEvent>
  resetData: () => Promise<ProjectEvent>
  previewProject: (project: DisplayProject) => void
  previewCamera: (preview: CameraPreviewEvent) => void
  exportProject: (projectId: string) => Promise<boolean>
  importProjectArchive: () => Promise<ProjectEvent | null>
  importAssets: (projectId: string) => Promise<ImportedAsset[]>
  importDroppedAssets: (projectId: string, paths: string[]) => Promise<ImportedAsset[]>
  importBackground: (projectId: string) => Promise<ImportedAsset | null>
  getPathForFile: (file: File) => string
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>
  saveCapture: (suggestedName: string, data: Uint8Array) => Promise<boolean>
  exportDiagnostics: () => Promise<boolean>
  setDisplayVisible: (visible: boolean) => Promise<boolean>
  setDisplayEditing: (editing: boolean) => Promise<void>
  showDisplayContextMenu: () => void
  setDisplayPointerIgnored: (ignored: boolean) => void
  startDisplayResize: (edge: DisplayResizeEdge, point: { x: number; y: number }) => void
  updateDisplayResize: (point: { x: number; y: number }) => void
  endDisplayResize: () => void
  startDisplayMove: (point: { x: number; y: number }) => void
  updateDisplayMove: (point: { x: number; y: number }) => void
  endDisplayMove: () => void
  onDisplayVisibilityChanged: (listener: (visible: boolean) => void) => () => void
  onDisplayEditingChanged: (listener: (editing: boolean) => void) => () => void
  onProjectChanged: (listener: (event: ProjectEvent) => void) => () => void
  onProjectPreview: (listener: (project: DisplayProject) => void) => () => void
  onCameraPreview: (listener: (preview: CameraPreviewEvent) => void) => () => void
  onSettingsChanged: (listener: (event: SettingsEvent) => void) => () => void
}
