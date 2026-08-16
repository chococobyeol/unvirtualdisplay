import { create } from 'zustand'
import type {
  AppSettings,
  BootstrapData,
  DisplayItem,
  DisplayProject,
  ImportedAsset,
  ProjectEvent,
  ProjectResetScope,
  ProjectSummary,
  TransformMode,
  TransformState
} from '../../shared/types'
import { createDefaultDisplayTransform, createDefaultLightingSettings, DISPLAY_CASE_SELECTION_ID } from '../../shared/types'
import { setLanguage } from './i18n'

interface AppState {
  ready: boolean
  error: string | null
  role: BootstrapData['role']
  appVersion: string
  projects: ProjectSummary[]
  project: DisplayProject | null
  settings: AppSettings | null
  selectedItemId: string | null
  transformMode: TransformMode
  saveStatus: 'saved' | 'saving'
  history: DisplayProject[]
  future: DisplayProject[]
  initialize: () => Promise<void>
  setSelectedItem: (id: string | null) => void
  setTransformMode: (mode: TransformMode) => void
  mutateProject: (mutate: (draft: DisplayProject) => void, remember?: boolean) => void
  updateItemTransform: (id: string, transform: TransformState, remember?: boolean) => void
  importAssets: (files?: File[]) => Promise<void>
  createProject: () => Promise<void>
  duplicateProject: () => Promise<void>
  deleteProject: () => Promise<void>
  activateProject: (id: string) => Promise<void>
  clearProject: () => Promise<void>
  resetProject: () => Promise<void>
  backupProject: () => Promise<void>
  restoreProject: () => Promise<void>
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  undo: () => void
  redo: () => void
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let pendingSaveProject: DisplayProject | null = null
let saveQueue: Promise<void> = Promise.resolve()
let listenersBound = false

type StoreSet = (partial: Partial<AppState>) => void
type StoreGet = () => AppState

function newItem(asset: ImportedAsset, index: number): DisplayItem {
  return {
    id: crypto.randomUUID(),
    name: asset.name,
    kind: asset.kind,
    format: asset.extension,
    assetUrl: asset.assetUrl,
    relativePath: asset.relativePath,
    visible: true,
    imageDisplayType: asset.kind === 'image' ? 'acrylic' : undefined,
    acrylicShape: asset.kind === 'image' ? 'contour' : undefined,
    acrylicOffset: asset.kind === 'image' ? 0.045 : undefined,
    transform: {
      position: { x: (index % 4) * 0.8 - 1.2, y: 1.4 + Math.floor(index / 4) * 0.3, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    },
    physics: {
      collision: true,
      preventToppling: true,
      placementLocked: false
    },
    animation: {
      enabled: false,
      clipIndex: 0,
      loop: true,
      speed: 1
    }
  }
}

function cloneProject(project: DisplayProject): DisplayProject {
  return structuredClone(project)
}

function withDisplayDefaults(project: DisplayProject): DisplayProject {
  const defaultLighting = createDefaultLightingSettings()
  const lighting = project.lighting ?? defaultLighting
  return {
    ...project,
    caseVisible: project.caseVisible !== false,
    displayTransform: project.displayTransform ?? createDefaultDisplayTransform(),
    lighting: {
      ...lighting,
      azimuth: Number.isFinite(lighting.azimuth) ? lighting.azimuth : defaultLighting.azimuth,
      elevation: Number.isFinite(lighting.elevation) ? lighting.elevation : defaultLighting.elevation
    }
  }
}

function summariesWithCurrent(projects: ProjectSummary[], current: DisplayProject | null): ProjectSummary[] {
  if (!current) return projects
  return projects.map((summary) => summary.id === current.id
    ? { ...summary, name: current.name, itemCount: current.items.length, updatedAt: current.updatedAt }
    : summary)
}

function applyEvent(set: StoreSet, get: StoreGet, event: ProjectEvent): void {
  const eventProject = withDisplayDefaults(event.project)
  const current = get().project
  const eventProjectIsActive = eventProject.id === event.activeProjectId
  if (!eventProjectIsActive) {
    set({ projects: summariesWithCurrent(event.projects, current) })
    return
  }

  if (current?.id === eventProject.id && current.revision > eventProject.revision) {
    set({ projects: summariesWithCurrent(event.projects, current), saveStatus: 'saving' })
    return
  }

  const projectChanged = current?.id !== eventProject.id
  const selectedItemId = get().selectedItemId
  set({
    project: eventProject,
    projects: event.projects,
    selectedItemId: selectedItemId && (selectedItemId === DISPLAY_CASE_SELECTION_ID || eventProject.items.some((item) => item.id === selectedItemId)) ? selectedItemId : null,
    saveStatus: 'saved',
    history: projectChanged ? [] : get().history,
    future: projectChanged ? [] : get().future
  })
}

function applyPreview(set: StoreSet, get: StoreGet, project: DisplayProject): void {
  project = withDisplayDefaults(project)
  const current = get().project
  if (current && (current.id !== project.id || current.revision > project.revision)) return
  set({
    project,
    projects: summariesWithCurrent(get().projects, project),
    selectedItemId: get().selectedItemId && (get().selectedItemId === DISPLAY_CASE_SELECTION_ID || project.items.some((item) => item.id === get().selectedItemId))
      ? get().selectedItemId
      : null
  })
}

function enqueueSave(project: DisplayProject, set: StoreSet, get: StoreGet): Promise<void> {
  const snapshot = cloneProject(project)
  const operation = saveQueue.catch(() => undefined).then(async () => {
    try {
      applyEvent(set, get, await window.unvirtual.saveProject(snapshot))
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), saveStatus: 'saving' })
    }
  })
  saveQueue = operation
  return operation
}

