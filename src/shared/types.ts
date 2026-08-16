export type Language = 'ko' | 'en' | 'ja' | 'zh-Hans'
export type CasePreset = 'gallery' | 'glass' | 'warm'
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
  setDisplayEditing: (editing: boolean) => Promise<void>
  setDisplayPointerIgnored: (ignored: boolean) => void
  startDisplayResize: (edge: DisplayResizeEdge, point: { x: number; y: number }) => void
  updateDisplayResize: (point: { x: number; y: number }) => void
  endDisplayResize: () => void
  startDisplayMove: (point: { x: number; y: number }) => void
  updateDisplayMove: (point: { x: number; y: number }) => void
  endDisplayMove: () => void
  onDisplayEditingChanged: (listener: (editing: boolean) => void) => () => void
  onProjectChanged: (listener: (event: ProjectEvent) => void) => () => void
  onProjectPreview: (listener: (project: DisplayProject) => void) => () => void
  onCameraPreview: (listener: (preview: CameraPreviewEvent) => void) => () => void
  onSettingsChanged: (listener: (event: SettingsEvent) => void) => () => void
}
