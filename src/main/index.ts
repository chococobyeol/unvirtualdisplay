import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  protocol,
  shell,
  Tray
} from 'electron'
import type { AppSettings, BootstrapData, CameraPreviewEvent, DisplayProject, DisplayResizeEdge, ProjectEvent, ProjectResetScope } from '../shared/types'
import { ProjectStore } from './project-store'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'uvd',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
])

let editorWindow: BrowserWindow | null = null
let displayWindow: BrowserWindow | null = null
let tray: Tray | null = null
let store: ProjectStore
let isQuitting = false
let boundsSaveTimer: ReturnType<typeof setTimeout> | null = null
let displayEditing = false
let displayResize: {
  edge: DisplayResizeEdge
  start: { x: number; y: number }
  bounds: Electron.Rectangle
} | null = null
let displayMove: {
  start: { x: number; y: number }
  bounds: Electron.Rectangle
} | null = null
let quitSaveInProgress = false
let quitSaveComplete = false
const latestProjectPreviews = new Map<string, DisplayProject>()
const diagnosticLines: string[] = []
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) app.quit()

function addDiagnostic(message: string): void {
  diagnosticLines.push(`${new Date().toISOString()} ${message}`)
  if (diagnosticLines.length > 500) diagnosticLines.splice(0, diagnosticLines.length - 500)
}

function rendererUrl(role: 'editor' | 'display'): string | null {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!devUrl) return null
  const url = new URL(devUrl)
  url.searchParams.set('role', role)
  return url.toString()
}

async function loadRenderer(window: BrowserWindow, role: 'editor' | 'display'): Promise<void> {
  const url = rendererUrl(role)
  if (url) {
    await window.loadURL(url)
  } else {
    await window.loadFile(join(__dirname, '../renderer/index.html'), { query: { role } })
  }
}

function commonWebPreferences(): Electron.WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.cjs'),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webviewTag: false,
    backgroundThrottling: false
  }
}

function attachDiagnostics(window: BrowserWindow, role: 'editor' | 'display'): void {
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    addDiagnostic(`[${role}] preload failed: ${preloadPath} ${error.message}`)
    console.error(`[${role}] preload failed: ${preloadPath}`, error)
  })
  window.webContents.on('console-message', (event) => {
    if (event.level === 'warning' || event.level === 'error') {
      addDiagnostic(`[${role}] ${event.level}: ${event.message}`)
      console.error(`[${role}] ${event.message} (${event.sourceId}:${event.lineNumber})`)
    }
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    addDiagnostic(`[${role}] renderer stopped: ${details.reason} (${details.exitCode})`)
    console.error(`[${role}] renderer stopped`, details)
  })
}

async function createEditorWindow(): Promise<BrowserWindow> {
  if (editorWindow && !editorWindow.isDestroyed()) {
    editorWindow.show()
    editorWindow.focus()
    return editorWindow
  }

  editorWindow = new BrowserWindow({
    title: 'Unvirtual Display — Editor',
    width: 1380,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#11100f',
    show: false,
    webPreferences: commonWebPreferences()
  })

  editorWindow.once('ready-to-show', () => editorWindow?.show())
  attachDiagnostics(editorWindow, 'editor')
  editorWindow.on('close', (event) => {
    if (!isQuitting && displayWindow && !displayWindow.isDestroyed()) {
      event.preventDefault()
      editorWindow?.hide()
    }
  })
  editorWindow.on('closed', () => { editorWindow = null })
  editorWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  await loadRenderer(editorWindow, 'editor')
  return editorWindow
}

async function createDisplayWindow(): Promise<BrowserWindow> {
  const settings = store.settings
  const bounds = settings.displayBounds ?? { width: 760, height: 560 }
  displayWindow = new BrowserWindow({
    title: 'Unvirtual Display',
    ...bounds,
    minWidth: 320,
    minHeight: 240,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    alwaysOnTop: settings.alwaysOnTop,
    skipTaskbar: false,
    show: false,
    webPreferences: commonWebPreferences()
  })

  displayWindow.setIgnoreMouseEvents(settings.clickThrough, { forward: true })
  attachDiagnostics(displayWindow, 'display')
  displayWindow.once('ready-to-show', () => displayWindow?.showInactive())
  displayWindow.on('move', queueDisplayBoundsSave)
  displayWindow.on('resize', queueDisplayBoundsSave)
  displayWindow.on('closed', () => {
    displayWindow = null
    if (!isQuitting) app.quit()
  })
  await loadRenderer(displayWindow, 'display')
  return displayWindow
}

