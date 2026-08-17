import { randomUUID } from 'node:crypto'
import { copyFile, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, sep } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { planAssetImports } from './asset-import'
import type {
  AppSettings,
  DisplayProject,
  ImportedAsset,
  Language,
  ProjectChanges,
  ProjectEvent,
  ProjectPatchEvent,
  ProjectResetScope,
  ProjectSummary
} from '../shared/types'
import {
  createDefaultCameraSettings,
  createDefaultDisplayTransform,
  createDefaultLightingSettings,
  normalizeCasePreset,
  PROJECT_CHANGE_KEYS
} from '../shared/types'

interface StoreIndex {
  activeProjectId: string
  projectOrder: string[]
  settings: AppSettings
}

function now(): string {
  return new Date().toISOString()
}

function defaultLanguage(locale: string): Language {
  if (locale.toLowerCase().startsWith('ko')) return 'ko'
  if (locale.toLowerCase().startsWith('ja')) return 'ja'
  if (locale.toLowerCase().startsWith('zh')) return 'zh-Hans'
  return 'en'
}

function createProject(name = 'My display'): DisplayProject {
  const timestamp = now()
  return {
    schemaVersion: 1,
    revision: 0,
    id: randomUUID(),
    name,
    casePreset: 'modern3',
    caseVisible: true,
    displayTransform: createDefaultDisplayTransform(),
    items: [],
    camera: createDefaultCameraSettings(),
    lighting: createDefaultLightingSettings(),
    background: {
      mode: 'transparent',
      color: '#11100f',
      fit: 'cover'
    },
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function normalizeProject(project: DisplayProject): DisplayProject {
  const seenItemIds = new Set<string>()
  const background = project.background ?? { mode: 'transparent', color: '#11100f', fit: 'cover' }
  const displayTransform = project.displayTransform ?? createDefaultDisplayTransform()
  const defaultLighting = createDefaultLightingSettings()
  const lighting = project.lighting ?? defaultLighting
  const normalizedAzimuth = Number.isFinite(lighting.azimuth)
    ? ((Math.round(lighting.azimuth) % 360) + 360) % 360
    : defaultLighting.azimuth
  return {
    ...project,
    schemaVersion: 1,
    revision: Number.isSafeInteger(project.revision) && project.revision >= 0 ? project.revision : 0,
    casePreset: normalizeCasePreset(project.casePreset),
    caseVisible: project.caseVisible !== false,
    displayTransform,
    lighting: {
      intensity: Number.isFinite(lighting.intensity) ? Math.min(2, Math.max(0.25, lighting.intensity)) : defaultLighting.intensity,
      warmth: Number.isFinite(lighting.warmth) ? Math.min(1, Math.max(0, lighting.warmth)) : defaultLighting.warmth,
      shadows: lighting.shadows !== false,
      azimuth: normalizedAzimuth,
      elevation: Number.isFinite(lighting.elevation) ? Math.min(90, Math.max(0, Math.round(lighting.elevation))) : defaultLighting.elevation
    },
    background: {
      mode: ['transparent', 'solid', 'image'].includes(background.mode) ? background.mode : 'transparent',
      color: /^#[0-9a-f]{6}$/i.test(background.color) ? background.color : '#11100f',
      fit: background.fit === 'contain' ? 'contain' : 'cover',
      imageUrl: typeof background.imageUrl === 'string' ? background.imageUrl : undefined,
      relativePath: typeof background.relativePath === 'string' ? background.relativePath : undefined
    },
    items: Array.isArray(project.items)
      ? project.items.filter((item) => {
        if (!item || typeof item.id !== 'string' || seenItemIds.has(item.id)) return false
        seenItemIds.add(item.id)
        return true
      })
      : []
  }
}

function sanitizedProjectChanges(changes: ProjectChanges): ProjectChanges {
  const sanitized: ProjectChanges = {}
  for (const key of PROJECT_CHANGE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(changes, key)) {
      Object.assign(sanitized, { [key]: structuredClone(changes[key]) })
    }
  }
  return sanitized
}

function summarize(project: DisplayProject): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    itemCount: project.items.length,
    updatedAt: project.updatedAt
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, path)
}