function scheduleSave(project: DisplayProject, set: StoreSet, get: StoreGet): void {
  pendingSaveProject = cloneProject(project)
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    const pending = pendingSaveProject
    pendingSaveProject = null
    if (pending) void enqueueSave(pending, set, get)
  }, 280)
}

async function flushPendingSave(set: StoreSet, get: StoreGet): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  const pending = pendingSaveProject
  pendingSaveProject = null
  if (pending) await enqueueSave(pending, set, get)
  else await saveQueue.catch(() => undefined)
}

function makeNextRevision(project: DisplayProject, current: DisplayProject): DisplayProject {
  const next = cloneProject(project)
  next.revision = current.revision + 1
  next.updatedAt = new Date().toISOString()
  return next
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  error: null,
  role: 'editor',
  appVersion: '0.0.0',
  projects: [],
  project: null,
  settings: null,
  selectedItemId: null,
  transformMode: 'translate',
  saveStatus: 'saved',
  history: [],
  future: [],

  initialize: async () => {
    try {
      if (!window.unvirtual) throw new Error('The secure preload bridge did not start.')
      const data = await window.unvirtual.bootstrap()
      await setLanguage(data.settings.language)
      set({
        ready: true,
        error: null,
        role: data.role,
        appVersion: data.appVersion,
        projects: data.projects,
        project: withDisplayDefaults(data.activeProject),
        settings: data.settings
      })

      if (!listenersBound) {
        listenersBound = true
        window.unvirtual.onProjectChanged((event) => applyEvent(set, get, event))
        window.unvirtual.onProjectPreview((project) => applyPreview(set, get, project))
        window.unvirtual.onSettingsChanged(({ settings }) => {
          void setLanguage(settings.language)
          set({ settings })
        })
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  setSelectedItem: (selectedItemId) => set({ selectedItemId }),
  setTransformMode: (transformMode) => set({ transformMode }),

  mutateProject: (mutate, remember = true) => {
    const current = get().project
    if (!current) return
    const next = cloneProject(current)
    mutate(next)
    if (JSON.stringify(next) === JSON.stringify(current)) return
    next.revision = current.revision + 1
    next.updatedAt = new Date().toISOString()
    set({
      project: next,
      projects: summariesWithCurrent(get().projects, next),
      saveStatus: 'saving',
      history: remember ? [...get().history.slice(-49), current] : get().history,
      future: remember ? [] : get().future
    })
    window.unvirtual.previewProject(next)
    scheduleSave(next, set, get)
  },

  updateItemTransform: (id, transform, remember = true) => {
    get().mutateProject((draft) => {
      if (id === DISPLAY_CASE_SELECTION_ID) {
        draft.displayTransform = transform
        return
      }
      const item = draft.items.find((candidate) => candidate.id === id)
      if (item) item.transform = transform
    }, remember)
  },

  importAssets: async (files) => {
    const project = get().project
    if (!project) return
    const assets = files
      ? await window.unvirtual.importDroppedAssets(
        project.id,
        files.map((file) => window.unvirtual.getPathForFile(file)).filter(Boolean)
      )
      : await window.unvirtual.importAssets(project.id)
    if (assets.length === 0) return
    get().mutateProject((draft) => {
      const start = draft.items.length
      draft.items.push(...assets.map((asset, index) => newItem(asset, start + index)))
    })
  },

  createProject: async () => {
    await flushPendingSave(set, get)
    applyEvent(set, get, await window.unvirtual.createProject())
  },
  duplicateProject: async () => {
    await flushPendingSave(set, get)
    const project = get().project
    if (project) applyEvent(set, get, await window.unvirtual.duplicateProject(project.id))
  },
  deleteProject: async () => {
    await flushPendingSave(set, get)
    const project = get().project
    if (project) applyEvent(set, get, await window.unvirtual.deleteProject(project.id))
  },
  activateProject: async (id) => {
    await flushPendingSave(set, get)
    set({ selectedItemId: null, history: [], future: [] })
    applyEvent(set, get, await window.unvirtual.activateProject(id))
  },
  clearProject: async () => {
    await flushPendingSave(set, get)
    const project = get().project
    if (!project) return
    set({ selectedItemId: null, history: [], future: [] })
    applyEvent(set, get, await window.unvirtual.resetProject(project.id, 'items' satisfies ProjectResetScope))
  },
  resetProject: async () => {
    await flushPendingSave(set, get)
    const project = get().project
    if (!project) return
    set({ selectedItemId: null, history: [], future: [] })
    applyEvent(set, get, await window.unvirtual.resetProject(project.id, 'all' satisfies ProjectResetScope))
  },
  backupProject: async () => {
    await flushPendingSave(set, get)
    const project = get().project
    if (project) await window.unvirtual.exportProject(project.id)
  },
  restoreProject: async () => {
    await flushPendingSave(set, get)
    const event = await window.unvirtual.importProjectArchive()
    if (event) applyEvent(set, get, event)
  },
  updateSettings: async (patch) => {
    const settings = await window.unvirtual.updateSettings(patch)
    await setLanguage(settings.language)
    set({ settings })
  },
  undo: () => {
    const history = get().history
    const current = get().project
    if (!current || history.length === 0) return
    const previous = history.at(-1)!
    const next = makeNextRevision(previous, current)
    set({ history: history.slice(0, -1), future: [current, ...get().future], project: next, saveStatus: 'saving' })
    window.unvirtual.previewProject(next)
    scheduleSave(next, set, get)
  },
  redo: () => {
    const future = get().future
    const current = get().project
    if (!current || future.length === 0) return
    const next = makeNextRevision(future[0], current)
    set({ history: [...get().history, current], future: future.slice(1), project: next, saveStatus: 'saving' })
    window.unvirtual.previewProject(next)
    scheduleSave(next, set, get)
  }
}))