function queueDisplayBoundsSave(): void {
  if (!displayWindow || displayWindow.isDestroyed()) return
  if (boundsSaveTimer) clearTimeout(boundsSaveTimer)
  boundsSaveTimer = setTimeout(() => {
    if (!displayWindow || displayWindow.isDestroyed()) return
    void store.updateSettings({ displayBounds: displayWindow.getBounds() })
  }, 300)
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of [editorWindow, displayWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

async function eventFor(project: DisplayProject): Promise<ProjectEvent> {
  return { project, projects: await store.listProjects(), activeProjectId: store.activeProjectId }
}

function broadcastExcept(sender: Electron.WebContents, channel: string, payload: unknown): void {
  for (const window of [editorWindow, displayWindow]) {
    if (window && !window.isDestroyed() && window.webContents.id !== sender.id) {
      window.webContents.send(channel, payload)
    }
  }
}

function applyDisplaySettings(settings: AppSettings): void {
  if (!displayWindow || displayWindow.isDestroyed()) return
  displayWindow.setAlwaysOnTop(settings.alwaysOnTop)
  displayWindow.setIgnoreMouseEvents(displayEditing ? false : settings.clickThrough, { forward: true })
}

function setDisplayEditing(editing: boolean): void {
  if (!displayWindow || displayWindow.isDestroyed()) return
  displayEditing = editing
  displayResize = null
  displayMove = null
  displayWindow.setIgnoreMouseEvents(editing ? false : store.settings.clickThrough, { forward: true })
  displayWindow.webContents.send('display:editing-changed', editing)
  if (editing) displayWindow.show()
}

function registerIpc(): void {
  ipcMain.handle('app:bootstrap', async (event): Promise<BootstrapData> => {
    const role = event.sender === displayWindow?.webContents ? 'display' : 'editor'
    return {
      role,
      appVersion: app.getVersion(),
      projects: await store.listProjects(),
      activeProject: await store.getActiveProject(),
      settings: store.settings
    }
  })

  ipcMain.handle('project:create', async (_event, name?: string) => {
    const result = await eventFor(await store.createProject(name))
    broadcast('project:changed', result)
    return result
  })
  ipcMain.handle('project:duplicate', async (_event, projectId: string) => {
    const result = await store.duplicateProject(projectId)
    broadcast('project:changed', result)
    return result
  })
  ipcMain.handle('project:delete', async (_event, projectId: string) => {
    latestProjectPreviews.delete(projectId)
    const result = await store.deleteProject(projectId)
    broadcast('project:changed', result)
    return result
  })
  ipcMain.handle('project:reorder', async (_event, projectIds: string[]) => {
    const result = await store.reorderProjects(projectIds)
    broadcast('project:changed', result)
    return result
  })
  ipcMain.handle('project:activate', async (_event, projectId: string) => {
    const result = await store.activateProject(projectId)
    broadcast('project:changed', result)
    return result
  })
  ipcMain.handle('project:save', async (_event, project: DisplayProject) => {
    const result = await store.saveProject(project)
    const preview = latestProjectPreviews.get(project.id)
    if (preview && preview.revision <= result.project.revision) latestProjectPreviews.delete(project.id)
    broadcast('project:changed', result)
    return result
  })
  ipcMain.handle('project:reset', async (_event, projectId: string, scope: ProjectResetScope) => {
    latestProjectPreviews.delete(projectId)
    const result = await store.resetProject(projectId, scope)
    broadcast('project:changed', result)
    return result
  })
  ipcMain.handle('data:reset', async () => {
    latestProjectPreviews.clear()
    const result = await store.resetData()
    broadcast('project:changed', result)
    return result
  })
  ipcMain.on('project:preview', (event, project: DisplayProject) => {
    if (project.id !== store.activeProjectId) return
    const existing = latestProjectPreviews.get(project.id)
    if (!existing || existing.revision <= project.revision) latestProjectPreviews.set(project.id, structuredClone(project))
    broadcastExcept(event.sender, 'project:preview', project)
  })
  ipcMain.on('camera:preview', (event, preview: CameraPreviewEvent) => {
    if (preview.projectId !== store.activeProjectId) return
    broadcastExcept(event.sender, 'camera:preview', preview)
  })
  ipcMain.handle('project:export', async (_event, projectId: string) => {
    const project = await store.loadProject(projectId)
    const options: Electron.SaveDialogOptions = {
      title: 'Back up display',
      defaultPath: `${project.name.replace(/[\\/:*?"<>|]/g, '-')}.uvd`,
      filters: [{ name: 'Unvirtual Display project', extensions: ['uvd'] }]
    }
    const result = editorWindow
      ? await dialog.showSaveDialog(editorWindow, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return false
    const { writeFile } = await import('node:fs/promises')
    await writeFile(result.filePath, await store.exportProjectArchive(projectId))
    return true
  })
  ipcMain.handle('project:import-archive', async () => {
    const options: Electron.OpenDialogOptions = {
      title: 'Restore display',
      properties: ['openFile'],
      filters: [{ name: 'Unvirtual Display project', extensions: ['uvd'] }]
    }
    const result = editorWindow
      ? await dialog.showOpenDialog(editorWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    const { readFile } = await import('node:fs/promises')
    const event = await store.importProjectArchive(new Uint8Array(await readFile(result.filePaths[0])))
    broadcast('project:changed', event)
    return event
  })

  ipcMain.handle('asset:import', async (_event, projectId: string) => {
    const options: Electron.OpenDialogOptions = {
      title: 'Import display items',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '3D models and images', extensions: ['glb', 'gltf', 'vrm', 'fbx', 'obj', 'png', 'jpg', 'jpeg', 'webp'] },
        { name: 'Model support files', extensions: ['bin', 'mtl'] }
      ]
    }
    const result = editorWindow
      ? await dialog.showOpenDialog(editorWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled) return []
    return store.importFiles(projectId, result.filePaths)
  })
  ipcMain.handle('asset:import-dropped', async (_event, projectId: string, paths: string[]) => {
    return store.importFiles(projectId, paths)
  })
  ipcMain.handle('background:import', async (_event, projectId: string) => {
    const options: Electron.OpenDialogOptions = {
      title: 'Choose widget background',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    }
    const result = editorWindow
      ? await dialog.showOpenDialog(editorWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    const assets = await store.importFiles(projectId, [result.filePaths[0]])
    return assets[0] ?? null
  })

  ipcMain.handle('settings:update', async (_event, patch: Partial<AppSettings>) => {
    const settings = await store.updateSettings(patch)
    applyDisplaySettings(settings)
    broadcast('settings:changed', { settings })
    return settings
  })
  ipcMain.handle('capture:save', async (_event, suggestedName: string, data: Uint8Array) => {
    const options: Electron.SaveDialogOptions = {
      title: 'Save display image',
      defaultPath: `${suggestedName.replace(/[\\/:*?"<>|]/g, '-')}.png`,
      filters: [{ name: 'PNG image', extensions: ['png'] }]
    }
    const result = editorWindow
      ? await dialog.showSaveDialog(editorWindow, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return false
    const { writeFile } = await import('node:fs/promises')
    await writeFile(result.filePath, data)
    return true
  })
  ipcMain.handle('diagnostics:export', async () => {
    const options: Electron.SaveDialogOptions = {
      title: 'Export diagnostic log',
      defaultPath: `unvirtual-display-diagnostics-${new Date().toISOString().slice(0, 10)}.txt`,
      filters: [{ name: 'Text file', extensions: ['txt'] }]
    }
    const result = editorWindow
      ? await dialog.showSaveDialog(editorWindow, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return false
    const { writeFile } = await import('node:fs/promises')
    const header = [
      `Unvirtual Display ${app.getVersion()}`,
      `Platform: ${process.platform} ${process.arch}`,
      `Electron: ${process.versions.electron}`,
      `Chrome: ${process.versions.chrome}`,
      ''
    ]
    await writeFile(result.filePath, `${header.concat(diagnosticLines).join('\n')}\n`, 'utf8')
    return true
  })
  ipcMain.handle('display:set-editing', (_event, editing: boolean) => {
    setDisplayEditing(editing)
  })
  ipcMain.on('display:set-pointer-ignored', (event, ignored: boolean) => {
    if (event.sender !== displayWindow?.webContents || displayEditing || displayMove || store.settings.clickThrough) return
    displayWindow.setIgnoreMouseEvents(ignored, { forward: true })
  })
  ipcMain.on('display:resize-start', (event, edge: DisplayResizeEdge, point: { x: number; y: number }) => {
    if (event.sender !== displayWindow?.webContents || !displayEditing || !displayWindow) return
    displayResize = { edge, start: point, bounds: displayWindow.getBounds() }
  })
  ipcMain.on('display:resize-update', (event, point: { x: number; y: number }) => {
    if (event.sender !== displayWindow?.webContents || !displayResize || !displayWindow) return
    const minimumWidth = 320
    const minimumHeight = 240
    const dx = point.x - displayResize.start.x
    const dy = point.y - displayResize.start.y
    const start = displayResize.bounds
    let x = start.x
    let y = start.y
    let width = start.width
    let height = start.height
    if (displayResize.edge.includes('e')) width = Math.max(minimumWidth, start.width + dx)
    if (displayResize.edge.includes('s')) height = Math.max(minimumHeight, start.height + dy)
    if (displayResize.edge.includes('w')) {
      width = Math.max(minimumWidth, start.width - dx)
      x = start.x + start.width - width
    }
    if (displayResize.edge.includes('n')) {
      height = Math.max(minimumHeight, start.height - dy)
      y = start.y + start.height - height
    }
    displayWindow.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) })
  })
  ipcMain.on('display:resize-end', (event) => {
    if (event.sender === displayWindow?.webContents) displayResize = null
  })
  ipcMain.on('display:move-start', (event, point: { x: number; y: number }) => {
    if (event.sender !== displayWindow?.webContents || !displayWindow || (!displayEditing && store.settings.clickThrough)) return
    displayWindow.setIgnoreMouseEvents(false, { forward: true })
    displayMove = { start: point, bounds: displayWindow.getBounds() }
  })
  ipcMain.on('display:move-update', (event, point: { x: number; y: number }) => {
    if (event.sender !== displayWindow?.webContents || !displayMove || !displayWindow) return
    displayWindow.setPosition(
      Math.round(displayMove.bounds.x + point.x - displayMove.start.x),
      Math.round(displayMove.bounds.y + point.y - displayMove.start.y)
    )
  })
  ipcMain.on('display:move-end', (event) => {
    if (event.sender === displayWindow?.webContents) displayMove = null
  })
}

function createTray(): void {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><path fill="#fff" d="M3 3h16v16H3zm2 2v12h12V5zm2 2h8v2H7zm0 4h3v4H7zm5 0h3v4h-3z"/></svg>`
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  const updateMenu = (): void => {
    tray?.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open editor', click: () => { void createEditorWindow() } },
      {
        label: 'Click through',
        type: 'checkbox',
        checked: store.settings.clickThrough,
        click: (item) => {
          void store.updateSettings({ clickThrough: item.checked }).then((settings) => {
            applyDisplaySettings(settings)
            broadcast('settings:changed', { settings })
          })
        }
      },
      { label: 'Adjust widget', click: () => setDisplayEditing(true) },
      { type: 'separator' },
      { label: 'Quit', click: () => { isQuitting = true; app.quit() } }
    ]))
  }
  updateMenu()
  tray.setToolTip('Unvirtual Display')
  tray.on('click', () => { void createEditorWindow() })
}

app.on('second-instance', () => {
  if (!app.isReady()) return
  displayWindow?.showInactive()
  void createEditorWindow()
})

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  addDiagnostic(`Application started: ${process.platform} ${process.arch}`)
  const dataPath = app.isPackaged
    ? app.getPath('userData')
    : join(app.getPath('appData'), 'unvirtual-display-dev')
  store = new ProjectStore(dataPath, app.getLocale())
  await store.initialize()

  protocol.handle('uvd', (request) => {
    try {
      const url = new URL(request.url)
      if (url.host !== 'asset') return new Response('Not found', { status: 404 })
      const [, encodedProjectId, ...pathParts] = url.pathname.split('/')
      if (!encodedProjectId || pathParts.length === 0) return new Response('Not found', { status: 404 })
      const projectId = decodeURIComponent(encodedProjectId)
      const relativePath = pathParts.map(decodeURIComponent).join('/')
      return net.fetch(pathToFileURL(store.resolveAssetPath(projectId, relativePath)).toString())
    } catch {
      return new Response('Bad request', { status: 400 })
    }
  })

  registerIpc()
  await Promise.all([createDisplayWindow(), createEditorWindow()])
  createTray()
})

app.on('activate', () => { void createEditorWindow() })
app.on('before-quit', (event) => {
  isQuitting = true
  if (quitSaveComplete || latestProjectPreviews.size === 0) return
  event.preventDefault()
  if (quitSaveInProgress) return
  quitSaveInProgress = true
  const previews = [...latestProjectPreviews.values()].map((project) => structuredClone(project))
  void Promise.all(previews.map((project) => store.saveProject(project)))
    .catch((error) => addDiagnostic(`Final project save failed: ${error instanceof Error ? error.message : String(error)}`))
    .finally(() => {
      quitSaveComplete = true
      latestProjectPreviews.clear()
      app.quit()
    })
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
