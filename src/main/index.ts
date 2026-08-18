import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  protocol,
  screen,
  shell,
  Tray
} from 'electron'
import type {
  AppSettings,
  BootstrapData,
  CameraPreviewEvent,
  DisplayProject,
  DisplayResizeEdge,
  ProjectChanges,
  ProjectEvent,
  ProjectPatch,
  ProjectResetScope
} from '../shared/types'
import { IMAGE_EXTENSIONS, MODEL_EXTENSIONS } from './asset-import'
import { createAssetResponse } from './asset-response'
import { shouldRecoverDisplayPointer, toDisplayClientPoint } from './display-pointer'
import { ProjectStore } from './project-store'
import { resolveWindowsTrayIconPath } from './tray-icon'
import { getDefaultDisplayBounds, recoverDisplayBounds } from './window-bounds'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'uvd',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
])

const developmentDataPath = app.isPackaged
  ? undefined
  : process.env.UNVIRTUAL_DISPLAY_DATA_PATH?.trim()
if (developmentDataPath) app.setPath('userData', developmentDataPath)

let editorWindow: BrowserWindow | null = null
let displayWindow: BrowserWindow | null = null
let displayWindowCreation: Promise<BrowserWindow> | null = null
let tray: Tray | null = null
let store: ProjectStore
let isQuitting = false
let boundsSaveTimer: ReturnType<typeof setTimeout> | null = null
let displayEditing = false
let displayPointerIgnored = false
let displayPointerRecoveryTimer: ReturnType<typeof setInterval> | null = null
let lastDisplayPointerPosition: { x: number; y: number } | null = null
let displayVisible = true
let displayResize: {
  edge: DisplayResizeEdge
  start: { x: number; y: number }
  bounds: Electron.Rectangle
} | null = null
let displayMove: {
  start: { x: number; y: number }
  bounds: Electron.Rectangle
} | null = null
let hasShownTrayHint = false
let quitSaveComplete = false
const latestProjectPatches = new Map<string, ProjectChanges>()
const diagnosticLines: string[] = []
const hasSingleInstanceLock = app.requestSingleInstanceLock()

const trayTranslations: Record<AppSettings['language'], {
  openEditor: string
  hideEditor: string
  showWidget: string
  hideWidget: string
  clickThrough: string
  adjustWidget: string
  quit: string
  stillRunning: string
}> = {
  ko: {
    openEditor: '편집창 열기',
    hideEditor: '편집창 숨기기',
    showWidget: '위젯 표시',
    hideWidget: '위젯 숨기기',
    clickThrough: '감상 중 클릭 통과',
    adjustWidget: '위젯 위치·크기 조정',
    quit: 'Unvirtual Display 종료',
    stillRunning: '위젯은 계속 실행 중입니다. 이 아이콘에서 편집창을 열거나 앱을 종료할 수 있습니다.'
  },
  en: {
    openEditor: 'Open editor',
    hideEditor: 'Hide editor',
    showWidget: 'Show widget',
    hideWidget: 'Hide widget',
    clickThrough: 'Click through while viewing',
    adjustWidget: 'Adjust widget',
    quit: 'Quit Unvirtual Display',
    stillRunning: 'The widget is still running. Use this icon to reopen the editor or quit the app.'
  },
  ja: {
    openEditor: '編集画面を開く',
    hideEditor: '編集画面を隠す',
    showWidget: 'ウィジェットを表示',
    hideWidget: 'ウィジェットを隠す',
    clickThrough: '鑑賞中はクリックを透過',
    adjustWidget: '位置とサイズを調整',
    quit: 'Unvirtual Displayを終了',
    stillRunning: 'ウィジェットは実行中です。このアイコンから編集画面を開くか、アプリを終了できます。'
  },
  'zh-Hans': {
    openEditor: '打开编辑器',
    hideEditor: '隐藏编辑器',
    showWidget: '显示小组件',
    hideWidget: '隐藏小组件',
    clickThrough: '观赏时点击穿透',
    adjustWidget: '调整小组件',
    quit: '退出 Unvirtual Display',
    stillRunning: '小组件仍在运行。可通过此图标重新打开编辑器或退出应用。'
  }
}

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

function currentTrayLabels(): (typeof trayTranslations)[AppSettings['language']] {
  return trayTranslations[store.settings.language] ?? trayTranslations.en
}

