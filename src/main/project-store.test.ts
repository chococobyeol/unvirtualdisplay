import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectStore } from './project-store'

const temporaryRoots: string[] = []

async function createStore(): Promise<ProjectStore> {
  const root = await mkdtemp(join(tmpdir(), 'unvirtual-display-test-'))
  temporaryRoots.push(root)
  const store = new ProjectStore(root, 'ko-KR')
  await store.initialize()
  return store
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('ProjectStore', () => {
  it('creates a recoverable default project and local settings', async () => {
    const store = await createStore()
    const project = await store.getActiveProject()

    expect(project.schemaVersion).toBe(1)
    expect(project.items).toEqual([])
    expect(project.caseVisible).toBe(true)
    expect(project.displayTransform.position).toEqual({ x: 0, y: -0.65, z: 0 })
    expect(project.background).toEqual({ mode: 'transparent', color: '#11100f', fit: 'cover' })
    expect(project.lighting.azimuth).toBe(30)
    expect(project.lighting.elevation).toBe(45)
    expect(store.settings.language).toBe('ko')
    expect(store.settings.onboardingComplete).toBe(false)
    expect(store.settings.alwaysOnTop).toBe(true)
    expect(store.settings.clickThrough).toBe(false)
    expect(store.settings.displayVisible).toBe(true)
    expect((await store.listProjects()).map((entry) => entry.id)).toContain(project.id)
  })

  it('adds light direction defaults to older projects', async () => {
    const store = await createStore()
    const project = await store.getActiveProject()
    delete (project.lighting as Partial<typeof project.lighting>).azimuth
    delete (project.lighting as Partial<typeof project.lighting>).elevation
    project.revision += 1

    const saved = await store.saveProject(project)

    expect(saved.project.lighting.azimuth).toBe(30)
    expect(saved.project.lighting.elevation).toBe(45)
  })

  it('normalizes light direction to intuitive degree ranges', async () => {
    const store = await createStore()
    const project = await store.getActiveProject()
    project.lighting.azimuth = -10
    project.lighting.elevation = 120
    project.revision += 1

    const saved = await store.saveProject(project)

    expect(saved.project.lighting.azimuth).toBe(350)
    expect(saved.project.lighting.elevation).toBe(90)
  })

  it('saves, duplicates, activates and deletes projects', async () => {
    const store = await createStore()
    const original = await store.getActiveProject()
    original.name = 'Shelf A'
    await store.saveProject(original)

    const duplicateEvent = await store.duplicateProject(original.id)
    expect(duplicateEvent.project.name).toBe('Shelf A copy')
    expect(duplicateEvent.projects).toHaveLength(2)

    const activated = await store.activateProject(original.id)
    expect(activated.project.name).toBe('Shelf A')

    const deleted = await store.deleteProject(duplicateEvent.project.id)
    expect(deleted.projects).toHaveLength(1)
    expect(deleted.project.id).toBe(original.id)
  })

  it('duplicates and archives built-in objects without creating fake asset paths', async () => {
    const store = await createStore()
    const project = await store.getActiveProject()
    project.items.push({
      id: crypto.randomUUID(),
      name: 'Acrylic steps',
      kind: 'builtin',
      format: 'object',
      assetUrl: '',
      relativePath: '',
      builtin: { type: 'acrylicSteps', steps: 4 },
      transform: {
        position: { x: 1, y: 0, z: -1 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 }
      },
      physics: { collision: true, preventToppling: true, placementLocked: false },
      animation: { enabled: false, clipIndex: 0, loop: true, speed: 1 }
    })
    project.revision += 1
    await store.saveProject(project)

    const duplicate = await store.duplicateProject(project.id)
    expect(duplicate.project.items[0]).toMatchObject({
      kind: 'builtin',
      assetUrl: '',
      relativePath: '',
      builtin: { type: 'acrylicSteps', steps: 4 }
    })

    const archive = await store.exportProjectArchive(project.id)
    const restored = await store.importProjectArchive(archive)
    expect(restored.project.items[0]).toMatchObject({
      kind: 'builtin',
      assetUrl: '',
      relativePath: '',
      builtin: { type: 'acrylicSteps', steps: 4 }
    })
  })

  it('persists a custom display order across restarts', async () => {
    const store = await createStore()
    const first = await store.getActiveProject()
    const second = await store.createProject('Second')
    const third = await store.createProject('Third')

    const reordered = await store.reorderProjects([first.id, third.id, second.id])
    expect(reordered.projects.map((project) => project.id)).toEqual([first.id, third.id, second.id])

    const reopened = new ProjectStore(temporaryRoots[0], 'ko-KR')
    await reopened.initialize()
    expect((await reopened.listProjects()).map((project) => project.id)).toEqual([first.id, third.id, second.id])
  })

  it('reopens built-in structures with their exact saved transforms and physics settings', async () => {
    const store = await createStore()
    const project = await store.getActiveProject()
    const acrylicCaseId = crypto.randomUUID()
    const acrylicStepsId = crypto.randomUUID()
    project.items.push(
      {
        id: acrylicCaseId,
        name: 'Acrylic case',
        kind: 'builtin',
        format: 'object',
        assetUrl: '',
        relativePath: '',
        visible: true,
        selectionPassThrough: true,
        builtin: { type: 'acrylicCase', acrylicCaseVariant: 'low' },
        transform: {
          position: { x: -0.7, y: 0.42, z: 0.35 },
          rotation: { x: 0.02, y: -0.4, z: 0.01 },
          scale: { x: 1.4, y: 1.6, z: 0.9 }
        },
        physics: { collision: true, preventToppling: false, placementLocked: false },
        animation: { enabled: false, clipIndex: 0, loop: true, speed: 1 }
      },
      {
        id: acrylicStepsId,
        name: 'Acrylic steps',
        kind: 'builtin',
        format: 'object',
        assetUrl: '',
        relativePath: '',
        visible: true,
        selectionPassThrough: false,
        builtin: { type: 'acrylicSteps', steps: 3 },
        transform: {
          position: { x: 0.25, y: 0.18, z: -0.2 },
          rotation: { x: 0, y: 0.3, z: 0 },
          scale: { x: 1.6, y: 1.1, z: 1.2 }
        },
        physics: { collision: true, preventToppling: true, placementLocked: false },
        animation: { enabled: false, clipIndex: 0, loop: true, speed: 1 }
      }
    )
    project.revision += 1
    await store.saveProject(project)

    const reopened = new ProjectStore(temporaryRoots[0], 'ko-KR')
    await reopened.initialize()
    const restored = await reopened.getActiveProject()

    expect(restored.items.find((item) => item.id === acrylicCaseId)).toEqual(project.items[0])
    expect(restored.items.find((item) => item.id === acrylicStepsId)).toEqual(project.items[1])
  })

  it('keeps the newest revision when save requests arrive out of order', async () => {
    const store = await createStore()
    const original = await store.getActiveProject()
    const older = structuredClone(original)
    older.revision = 1
    older.name = 'Older edit'
    const newer = structuredClone(original)
    newer.revision = 2
    newer.name = 'Newest edit'

    await Promise.all([store.saveProject(newer), store.saveProject(older)])

    const saved = await store.getActiveProject()
    expect(saved.revision).toBe(2)
    expect(saved.name).toBe('Newest edit')
  })

  it('merges simultaneous updates to different project fields', async () => {
    const store = await createStore()
    const project = await store.getActiveProject()

    await Promise.all([
      store.updateProject(project.id, { lighting: { ...project.lighting, intensity: 1.75 } }),
      store.updateProject(project.id, { camera: { ...project.camera, position: { ...project.camera.position, x: 9 } } })
    ])

    const saved = await store.getActiveProject()
    expect(saved.lighting.intensity).toBe(1.75)
    expect(saved.camera.position.x).toBe(9)
    expect(saved.revision).toBe(2)
  })

  it('persists widget visibility in app settings', async () => {
    const store = await createStore()
    await store.updateSettings({ displayVisible: false })

    const reopened = new ProjectStore(temporaryRoots[0], 'ko-KR')
    await reopened.initialize()

    expect(reopened.settings.displayVisible).toBe(false)
  })

  it('removes asset groups when their item or background reference is removed', async () => {
    const store = await createStore()
    const project = await store.getActiveProject()
    const modelSource = join(temporaryRoots[0], 'orphan.obj')
    await writeFile(modelSource, 'o Orphan\nv 0 0 0\n', 'utf8')
    const [model] = await store.importFiles(project.id, [modelSource])
    const item = {
      id: crypto.randomUUID(),
      name: model.name,
      kind: 'model' as const,
      format: 'obj',
      assetUrl: model.assetUrl,
      relativePath: model.relativePath,
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 }
      },
      physics: { collision: true, preventToppling: true, placementLocked: false },
      animation: { enabled: false, clipIndex: 0, loop: true, speed: 1 }
    }
    await store.updateProject(project.id, { items: [item] })
    const modelPath = store.resolveAssetPath(project.id, model.relativePath)
    await expect(readFile(modelPath)).resolves.toBeTruthy()

    await store.updateProject(project.id, { items: [] })
    await expect(readFile(modelPath)).rejects.toThrow()

    const backgroundSource = join(temporaryRoots[0], 'orphan-background.png')
    await writeFile(backgroundSource, new Uint8Array([137, 80, 78, 71]))
    const [background] = await store.importFiles(project.id, [backgroundSource])
    const backgroundPath = store.resolveAssetPath(project.id, background.relativePath)
    await store.updateProject(project.id, {
      background: {
        mode: 'image',
        color: '#11100f',
        fit: 'cover',
        imageUrl: background.assetUrl,
        relativePath: background.relativePath
      }
    })
    await store.updateProject(project.id, { background: { mode: 'transparent', color: '#11100f', fit: 'cover' } })
    await expect(readFile(backgroundPath)).rejects.toThrow()
  })

  it('protects a freshly imported asset until its project update arrives', async () => {
    const store = await createStore()
    const project = await store.getActiveProject()
    const imageSource = join(temporaryRoots[0], 'pending.png')
    await writeFile(imageSource, new Uint8Array([137, 80, 78, 71]))
    const [image] = await store.importFiles(project.id, [imageSource])
    const copiedPath = store.resolveAssetPath(project.id, image.relativePath)

    await store.updateProject(project.id, { name: 'Renamed while importing' })

    await expect(readFile(copiedPath)).resolves.toBeTruthy()
  })

  it('keeps a shared asset group when clearing items leaves a background reference', async () => {
    const store = await createStore()
    const project = await store.getActiveProject()
    const modelSource = join(temporaryRoots[0], 'shared.gltf')
    const textureSource = join(temporaryRoots[0], 'shared.png')
    await writeFile(modelSource, JSON.stringify({ asset: { version: '2.0' }, images: [{ uri: 'shared.png' }] }), 'utf8')
    await writeFile(textureSource, new Uint8Array([137, 80, 78, 71]))
    const [model] = await store.importFiles(project.id, [modelSource])
    const group = model.relativePath.split('/')[0]
    const textureRelativePath = `${group}/shared.png`

    await store.updateProject(project.id, {
      items: [{
        id: crypto.randomUUID(),
        name: model.name,
        kind: 'model',
        format: model.extension,
        assetUrl: model.assetUrl,
        relativePath: model.relativePath,
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 }
        },
        physics: { collision: true, preventToppling: true, placementLocked: false },
        animation: { enabled: false, clipIndex: 0, loop: true, speed: 1 }
      }],
      background: {
        mode: 'image',
        color: '#11100f',
        fit: 'cover',
        imageUrl: model.assetUrl.replace(/shared\.gltf$/, 'shared.png'),
        relativePath: textureRelativePath
      }
    })

    const cleared = await store.resetProject(project.id, 'items')

    expect(cleared.project.items).toEqual([])
    expect(cleared.project.background.relativePath).toBe(textureRelativePath)
    await expect(readFile(store.resolveAssetPath(project.id, textureRelativePath))).resolves.toBeTruthy()
  })

  it('removes abandoned import groups when the store is reopened', async () => {
    const store = await createStore()
    const project = await store.getActiveProject()
    const imageSource = join(temporaryRoots[0], 'abandoned.png')
    await writeFile(imageSource, new Uint8Array([137, 80, 78, 71]))
    const [image] = await store.importFiles(project.id, [imageSource])
    const copiedPath = store.resolveAssetPath(project.id, image.relativePath)
    await expect(readFile(copiedPath)).resolves.toBeTruthy()

    const reopened = new ProjectStore(temporaryRoots[0], 'ko-KR')
    await reopened.initialize()

    await expect(readFile(copiedPath)).rejects.toThrow()
  })

  it('clears items and fully resets a display while removing copied assets', async () => {
    const store = await createStore()
    const project = await store.getActiveProject()
    const source = join(temporaryRoots[0], 'reset-figure.obj')
    await writeFile(source, 'o ResetFigure\nv 0 0 0\n', 'utf8')
    const [asset] = await store.importFiles(project.id, [source])
    const backgroundSource = join(temporaryRoots[0], 'reset-background.png')
    await writeFile(backgroundSource, new Uint8Array([137, 80, 78, 71]))
    const [background] = await store.importFiles(project.id, [backgroundSource])
    project.revision = 1
    project.casePreset = 'wood3'
    project.caseVisible = false
    project.background = {
      mode: 'image',
      color: '#11100f',
      fit: 'cover',
      imageUrl: background.assetUrl,
      relativePath: background.relativePath
    }
    project.items.push({
      id: crypto.randomUUID(),
      name: asset.name,
      kind: 'model',
      format: 'obj',
      assetUrl: asset.assetUrl,
      relativePath: asset.relativePath,
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 }
      },
      physics: { collision: true, preventToppling: true, placementLocked: false },
      animation: { enabled: false, clipIndex: 0, loop: true, speed: 1 }
    })
    await store.saveProject(project)
    const copiedPath = store.resolveAssetPath(project.id, asset.relativePath)
    const backgroundPath = store.resolveAssetPath(project.id, background.relativePath)

    const cleared = await store.resetProject(project.id, 'items')
    expect(cleared.project.items).toEqual([])
    expect(cleared.project.casePreset).toBe('wood3')
    expect(cleared.project.caseVisible).toBe(false)
    expect(cleared.project.background.mode).toBe('image')
    await expect(readFile(copiedPath)).rejects.toThrow()
    await expect(readFile(backgroundPath)).resolves.toEqual(Buffer.from([137, 80, 78, 71]))

    cleared.project.revision += 1
    cleared.project.camera.position.x = 99
    cleared.project.lighting.intensity = 2
    await store.saveProject(cleared.project)
    const reset = await store.resetProject(project.id, 'all')
    expect(reset.project.casePreset).toBe('modern3')
    expect(reset.project.caseVisible).toBe(true)
    expect(reset.project.camera.position.x).toBe(4.8)
    expect(reset.project.lighting.intensity).toBe(1)
    expect(reset.project.lighting.azimuth).toBe(30)
    expect(reset.project.lighting.elevation).toBe(45)
    expect(reset.project.background.mode).toBe('transparent')
    await expect(readFile(backgroundPath)).rejects.toThrow()
    expect(reset.project.revision).toBeGreaterThan(cleared.project.revision)
  })

  it('resets all display data to one new empty display while keeping app settings', async () => {
    const store = await createStore()
    const original = await store.getActiveProject()
    const source = join(temporaryRoots[0], 'reset-all-figure.obj')
    await writeFile(source, 'o ResetAllFigure\nv 0 0 0\n', 'utf8')
    const [asset] = await store.importFiles(original.id, [source])
    const copiedPath = store.resolveAssetPath(original.id, asset.relativePath)
    const duplicate = await store.duplicateProject(original.id)
    await store.updateSettings({ quality: 'high', alwaysOnTop: true })

    const reset = await store.resetData()

    expect(reset.projects).toHaveLength(1)
    expect(reset.project.id).not.toBe(original.id)
    expect(reset.project.items).toEqual([])
    expect(reset.project.casePreset).toBe('modern3')
    expect(reset.activeProjectId).toBe(reset.project.id)
    expect(store.settings.quality).toBe('high')
    expect(store.settings.alwaysOnTop).toBe(true)
    await expect(readFile(copiedPath)).rejects.toThrow()
    await expect(store.loadProject(original.id)).rejects.toThrow()
    await expect(store.loadProject(duplicate.project.id)).rejects.toThrow()
  })

  it('copies imported assets into the active project', async () => {
    const store = await createStore()
    const project = await store.getActiveProject()
    const source = join(temporaryRoots[0], 'figure.obj')
    await writeFile(source, 'o Figure\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n', 'utf8')

    const [asset] = await store.importFiles(project.id, [source])
    expect(asset.kind).toBe('model')
    expect(asset.assetUrl).toMatch(/^uvd:\/\/asset\//)

    const copiedPath = store.resolveAssetPath(project.id, asset.relativePath)
    expect(await readFile(copiedPath, 'utf8')).toContain('o Figure')
  })

  it('rejects paths that escape a project asset folder', async () => {
    const store = await createStore()
    const project = await store.getActiveProject()
    expect(() => store.resolveAssetPath(project.id, '../project.json')).toThrow('Invalid asset path')
  })

  it('round-trips a project and its assets through a .uvd archive', async () => {
    const store = await createStore()
    const project = await store.getActiveProject()
    const source = join(temporaryRoots[0], 'archive-figure.obj')
    await writeFile(source, 'o Archived\nv 0 0 0\n', 'utf8')
    const [asset] = await store.importFiles(project.id, [source])
    project.items.push({
      id: crypto.randomUUID(),
      name: asset.name,
      kind: 'model',
      format: 'obj',
      assetUrl: asset.assetUrl,
      relativePath: asset.relativePath,
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 }
      },
      physics: { collision: true, preventToppling: true, placementLocked: false },
      animation: { enabled: false, clipIndex: 0, loop: true, speed: 1 }
    })
    await store.saveProject(project)

    const archive = await store.exportProjectArchive(project.id)
    const restored = await store.importProjectArchive(archive)

    expect(restored.project.id).not.toBe(project.id)
    expect(restored.project.items).toHaveLength(1)
    expect(restored.project.items[0].assetUrl).toContain(restored.project.id)
    expect(await readFile(store.resolveAssetPath(restored.project.id, asset.relativePath), 'utf8')).toContain('Archived')
  })

  it('round-trips an image whose extracted Windows path exceeds MAX_PATH', async () => {
    const store = await createStore()
    const project = await store.getActiveProject()
    const source = join(temporaryRoots[0], `${'pokemon-image-'.repeat(12)}.webp`)
    const bytes = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x04, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
    await writeFile(source, bytes)
    const [asset] = await store.importFiles(project.id, [source])
    project.items.push({
      id: crypto.randomUUID(),
      name: asset.name,
      kind: 'image',
      format: 'webp',
      assetUrl: asset.assetUrl,
      relativePath: asset.relativePath,
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 }
      },
      physics: { collision: true, preventToppling: true, placementLocked: false },
      animation: { enabled: false, clipIndex: 0, loop: true, speed: 1 }
    })
    await store.saveProject(project)

    const restored = await store.importProjectArchive(await store.exportProjectArchive(project.id))
    const restoredItem = restored.project.items[0]
    const representativeWindowsRoot = String.raw`C:\Users\tester\AppData\Roaming\Unvirtual Display\projects\${restored.project.id}\assets`

    expect(join(representativeWindowsRoot, restoredItem.relativePath).length).toBeGreaterThan(260)
    expect(new Uint8Array(await readFile(store.resolveAssetPath(restored.project.id, restoredItem.relativePath)))).toEqual(bytes)
  })
})
