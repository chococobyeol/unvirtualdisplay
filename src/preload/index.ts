import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AppSettings,
  CameraPreviewEvent,
  DisplayProject,
  DisplayResizeEdge,
  ProjectEvent,
  ProjectResetScope,
  SettingsEvent,
  UnvirtualApi
} from '../shared/types'

const api: UnvirtualApi = {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  createProject: (name) => ipcRenderer.invoke('project:create', name),
  duplicateProject: (projectId) => ipcRenderer.invoke('project:duplicate', projectId),
  deleteProject: (projectId) => ipcRenderer.invoke('project:delete', projectId),
  reorderProjects: (projectIds) => ipcRenderer.invoke('project:reorder', projectIds),
  activateProject: (projectId) => ipcRenderer.invoke('project:activate', projectId),
  saveProject: (project: DisplayProject) => ipcRenderer.invoke('project:save', project),
  resetProject: (projectId: string, scope: ProjectResetScope) => ipcRenderer.invoke('project:reset', projectId, scope),
  resetData: () => ipcRenderer.invoke('data:reset'),
  previewProject: (project: DisplayProject) => ipcRenderer.send('project:preview', project),
  previewCamera: (preview: CameraPreviewEvent) => ipcRenderer.send('camera:preview', preview),
  exportProject: (projectId) => ipcRenderer.invoke('project:export', projectId),
  importProjectArchive: () => ipcRenderer.invoke('project:import-archive'),
  importAssets: (projectId) => ipcRenderer.invoke('asset:import', projectId),
  importDroppedAssets: (projectId, paths) => ipcRenderer.invoke('asset:import-dropped', projectId, paths),
  importBackground: (projectId) => ipcRenderer.invoke('background:import', projectId),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  updateSettings: (patch: Partial<AppSettings>) => ipcRenderer.invoke('settings:update', patch),
  saveCapture: (suggestedName, data) => ipcRenderer.invoke('capture:save', suggestedName, data),
  exportDiagnostics: () => ipcRenderer.invoke('diagnostics:export'),
  setDisplayVisible: (visible) => ipcRenderer.invoke('display:set-visible', visible),
  setDisplayEditing: (editing) => ipcRenderer.invoke('display:set-editing', editing),
  showDisplayContextMenu: () => ipcRenderer.send('display:show-context-menu'),
  setDisplayPointerIgnored: (ignored) => ipcRenderer.send('display:set-pointer-ignored', ignored),
  startDisplayResize: (edge: DisplayResizeEdge, point) => ipcRenderer.send('display:resize-start', edge, point),
  updateDisplayResize: (point) => ipcRenderer.send('display:resize-update', point),
  endDisplayResize: () => ipcRenderer.send('display:resize-end'),
  startDisplayMove: (point) => ipcRenderer.send('display:move-start', point),
  updateDisplayMove: (point) => ipcRenderer.send('display:move-update', point),
  endDisplayMove: () => ipcRenderer.send('display:move-end'),
  onDisplayVisibilityChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, visible: boolean): void => listener(visible)
    ipcRenderer.on('display:visibility-changed', handler)
    return () => ipcRenderer.removeListener('display:visibility-changed', handler)
  },
  onDisplayEditingChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, editing: boolean): void => listener(editing)
    ipcRenderer.on('display:editing-changed', handler)
    return () => ipcRenderer.removeListener('display:editing-changed', handler)
  },
  onProjectChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ProjectEvent): void => listener(payload)
    ipcRenderer.on('project:changed', handler)
    return () => ipcRenderer.removeListener('project:changed', handler)
  },
  onProjectPreview: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, project: DisplayProject): void => listener(project)
    ipcRenderer.on('project:preview', handler)
    return () => ipcRenderer.removeListener('project:preview', handler)
  },
  onCameraPreview: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, preview: CameraPreviewEvent): void => listener(preview)
    ipcRenderer.on('camera:preview', handler)
    return () => ipcRenderer.removeListener('camera:preview', handler)
  },
  onSettingsChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: SettingsEvent): void => listener(payload)
    ipcRenderer.on('settings:changed', handler)
    return () => ipcRenderer.removeListener('settings:changed', handler)
  }
}

contextBridge.exposeInMainWorld('unvirtual', api)