function showTrayHint(): void {
  if (process.platform !== 'win32' || !tray || tray.isDestroyed() || hasShownTrayHint) return
  hasShownTrayHint = true
  tray.displayBalloon({
    iconType: 'info',
    title: 'Unvirtual Display',
    content: currentTrayLabels().stillRunning,
    noSound: true,
    respectQuietTime: true
  })
}

function hideEditorWindowToTray(showHint = false): void {
  if (!editorWindow || editorWindow.isDestroyed()) return
  editorWindow.hide()
  if (process.platform === 'darwin') app.dock?.hide()
  refreshTrayMenu()
  if (showHint) showTrayHint()
}

async function setDisplayWindowVisible(visible: boolean): Promise<void> {
  displayVisible = visible
  await store.updateSettings({ displayVisible: visible })
  if (visible) {
    const window = await ensureDisplayWindow()
    if (isQuitting || !displayVisible || window.isDestroyed()) return
    window.showInactive()
    applyDisplaySettings(store.settings)
  } else {
    setDisplayEditing(false)
    if (displayWindow && !displayWindow.isDestroyed()) displayWindow.hide()
  }
  publishDisplayVisibility()
}

function publishDisplayVisibility(): void {
  broadcast('display:visibility-changed', displayVisible)
  refreshTrayMenu()
}

function updateClickThroughFromMenu(clickThrough: boolean): void {
  void store.updateSettings({ clickThrough }).then((settings) => {
    applyDisplaySettings(settings)
    broadcast('settings:changed', { settings })
    refreshTrayMenu()
  })
}

function showDisplayContextMenu(): void {
  if (!displayWindow || displayWindow.isDestroyed() || store.settings.clickThrough) return
  const labels = currentTrayLabels()
  Menu.buildFromTemplate([
    { label: labels.openEditor, click: () => { void createEditorWindow() } },
    { label: labels.hideWidget, click: () => { void setDisplayWindowVisible(false) } },
    {
      label: labels.clickThrough,
      type: 'checkbox',
      checked: store.settings.clickThrough,
      click: (item) => updateClickThroughFromMenu(item.checked)
    },
    { label: labels.adjustWidget, click: () => setDisplayEditing(true) },
    { type: 'separator' },
    { label: labels.quit, click: requestAppQuit }
  ]).popup({ window: displayWindow })
}

function finishAppQuit(): void {
  quitSaveComplete = true
  latestProjectPatches.clear()
  setImmediate(() => app.quit())
}

function requestAppQuit(): void {
  if (isQuitting) return
  isQuitting = true
  if (quitSaveComplete) {
    finishAppQuit()
    return
  }

  const patches = [...latestProjectPatches.entries()].map(([projectId, changes]) => ({
    projectId,
    changes: structuredClone(changes)
  }))
  void Promise.all([
    ...patches.map(({ projectId, changes }) => store.updateProject(projectId, changes)),
    saveDisplayBoundsNow()
  ])
    .catch((error) => addDiagnostic(`Final project save failed: ${error instanceof Error ? error.message : String(error)}`))
    .finally(finishAppQuit)
}

async function createEditorWindow(): Promise<BrowserWindow> {
  if (process.platform === 'darwin') await app.dock?.show()
  if (editorWindow && !editorWindow.isDestroyed()) {
    if (editorWindow.isMinimized()) editorWindow.restore()
    editorWindow.show()
    editorWindow.focus()
    refreshTrayMenu()
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

  editorWindow.once('ready-to-show', () => {
    editorWindow?.show()
    refreshTrayMenu()
  })
  attachDiagnostics(editorWindow, 'editor')
  editorWindow.on('minimize', () => {
    if (process.platform !== 'darwin') setImmediate(() => hideEditorWindowToTray(true))
  })
  editorWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    requestAppQuit()
  })
  editorWindow.on('show', refreshTrayMenu)
  editorWindow.on('hide', refreshTrayMenu)
  editorWindow.on('closed', () => {
    editorWindow = null
    refreshTrayMenu()
  })
  editorWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  await loadRenderer(editorWindow, 'editor')
  return editorWindow
}

async function ensureDisplayWindow(): Promise<BrowserWindow> {
  if (displayWindow && !displayWindow.isDestroyed()) return displayWindowCreation ?? displayWindow
  if (displayWindowCreation) return displayWindowCreation

  const creation = createDisplayWindow()
  displayWindowCreation = creation
  try {
    return await creation
  } finally {
    if (displayWindowCreation === creation) displayWindowCreation = null
  }
}