export class ProjectStore {
  private readonly root: string
  private readonly projectsRoot: string
  private readonly indexPath: string
  private readonly projectQueues = new Map<string, Promise<void>>()
  private readonly pendingAssetGroups = new Map<string, Set<string>>()
  private indexQueue: Promise<void> = Promise.resolve()
  private index: StoreIndex

  constructor(userDataPath: string, locale: string) {
    this.root = userDataPath
    this.projectsRoot = join(this.root, 'projects')
    this.indexPath = join(this.root, 'state.json')
    this.index = {
      activeProjectId: '',
      projectOrder: [],
      settings: {
        language: defaultLanguage(locale),
        onboardingComplete: false,
        alwaysOnTop: true,
        clickThrough: false,
        quality: 'balanced',
        displayVisible: true
      }
    }
  }

  async initialize(): Promise<void> {
    await mkdir(this.projectsRoot, { recursive: true })

    if (await pathExists(this.indexPath)) {
      try {
        const stored = JSON.parse(await readFile(this.indexPath, 'utf8')) as StoreIndex
        this.index = {
          activeProjectId: stored.activeProjectId,
          projectOrder: Array.isArray(stored.projectOrder)
            ? stored.projectOrder.filter((projectId): projectId is string => typeof projectId === 'string')
            : [],
          settings: { ...this.index.settings, ...stored.settings }
        }
      } catch {
        // A valid project is recovered below and replaces a damaged index.
      }
    }

    const projects = await this.listProjects()
    const activeStillExists = projects.some((project) => project.id === this.index.activeProjectId)
    if (!activeStillExists) {
      const project = projects[0] ? await this.loadProject(projects[0].id) : await this.createProject()
      this.index.activeProjectId = project.id
    }

    this.index.projectOrder = (await this.listProjects()).map((project) => project.id)
    for (const project of await this.listProjects()) {
      await this.pruneOrphanAssets(await this.loadProject(project.id))
    }
    await this.saveIndex()
  }

  get settings(): AppSettings {
    return structuredClone(this.index.settings)
  }

  get activeProjectId(): string {
    return this.index.activeProjectId
  }

  async getActiveProject(): Promise<DisplayProject> {
    return this.loadProject(this.index.activeProjectId)
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const entries = await readdir(this.projectsRoot, { withFileTypes: true })
    const projects: ProjectSummary[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        projects.push(summarize(await this.loadProject(entry.name)))
      } catch {
        // Ignore incomplete project folders so one damaged file cannot block startup.
      }
    }