async function createDisplayWindow(): Promise<BrowserWindow> {
  const settings = store.settings
  const primaryWorkArea = screen.getPrimaryDisplay().workArea
  const bounds = recoverDisplayBounds(
    settings.displayBounds,
    screen.getAllDisplays().map((display) => display.workArea),
    primaryWorkArea
  )
  if (settings.displayBounds && JSON.stringify(settings.displayBounds) !== JSON.stringify(bounds)) {
    await store.updateSettings({ displayBounds: bounds })
  }
  const window = new BrowserWindow({
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
    skipTaskbar: true,
    show: false,
    webPreferences: commonWebPreferences()
  })
  displayWindow = window

  setDisplayPointerIgnored(settings.clickThrough)
  attachDiagnostics(window, 'display')
  window.once('ready-to-show', () => {
    if (displayVisible && settings.onboardingComplete && !isQuitting && !window.isDestroyed()) window.showInactive()
    publishDisplayVisibility()
  })
  window.on('show', () => {
    publishDisplayVisibility()
    refreshDisplayPointerRecovery()
  })
  window.on('hide', () => {
    publishDisplayVisibility()
    refreshDisplayPointerRecovery()
  })
  window.on('move', queueDisplayBoundsSave)
  window.on('resize', queueDisplayBoundsSave)
  window.on('closed', () => {
    if (displayWindow === window) {
      displayWindow = null
      displayEditing = false
      displayPointerIgnored = false
      clearDisplayPointerRecovery()
      displayResize = null
      displayMove = null
    }
    if (!isQuitting) requestAppQuit()
  })
  await loadRenderer(window, 'display')
  return window
}

function queueDisplayBoundsSave(): void {
  if (!displayWindow || displayWindow.isDestroyed()) return
  if (boundsSaveTimer) clearTimeout(boundsSaveTimer)
  boundsSaveTimer = setTimeout(() => {
    boundsSaveTimer = null
    void saveDisplayBoundsNow()
  }, 300)
}

async function saveDisplayBoundsNow(): Promise<void> {
  if (boundsSaveTimer) clearTimeout(boundsSaveTimer)
  boundsSaveTimer = null
  if (!displayWindow || displayWindow.isDestroyed()) return
  await store.updateSettings({ displayBounds: displayWindow.getBounds() })
}

async function resetDisplayBounds(): Promise<void> {
  const bounds = getDefaultDisplayBounds(screen.getPrimaryDisplay().workArea)
  const window = await ensureDisplayWindow()
  if (window.isDestroyed()) return
  window.setBounds(bounds)
  await store.updateSettings({ displayBounds: bounds })
  if (displayVisible) window.showInactive()
}

function rememberProjectPatch(patch: ProjectPatch): void {
  latestProjectPatches.set(patch.projectId, {
    ...latestProjectPatches.get(patch.projectId),
    ...structuredClone(patch.changes)
  })
}

function clearSavedProjectChanges(projectId: string, saved: ProjectChanges): void {
  const pending = latestProjectPatches.get(projectId)
  if (!pending) return
  for (const key of Object.keys(saved) as (keyof ProjectChanges)[]) {
    if (JSON.stringify(pending[key]) === JSON.stringify(saved[key])) delete pending[key]
  }
  if (Object.keys(pending).length === 0) latestProjectPatches.delete(projectId)
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
  setDisplayPointerIgnored(displayEditing ? false : settings.clickThrough)
}

function setDisplayEditing(editing: boolean): void {
  if (!displayWindow || displayWindow.isDestroyed()) return
  displayEditing = editing
  displayResize = null
  displayMove = null
  setDisplayPointerIgnored(editing ? false : store.settings.clickThrough)
  displayWindow.webContents.send('display:editing-changed', editing)
  if (editing) displayWindow.show()
}

function clearDisplayPointerRecovery(): void {
  lastDisplayPointerPosition = null
  if (!displayPointerRecoveryTimer) return
  clearInterval(displayPointerRecoveryTimer)
  displayPointerRecoveryTimer = null
}

function sendDisplayPointerPosition(): void {
  if (!displayWindow || displayWindow.isDestroyed() || !displayWindow.isVisible()) return
  const point = toDisplayClientPoint(screen.getCursorScreenPoint(), displayWindow.getBounds())
  if (!point) {
    lastDisplayPointerPosition = null
    return
  }
  if (lastDisplayPointerPosition?.x === point.x && lastDisplayPointerPosition.y === point.y) return
  lastDisplayPointerPosition = point
  displayWindow.webContents.send('display:pointer-position', point)
}

function refreshDisplayPointerRecovery(): void {
  const shouldRecover = shouldRecoverDisplayPointer({
    platform: process.platform,
    pointerIgnored: displayPointerIgnored,
    editing: displayEditing,
    clickThrough: store.settings.clickThrough,
    visible: Boolean(displayWindow && !displayWindow.isDestroyed() && displayWindow.isVisible())
  })
  if (!shouldRecover) {
    clearDisplayPointerRecovery()
    return
  }
  if (displayPointerRecoveryTimer) return
  sendDisplayPointerPosition()
  displayPointerRecoveryTimer = setInterval(sendDisplayPointerPosition, 16)
}

function setDisplayPointerIgnored(ignored: boolean): void {
  if (!displayWindow || displayWindow.isDestroyed()) return
  displayPointerIgnored = ignored
  displayWindow.setIgnoreMouseEvents(ignored, { forward: true })
  refreshDisplayPointerRecovery()
}

function registerIpc(): void {
  ipcMain.handle('app:bootstrap', async (event): Promise<BootstrapData> => {
    const role = event.sender === displayWindow?.webContents ? 'display' : 'editor'
    return {
      role,
      appVersion: app.getVersion(),
      displayVisible,
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
    latestProjectPatches.delete(projectId)
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
    latestProjectPatches.delete(project.id)
    broadcast('project:changed', result)
    return result
  })
  ipcMain.handle('project:update', async (_event, patch: ProjectPatch) => {
    const result = await store.updateProject(patch.projectId, patch.changes)
    clearSavedProjectChanges(patch.projectId, patch.changes)
    broadcast('project:patched', result)
    return result
  })
  ipcMain.handle('project:reset', async (_event, projectId: string, scope: ProjectResetScope) => {
    latestProjectPatches.delete(projectId)
    const result = await store.resetProject(projectId, scope)
    broadcast('project:changed', result)
    return result
  })
  ipcMain.handle('data:reset', async () => {
    latestProjectPatches.clear()
    const result = await store.resetData()
    broadcast('project:changed', result)
    return result
  })
  ipcMain.on('project:preview', (event, patch: ProjectPatch) => {
    if (patch.projectId !== store.activeProjectId) return
    rememberProjectPatch(patch)
    broadcastExcept(event.sender, 'project:preview', patch)
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
        { name: '3D models and images', extensions: [...MODEL_EXTENSIONS, ...IMAGE_EXTENSIONS] },
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
    const completingOnboarding = !store.settings.onboardingComplete && patch.onboardingComplete === true
    const settings = await store.updateSettings(patch)
    applyDisplaySettings(settings)
    broadcast('settings:changed', { settings })
    if (completingOnboarding) await setDisplayWindowVisible(true)
    refreshTrayMenu()
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
  ipcMain.handle('display:set-editing', async (_event, editing: boolean) => {
    if (editing) await setDisplayWindowVisible(true)
    setDisplayEditing(editing)
  })
  ipcMain.handle('display:set-visible', async (_event, visible: boolean) => {
    await setDisplayWindowVisible(visible)
    return displayVisible
  })
  ipcMain.handle('display:reset-bounds', async () => {
    await setDisplayWindowVisible(true)
    await resetDisplayBounds()
  })
  ipcMain.on('display:show-context-menu', (event) => {
    if (event.sender !== displayWindow?.webContents || store.settings.clickThrough) return
    showDisplayContextMenu()
  })
  ipcMain.on('display:set-pointer-ignored', (event, ignored: boolean) => {
    if (event.sender !== displayWindow?.webContents || displayEditing || displayMove || store.settings.clickThrough) return
    setDisplayPointerIgnored(ignored)
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
    if (event.sender === displayWindow?.webContents) {
      displayResize = null
      void saveDisplayBoundsNow()
    }
  })
  ipcMain.on('display:move-start', (event, point: { x: number; y: number }) => {
    if (event.sender !== displayWindow?.webContents || !displayWindow || (!displayEditing && store.settings.clickThrough)) return
    setDisplayPointerIgnored(false)
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
    if (event.sender === displayWindow?.webContents) {
      displayMove = null
      applyDisplaySettings(store.settings)
      void saveDisplayBoundsNow()
    }
  })
}

function refreshTrayMenu(): void {
  if (!tray || tray.isDestroyed()) return
  const labels = currentTrayLabels()
  const editorVisible = Boolean(editorWindow && !editorWindow.isDestroyed() && editorWindow.isVisible())
  const widgetVisible = Boolean(displayWindow && !displayWindow.isDestroyed() && displayWindow.isVisible())
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: editorVisible ? labels.hideEditor : labels.openEditor,
      click: () => {
        if (editorWindow && !editorWindow.isDestroyed() && editorWindow.isVisible()) hideEditorWindowToTray()
        else void createEditorWindow()
      }
    },
    {
      label: widgetVisible ? labels.hideWidget : labels.showWidget,
      click: () => { void setDisplayWindowVisible(!widgetVisible) }
    },
    {
      label: labels.clickThrough,
      type: 'checkbox',
      checked: store.settings.clickThrough,
      click: (item) => updateClickThroughFromMenu(item.checked)
    },
    {
      label: labels.adjustWidget,
      click: () => {
        void setDisplayWindowVisible(true).then(() => setDisplayEditing(true))
      }
    },
    { type: 'separator' },
    { label: labels.quit, click: requestAppQuit }
  ]))
}