    const order = new Map(this.index.projectOrder.map((projectId, index) => [projectId, index]))
    return projects.sort((a, b) => {
      const aIndex = order.get(a.id)
      const bIndex = order.get(b.id)
      if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex
      if (aIndex !== undefined) return -1
      if (bIndex !== undefined) return 1
      return b.updatedAt.localeCompare(a.updatedAt)
    })
  }

  async loadProject(projectId: string): Promise<DisplayProject> {
    this.assertProjectId(projectId)
    return normalizeProject(JSON.parse(await readFile(this.projectFile(projectId), 'utf8')) as DisplayProject)
  }

  async createProject(name?: string): Promise<DisplayProject> {
    const project = createProject(name?.trim() || 'My display')
    await mkdir(this.assetFolder(project.id), { recursive: true })
    await this.writeProject(project)
    this.index.activeProjectId = project.id
    this.index.projectOrder = [project.id, ...this.index.projectOrder.filter((projectId) => projectId !== project.id)]
    await this.saveIndex()
    return project
  }

  async saveProject(project: DisplayProject): Promise<ProjectEvent> {
    this.assertProjectId(project.id)
    return this.serializeProject(project.id, async () => {
      const incoming = normalizeProject(structuredClone(project))
      const current = await this.loadProject(project.id)
      if (incoming.revision < current.revision) return this.event(current)

      const saved: DisplayProject = {
        ...incoming,
        updatedAt: now()
      }
      await this.writeProject(saved)
      this.markReferencedAssetGroups(saved)
      await this.pruneOrphanAssets(saved)
      return this.event(saved)
    })
  }

  async updateProject(projectId: string, changes: ProjectChanges): Promise<ProjectPatchEvent> {
    this.assertProjectId(projectId)
    return this.serializeProject(projectId, async () => {
      const safeChanges = sanitizedProjectChanges(changes)
      const current = await this.loadProject(projectId)
      if (Object.keys(safeChanges).length === 0) {
        return { ...await this.event(current), changes: safeChanges }
      }

      const updated = normalizeProject({
        ...current,
        ...safeChanges,
        id: current.id,
        schemaVersion: current.schemaVersion,
        revision: current.revision + 1,
        createdAt: current.createdAt,
        updatedAt: now()
      })
      await this.writeProject(updated)
      this.markReferencedAssetGroups(updated)
      await this.pruneOrphanAssets(updated)
      return { ...await this.event(updated), changes: safeChanges }
    })
  }

  async resetProject(projectId: string, scope: ProjectResetScope): Promise<ProjectEvent> {
    this.assertProjectId(projectId)
    return this.serializeProject(projectId, async () => {
      const current = await this.loadProject(projectId)
      const reset = createProject(current.name)
      const updated: DisplayProject = scope === 'items'
        ? {
          ...current,
          revision: current.revision + 1,
          items: [],
          updatedAt: now()
        }
        : {
          ...reset,
          id: current.id,
          name: current.name,
          revision: current.revision + 1,
          createdAt: current.createdAt,
          updatedAt: now()
        }

      if (scope !== 'items') {
        this.pendingAssetGroups.delete(projectId)
        await rm(this.assetFolder(projectId), { recursive: true, force: true })
        await mkdir(this.assetFolder(projectId), { recursive: true })
      }
      await this.writeProject(updated)
      await this.pruneOrphanAssets(updated)
      return this.event(updated)
    })
  }

  async resetData(): Promise<ProjectEvent> {
    await Promise.all([...this.projectQueues.values()])
    this.projectQueues.clear()
    this.pendingAssetGroups.clear()
    await rm(this.projectsRoot, { recursive: true, force: true })
    await mkdir(this.projectsRoot, { recursive: true })
    this.index.projectOrder = []
    const project = await this.createProject()
    return this.event(project)
  }

  async activateProject(projectId: string): Promise<ProjectEvent> {
    const project = await this.loadProject(projectId)
    this.index.activeProjectId = projectId
    await this.saveIndex()
    return this.event(project)
  }

  async duplicateProject(projectId: string): Promise<ProjectEvent> {
    const source = await this.loadProject(projectId)
    await this.pruneOrphanAssets(source)
    const copy = structuredClone(source)
    copy.id = randomUUID()
    copy.name = `${source.name} copy`
    copy.revision = 0
    copy.createdAt = now()
    copy.updatedAt = copy.createdAt
    copy.items = copy.items.map((item) => ({
      ...item,
      id: randomUUID(),
      relativePath: item.relativePath,
      assetUrl: item.relativePath ? this.assetUrl(copy.id, item.relativePath) : ''
    }))
    if (copy.background.relativePath) {
      copy.background.imageUrl = this.assetUrl(copy.id, copy.background.relativePath)
    }

    await mkdir(this.projectFolder(copy.id), { recursive: true })
    if (await pathExists(this.assetFolder(source.id))) {
      await cp(this.assetFolder(source.id), this.assetFolder(copy.id), { recursive: true })
    } else {
      await mkdir(this.assetFolder(copy.id), { recursive: true })
    }
    await this.writeProject(copy)
    this.index.activeProjectId = copy.id
    const sourceIndex = this.index.projectOrder.indexOf(source.id)
    const insertAt = sourceIndex < 0 ? 0 : sourceIndex + 1
    this.index.projectOrder.splice(insertAt, 0, copy.id)
    await this.saveIndex()
    return this.event(copy)
  }

  async deleteProject(projectId: string): Promise<ProjectEvent> {
    this.assertProjectId(projectId)
    const projects = await this.listProjects()
    if (projects.length <= 1) throw new Error('At least one project must remain.')

    await rm(this.projectFolder(projectId), { recursive: true, force: true })
    this.index.projectOrder = this.index.projectOrder.filter((candidate) => candidate !== projectId)

    const remaining = (await this.listProjects())[0]
    if (!remaining) throw new Error('No project remained after deletion.')
    if (this.index.activeProjectId === projectId) this.index.activeProjectId = remaining.id
    await this.saveIndex()
    return this.event(await this.getActiveProject())
  }

  async reorderProjects(projectIds: string[]): Promise<ProjectEvent> {
    const projects = await this.listProjects()
    const existingIds = new Set(projects.map((project) => project.id))
    const seen = new Set<string>()
    const orderedIds = projectIds.filter((projectId) => {
      if (!existingIds.has(projectId) || seen.has(projectId)) return false
      seen.add(projectId)
      return true
    })
    orderedIds.push(...projects.map((project) => project.id).filter((projectId) => !seen.has(projectId)))
    this.index.projectOrder = orderedIds
    await this.saveIndex()
    return this.event(await this.getActiveProject())
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.index.settings = { ...this.index.settings, ...patch }
    await this.saveIndex()
    return this.settings
  }

  async importFiles(projectId: string, paths: string[]): Promise<ImportedAsset[]> {
    this.assertProjectId(projectId)
    await this.loadProject(projectId)
    const plans = await planAssetImports(paths)
    const assets: ImportedAsset[] = []

    for (const plan of plans) {
      const groupId = randomUUID()
      const pending = this.pendingAssetGroups.get(projectId) ?? new Set<string>()
      pending.add(groupId)
      this.pendingAssetGroups.set(projectId, pending)
      try {
        for (const file of plan.files) {
          const destination = this.resolveAssetPath(projectId, `${groupId}/${file.relativePath}`)
          await mkdir(dirname(destination), { recursive: true })
          await copyFile(file.sourcePath, destination)
        }
      } catch (error) {
        pending.delete(groupId)
        await rm(this.resolveAssetPath(projectId, groupId), { recursive: true, force: true })
        throw error
      }

      const relativePath = `${groupId}/${plan.entryRelativePath}`
      assets.push({
        name: basename(plan.sourcePath, extname(plan.sourcePath)),
        extension: plan.extension,
        kind: plan.kind,
        relativePath,
        assetUrl: this.assetUrl(projectId, relativePath)
      })
    }
    return assets
  }

  async exportProjectArchive(projectId: string): Promise<Uint8Array> {
    const project = await this.loadProject(projectId)
    await this.pruneOrphanAssets(project)
    const entries: Record<string, Uint8Array> = {
      'project.json': strToU8(JSON.stringify(project, null, 2))
    }
    await this.collectArchiveFiles(this.assetFolder(projectId), 'assets', entries)
    return zipSync(entries, { level: 6 })
  }

  async importProjectArchive(data: Uint8Array): Promise<ProjectEvent> {
    const entries = unzipSync(data)
    const projectBytes = entries['project.json']
    if (!projectBytes) throw new Error('The archive does not contain project.json.')
    const source = JSON.parse(strFromU8(projectBytes)) as DisplayProject
    if (source.schemaVersion !== 1 || !Array.isArray(source.items) || typeof source.name !== 'string') {
      throw new Error('Unsupported project archive.')
    }

    const imported = structuredClone(source)
    imported.id = randomUUID()
    imported.name = `${source.name} imported`
    imported.revision = 0
    imported.createdAt = now()
    imported.updatedAt = imported.createdAt
    imported.items = source.items.map((item) => ({
      ...item,
      id: randomUUID(),
      assetUrl: item.relativePath ? this.assetUrl(imported.id, item.relativePath) : ''
    }))
    imported.background = normalizeProject(imported).background
    if (imported.background.relativePath) {
      imported.background.imageUrl = this.assetUrl(imported.id, imported.background.relativePath)
    }

    await mkdir(this.assetFolder(imported.id), { recursive: true })
    for (const [entryName, bytes] of Object.entries(entries)) {
      if (!entryName.startsWith('assets/') || entryName.endsWith('/')) continue
      const relativePath = entryName.slice('assets/'.length)
      const destination = this.resolveAssetPath(imported.id, relativePath)
      await mkdir(join(destination, '..'), { recursive: true })
      await writeFile(destination, bytes)
    }

    await this.writeProject(imported)
    await this.pruneOrphanAssets(imported)
    this.index.activeProjectId = imported.id
    this.index.projectOrder = [imported.id, ...this.index.projectOrder.filter((projectId) => projectId !== imported.id)]
    await this.saveIndex()
    return this.event(imported)
  }

  resolveAssetPath(projectId: string, relativePath: string): string {
    this.assertProjectId(projectId)
    const assetRoot = this.assetFolder(projectId)
    const resolved = join(assetRoot, relativePath)
    const traversal = relative(assetRoot, resolved)
    if (traversal.startsWith(`..${sep}`) || traversal === '..') throw new Error('Invalid asset path.')
    return resolved
  }

  private assetUrl(projectId: string, relativePath: string): string {
    const encoded = relativePath.split('/').map(encodeURIComponent).join('/')
    return `uvd://asset/${encodeURIComponent(projectId)}/${encoded}`
  }

  private async event(project: DisplayProject): Promise<ProjectEvent> {
    return { project, projects: await this.listProjects(), activeProjectId: this.index.activeProjectId }
  }

  private async serializeProject<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.projectQueues.get(projectId) ?? Promise.resolve()
    const current = previous.then(operation, operation)
    const tail = current.then(() => undefined, () => undefined)
    this.projectQueues.set(projectId, tail)
    try {
      return await current
    } finally {
      if (this.projectQueues.get(projectId) === tail) this.projectQueues.delete(projectId)
    }
  }

  private async writeProject(project: DisplayProject): Promise<void> {
    await mkdir(this.projectFolder(project.id), { recursive: true })
    await writeJsonAtomic(this.projectFile(project.id), project)
  }

  private async collectArchiveFiles(folder: string, prefix: string, entries: Record<string, Uint8Array>): Promise<void> {
    if (!(await pathExists(folder))) return
    const children = await readdir(folder, { withFileTypes: true })
    for (const child of children) {
      const path = join(folder, child.name)
      const archivePath = `${prefix}/${child.name}`
      if (child.isDirectory()) await this.collectArchiveFiles(path, archivePath, entries)
      else if (child.isFile()) entries[archivePath] = new Uint8Array(await readFile(path))
    }
  }

  private referencedAssetGroups(project: DisplayProject): Set<string> {
    const paths = [
      ...project.items.map((item) => item.relativePath),
      project.background.relativePath ?? ''
    ]
    return new Set(paths.map((path) => path.split('/')[0]).filter(Boolean))
  }

  private markReferencedAssetGroups(project: DisplayProject): void {
    const pending = this.pendingAssetGroups.get(project.id)
    if (!pending) return
    for (const group of this.referencedAssetGroups(project)) pending.delete(group)
    if (pending.size === 0) this.pendingAssetGroups.delete(project.id)
  }

  private async pruneOrphanAssets(project: DisplayProject): Promise<void> {
    const folder = this.assetFolder(project.id)
    if (!(await pathExists(folder))) return
    const keep = this.referencedAssetGroups(project)
    for (const pending of this.pendingAssetGroups.get(project.id) ?? []) keep.add(pending)
    const children = await readdir(folder, { withFileTypes: true })
    await Promise.all(children
      .filter((child) => child.isDirectory() && !keep.has(child.name))
      .map((child) => rm(join(folder, child.name), { recursive: true, force: true })))
  }

  private async saveIndex(): Promise<void> {
    const operation = this.indexQueue.catch(() => undefined).then(async () => {
      await mkdir(this.root, { recursive: true })
      await writeJsonAtomic(this.indexPath, this.index)
    })
    this.indexQueue = operation
    await operation
  }

  private projectFolder(projectId: string): string {
    return join(this.projectsRoot, projectId)
  }

  private projectFile(projectId: string): string {
    return join(this.projectFolder(projectId), 'project.json')
  }

  private assetFolder(projectId: string): string {
    return join(this.projectFolder(projectId), 'assets')
  }

  private assertProjectId(projectId: string): void {
    if (!/^[a-f0-9-]{36}$/i.test(projectId)) throw new Error('Invalid project id.')
  }
}