function createTray(): void {
  let icon: Electron.NativeImage
  if (process.platform === 'win32') {
    const iconPath = resolveWindowsTrayIconPath(app.isPackaged, app.getAppPath(), process.resourcesPath)
    icon = nativeImage.createFromPath(iconPath)
    if (icon.isEmpty()) {
      addDiagnostic(`Windows tray icon failed to load: ${iconPath}`)
      console.error(`Windows tray icon failed to load: ${iconPath}`)
    }
  } else {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><path fill="#fff" d="M3 3h16v16H3zm2 2v12h12V5zm2 2h8v2H7zm0 4h3v4H7zm5 0h3v4h-3z"/></svg>`
    icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
    icon.setTemplateImage(process.platform === 'darwin')
  }
  tray = new Tray(icon)
  refreshTrayMenu()
  tray.setToolTip('Unvirtual Display')
  if (process.platform !== 'darwin') tray.on('click', () => { void createEditorWindow() })
  tray.on('balloon-click', () => { void createEditorWindow() })
}

app.on('second-instance', () => {
  if (!app.isReady() || isQuitting) return
  void Promise.all([
    createEditorWindow(),
    displayVisible ? setDisplayWindowVisible(true) : Promise.resolve()
  ])
})

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  addDiagnostic(`Application started: ${process.platform} ${process.arch}`)
  const dataPath = app.isPackaged || developmentDataPath
    ? app.getPath('userData')
    : join(app.getPath('appData'), 'unvirtual-display-dev')
  store = new ProjectStore(dataPath, app.getLocale())
  await store.initialize()
  displayVisible = store.settings.displayVisible

  protocol.handle('uvd', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.host !== 'asset') return new Response('Not found', { status: 404 })
      const [, encodedProjectId, ...pathParts] = url.pathname.split('/')
      if (!encodedProjectId || pathParts.length === 0) return new Response('Not found', { status: 404 })
      const projectId = decodeURIComponent(encodedProjectId)
      const relativePath = pathParts.map(decodeURIComponent).join('/')
      return await createAssetResponse(store.resolveAssetPath(projectId, relativePath), request.method)
    } catch (error) {
      addDiagnostic(`Asset request failed: ${error instanceof Error ? error.message : String(error)}`)
      return new Response('Bad request', { status: 400 })
    }
  })

  registerIpc()
  await Promise.all([ensureDisplayWindow(), createEditorWindow()])
  createTray()
})

app.on('activate', () => {
  if (isQuitting) return
  void Promise.all([
    createEditorWindow(),
    displayVisible ? setDisplayWindowVisible(true) : Promise.resolve()
  ])
})
app.on('before-quit', (event) => {
  if (quitSaveComplete || (latestProjectPatches.size === 0 && !boundsSaveTimer)) {
    isQuitting = true
    return
  }
  event.preventDefault()
  requestAppQuit()
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !isQuitting) requestAppQuit()
})
