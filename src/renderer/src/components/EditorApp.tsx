import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  Box,
  Camera,
  Copy,
  Eraser,
  Eye,
  EyeOff,
  FileInput,
  FileOutput,
  FilePlus,
  Image as ImageIcon,
  Plus,
  Redo2,
  RotateCcw,
  Trash2,
  Undo2,
  type LucideIcon
} from 'lucide-react'
import type {
  AcrylicShape,
  AppSettings,
  BackgroundFit,
  BackgroundMode,
  CasePreset,
  DisplayItem,
  DisplayProject,
  ImageDisplayType,
  Language,
  QualityPreset,
  TransformMode,
  Vec3
} from '../../../shared/types'
import { createDefaultCameraSettings, DISPLAY_CASE_SELECTION_ID } from '../../../shared/types'
import { useAppStore } from '../store'
import { SceneView, type SceneViewHandle } from './SceneView'

const CASES: CasePreset[] = ['gallery', 'glass', 'warm']
const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'zh-Hans', label: '简体中文' }
]

const ICONS = {
  plus: Plus,
  copy: Copy,
  trash: Trash2,
  eye: Eye,
  eyeOff: EyeOff,
  importItem: FilePlus,
  undo: Undo2,
  redo: Redo2,
  backup: FileOutput,
  restore: FileInput,
  camera: Camera,
  clear: Eraser,
  reset: RotateCcw
} satisfies Record<string, LucideIcon>

function Icon({ name }: { name: keyof typeof ICONS }): React.JSX.Element {
  const Glyph = ICONS[name]
  return <Glyph aria-hidden="true" />
}

function DisplayCaseGlyph(): React.JSX.Element {
  return (
    <svg className="display-case-glyph" viewBox="0 0 32 26" aria-hidden="true">
      <rect className="display-case-object display-case-object-left" x="3.5" y="12" width="5.5" height="9.5" rx="1.7" />
      <rect className="display-case-object display-case-object-center" x="13.25" y="6.5" width="5.5" height="15" rx="1.7" />
      <rect className="display-case-object display-case-object-right" x="23" y="14" width="5.5" height="7.5" rx="1.7" />
    </svg>
  )
}

function ItemGlyph({ kind }: { kind: DisplayItem['kind'] }): React.JSX.Element {
  const Glyph = kind === 'model' ? Box : ImageIcon
  return (
    <span className={`file-dot ${kind}`} aria-hidden="true">
      <Glyph />
    </span>
  )
}

function Toggle({ checked, onChange, label, hint }: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  hint?: string
}): React.JSX.Element {
  return (
    <label className="toggle-row">
      <span><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <i aria-hidden="true" />
    </label>
  )
}

function LightDirectionControl({ azimuth, elevation, label, hint, onChange }: {
  azimuth: number
  elevation: number
  label: string
  hint: string
  onChange: (azimuth: number, elevation: number) => void
}): React.JSX.Element {
  const radial = Math.min(1, Math.max(0, (85 - elevation) / 70))
  const azimuthRadians = azimuth * Math.PI / 180
  const dotLeft = 50 + Math.sin(azimuthRadians) * radial * 38
  const dotTop = 50 - Math.cos(azimuthRadians) * radial * 38

  const updateFromPointer = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const radius = Math.max(1, (Math.min(bounds.width, bounds.height) - 8) / 2)
    let x = (event.clientX - bounds.left - bounds.width / 2) / radius
    let y = (event.clientY - bounds.top - bounds.height / 2) / radius
    const distance = Math.hypot(x, y)
    if (distance > 1) {
      x /= distance
      y /= distance
    }
    const clampedDistance = Math.min(1, distance)
    const nextAzimuth = clampedDistance < 0.04 ? azimuth : Math.atan2(x, -y) * 180 / Math.PI
    const nextElevation = 85 - clampedDistance * 70
    onChange(Math.round(nextAzimuth), Math.round(nextElevation))
  }

  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    updateFromPointer(event)
  }

  const continueDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event)
  }

  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const adjustWithKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    let nextAzimuth = azimuth
    let nextElevation = elevation
    if (event.key === 'ArrowLeft') nextAzimuth -= 5
    else if (event.key === 'ArrowRight') nextAzimuth += 5
    else if (event.key === 'ArrowUp') nextElevation += 5
    else if (event.key === 'ArrowDown') nextElevation -= 5
    else return
    event.preventDefault()
    nextAzimuth = ((nextAzimuth + 180) % 360 + 360) % 360 - 180
    onChange(nextAzimuth, Math.min(85, Math.max(15, nextElevation)))
  }

  return (
    <div className="light-direction-row">
      <span>{label}</span>
      <button
        type="button"
        className="light-direction-pad"
        title={hint}
        aria-label={label}
        aria-valuetext={`${Math.round(azimuth)}°, ${Math.round(elevation)}°`}
        onPointerDown={beginDrag}
        onPointerMove={continueDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={adjustWithKeyboard}
      >
        <i style={{ left: `${dotLeft}%`, top: `${dotTop}%` }} />
      </button>
      <b>{Math.round(azimuth)}° · {Math.round(elevation)}°</b>
    </div>
  )
}

function NumberField({ value, onChange, step = 0.1, ariaLabel }: {
  value: number
  onChange: (value: number) => void
  step?: number
  ariaLabel: string
}): React.JSX.Element {
  const format = (next: number): string => Number(next.toFixed(3)).toString()
  const [draft, setDraft] = useState(format(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setDraft(format(value))
  }, [focused, value])

  const apply = (next: number): void => {
    const rounded = Number(next.toFixed(6))
    setDraft(format(rounded))
    onChange(rounded)
  }
  const commit = (): void => {
    const next = Number(draft)
    if (draft.trim() && Number.isFinite(next)) apply(next)
    else setDraft(format(value))
  }
  const nudge = (direction: 1 | -1): void => {
    const typed = Number(draft)
    apply((draft.trim() && Number.isFinite(typed) ? typed : value) + step * direction)
  }

  return (
    <span className="number-control">
      <input
        className="number-field"
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        value={draft}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); commit() }}
        onChange={(event) => {
          const nextDraft = event.target.value
          setDraft(nextDraft)
          const next = Number(nextDraft)
          if (nextDraft.trim() && Number.isFinite(next)) onChange(next)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            nudge(event.key === 'ArrowUp' ? 1 : -1)
          } else if (event.key === 'Enter') {
            commit()
            event.currentTarget.blur()
          } else if (event.key === 'Escape') {
            setDraft(format(value))
            event.currentTarget.blur()
          }
        }}
      />
      <span className="number-steppers">
        <button type="button" tabIndex={-1} aria-label={`${ariaLabel} +`} onPointerDown={(event) => event.preventDefault()} onClick={() => nudge(1)} />
        <button type="button" tabIndex={-1} aria-label={`${ariaLabel} -`} onPointerDown={(event) => event.preventDefault()} onClick={() => nudge(-1)} />
      </span>
    </span>
  )
}

function VectorFields({ label, value, onChange, degrees = false }: {
  label: string
  value: Vec3
  onChange: (value: Vec3) => void
  degrees?: boolean
}): React.JSX.Element {
  const shown = degrees
    ? { x: value.x * 180 / Math.PI, y: value.y * 180 / Math.PI, z: value.z * 180 / Math.PI }
    : value
  const update = (axis: keyof Vec3, next: number): void => {
    const normalized = degrees ? next * Math.PI / 180 : next
    onChange({ ...value, [axis]: normalized })
  }
  return (
    <div className="vector-row">
      <span>{label}</span>
      {(['x', 'y', 'z'] as const).map((axis) => (
        <div className="vector-axis" key={axis}><em>{axis.toUpperCase()}</em><NumberField ariaLabel={`${label} ${axis.toUpperCase()}`} value={shown[axis]} step={degrees ? 5 : 0.1} onChange={(next) => update(axis, next)} /></div>
      ))}
    </div>
  )
}

function ProjectRail({ project, projects }: { project: DisplayProject; projects: ReturnType<typeof useAppStore.getState>['projects'] }): React.JSX.Element {
  const { t } = useTranslation()
  const activate = useAppStore((state) => state.activateProject)
  const create = useAppStore((state) => state.createProject)
  const duplicate = useAppStore((state) => state.duplicateProject)
  const remove = useAppStore((state) => state.deleteProject)
  const clear = useAppStore((state) => state.clearProject)
  const reset = useAppStore((state) => state.resetProject)
  const backup = useAppStore((state) => state.backupProject)
  const restore = useAppStore((state) => state.restoreProject)
  const mutate = useAppStore((state) => state.mutateProject)
  const selectedId = useAppStore((state) => state.selectedItemId)
  const select = useAppStore((state) => state.setSelectedItem)
  const toggleItemVisibility = (id: string): void => mutate((draft) => {
    const item = draft.items.find((candidate) => candidate.id === id)
    if (item) item.visible = item.visible === false
  })
  const toggleCaseVisibility = (): void => mutate((draft) => {
    draft.caseVisible = draft.caseVisible === false
  })
  const deleteItem = (id: string): void => {
    mutate((draft) => { draft.items = draft.items.filter((item) => item.id !== id) })
    if (selectedId === id) select(null)
  }

  return (
    <aside className="project-rail panel-surface">
      <div className="brand"><span className="brand-mark">U</span><span><b>{t('appName')}</b><small>{t('editor')}</small></span></div>
      <section className="panel-section grow">
        <div className="section-heading"><h2>{t('projects')}</h2><button className="icon-button" onClick={() => void create()} title={t('newProject')}><Icon name="plus" /></button></div>
        <div className="project-list">
          {projects.map((summary) => (
            <button key={summary.id} className={summary.id === project.id ? 'project-card active' : 'project-card'} onClick={() => void activate(summary.id)}>
              <span className="project-thumb"><DisplayCaseGlyph /></span>
              <span><b>{summary.name}</b><small>{summary.itemCount} {t('items').toLowerCase()}</small></span>
            </button>
          ))}
        </div>
      </section>
      <div className="rail-actions">
        <button className="quiet-button" title={t('duplicate')} onClick={() => void duplicate()}><Icon name="copy" /><span>{t('duplicate')}</span></button>
        <button className="quiet-button danger" title={t('delete')} disabled={projects.length <= 1} onClick={() => {
          if (window.confirm(t('deleteConfirm'))) void remove().catch(() => window.alert(t('lastProject')))
        }}><Icon name="trash" /><span>{t('delete')}</span></button>
        <button className="quiet-button" title={t('backup')} onClick={() => void backup()}><Icon name="backup" /><span>{t('backup')}</span></button>
        <button className="quiet-button" title={t('restore')} onClick={() => void restore()}><Icon name="restore" /><span>{t('restore')}</span></button>
        <button className="quiet-button danger" title={t('clearDisplay')} disabled={project.items.length === 0} onClick={() => {
          if (window.confirm(t('clearConfirm'))) void clear()
        }}><Icon name="clear" /><span>{t('clearDisplay')}</span></button>
        <button className="quiet-button danger" title={t('resetDisplay')} onClick={() => {
          if (window.confirm(t('resetConfirm'))) void reset()
        }}><Icon name="reset" /><span>{t('resetDisplay')}</span></button>
      </div>
      <section className="panel-section item-list-section">
        <div className="section-heading"><h2>{t('items')}</h2><span className="count-badge">{project.items.length}</span></div>
        <div className="item-list">
          <div className={`item-row case-row${selectedId === DISPLAY_CASE_SELECTION_ID ? ' active' : ''}${project.caseVisible === false ? ' hidden' : ''}`}>
            <button className="item-row-main" onClick={() => select(DISPLAY_CASE_SELECTION_ID)}>
              <span className="case-dot"><DisplayCaseGlyph /></span>
              <span><b>{t('caseObject')}</b><small>{t(project.casePreset)}</small></span>
            </button>
            <span className="item-row-actions">
              <button
                className={`item-row-action visibility${project.caseVisible === false ? ' is-off' : ''}`}
                title={t(project.caseVisible === false ? 'showCase' : 'hideCase')}
                aria-label={t(project.caseVisible === false ? 'showCase' : 'hideCase')}
                aria-pressed={project.caseVisible === false}
                onClick={toggleCaseVisibility}
              ><Icon name={project.caseVisible === false ? 'eyeOff' : 'eye'} /></button>
            </span>
          </div>
          {project.items.length === 0 && <p className="muted-copy">{t('emptyItems')}</p>}
          {project.items.map((item) => (
            <div key={item.id} className={`item-row${item.id === selectedId ? ' active' : ''}${item.visible === false ? ' hidden' : ''}`}>
              <button className="item-row-main" onClick={() => select(item.id)}>
                <ItemGlyph kind={item.kind} />
                <span><b>{item.name}</b><small>{item.format.toUpperCase()}</small></span>
              </button>
              <span className="item-row-actions">
                <button className={`item-row-action visibility${item.visible === false ? ' is-off' : ''}`} title={t(item.visible === false ? 'showItem' : 'hideItem')} aria-label={t(item.visible === false ? 'showItem' : 'hideItem')} aria-pressed={item.visible === false} onClick={() => toggleItemVisibility(item.id)}><Icon name={item.visible === false ? 'eyeOff' : 'eye'} /></button>
                <button className="item-row-action danger" title={t('removeItem')} aria-label={t('removeItem')} onClick={() => deleteItem(item.id)}><Icon name="trash" /></button>
              </span>
            </div>
          ))}
        </div>
      </section>
      <label className="project-name-editor">
        <span>{t('displayName')}</span>
        <input className="project-name" value={project.name} aria-label={t('displayName')} onChange={(event) => mutate((draft) => { draft.name = event.target.value })} />
      </label>
    </aside>
  )
}

function Inspector({ item, project, caseSelected }: { item: DisplayItem | null; project: DisplayProject; caseSelected: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  const mutate = useAppStore((state) => state.mutateProject)
  const select = useAppStore((state) => state.setSelectedItem)
  const updateItem = (change: (item: DisplayItem) => void): void => mutate((draft) => {
    const target = draft.items.find((candidate) => candidate.id === item?.id)
    if (target) change(target)
  })

  return (
    <section className="inspector-content">
      <div className="section-heading inspector-heading"><h2>{t('inspector')}</h2>{item && <span className={`format-pill ${item.kind}`}>{item.format}</span>}</div>
      {caseSelected ? <>
        <div className="case-selection-title"><span className="case-dot"><DisplayCaseGlyph /></span><b>{t('caseObject')}</b></div>
        <section className="property-group">
          <h3>{t('transform')}</h3>
          <VectorFields label={t('position')} value={project.displayTransform.position} onChange={(position) => mutate((draft) => { draft.displayTransform.position = position })} />
          <VectorFields label={t('rotation')} value={project.displayTransform.rotation} degrees onChange={(rotation) => mutate((draft) => { draft.displayTransform.rotation = rotation })} />
          <VectorFields label={t('scale')} value={project.displayTransform.scale} onChange={(scale) => mutate((draft) => { draft.displayTransform.scale = scale })} />
        </section>
      </> : !item ? <div className="empty-inspector"><span>◇</span><p>{t('noSelection')}</p></div> : <>
        <input className="item-name-input" value={item.name} onChange={(event) => updateItem((target) => { target.name = event.target.value })} />
        <section className="property-group">
          <h3>{t('transform')}</h3>
          <VectorFields label={t('position')} value={item.transform.position} onChange={(position) => updateItem((target) => { target.transform.position = position })} />
          <VectorFields label={t('rotation')} value={item.transform.rotation} degrees onChange={(rotation) => updateItem((target) => { target.transform.rotation = rotation })} />
          <VectorFields label={t('scale')} value={item.transform.scale} onChange={(scale) => updateItem((target) => { target.transform.scale = scale })} />
        </section>
        <section className="property-group">
          <h3>{t('physics')}</h3>
          <Toggle checked={item.physics.collision} label={t('collision')} onChange={(collision) => updateItem((target) => { target.physics.collision = collision })} />
          <Toggle checked={item.physics.preventToppling} label={t('preventToppling')} hint={t('preventTopplingHint')} onChange={(preventToppling) => updateItem((target) => { target.physics.preventToppling = preventToppling })} />
          <Toggle checked={item.physics.placementLocked} label={t('placementLocked')} onChange={(placementLocked) => updateItem((target) => { target.physics.placementLocked = placementLocked })} />
        </section>
        {item.kind === 'image' && <section className="property-group">
          <h3>{t('displayType')}</h3>
          <select value={item.imageDisplayType} onChange={(event) => updateItem((target) => { target.imageDisplayType = event.target.value as ImageDisplayType })}>
            {(['acrylic', 'panel', 'frame', 'photocard'] as ImageDisplayType[]).map((type) => <option value={type} key={type}>{t(type)}</option>)}
          </select>
          {item.imageDisplayType === 'acrylic' && <>
            <label className="acrylic-shape-row">
              <span>{t('acrylicShape')}</span>
              <select value={item.acrylicShape ?? 'contour'} onChange={(event) => updateItem((target) => { target.acrylicShape = event.target.value as AcrylicShape })}>
                {(['contour', 'rectangle', 'ellipse'] as AcrylicShape[]).map((shape) => <option value={shape} key={shape}>{t(shape)}</option>)}
              </select>
            </label>
            <label className="range-row acrylic-offset-row">
              <span>{t('acrylicOffset')}</span>
              <input type="range" min="1.5" max="12" step="0.5" value={(item.acrylicOffset ?? 0.045) * 100} onChange={(event) => updateItem((target) => { target.acrylicOffset = Number(event.target.value) / 100 })} />
              <input className="acrylic-offset-number" type="number" min="1.5" max="12" step="0.5" value={((item.acrylicOffset ?? 0.045) * 100).toFixed(1)} onChange={(event) => updateItem((target) => { target.acrylicOffset = Math.min(0.12, Math.max(0.015, Number(event.target.value) / 100)) })} />
            </label>
          </>}
        </section>}
        {item.kind === 'model' && <section className="property-group">
          <h3>{t('animation')}</h3>
          <Toggle checked={item.animation.enabled} label={t('playAnimation')} onChange={(enabled) => updateItem((target) => { target.animation.enabled = enabled })} />
          <Toggle checked={item.animation.loop} label={t('loop')} onChange={(loop) => updateItem((target) => { target.animation.loop = loop })} />
          <label className="range-row"><span>{t('speed')}</span><input type="range" min="0.1" max="2" step="0.1" value={item.animation.speed} onChange={(event) => updateItem((target) => { target.animation.speed = Number(event.target.value) })} /><b>{item.animation.speed.toFixed(1)}×</b></label>
        </section>}
        <button className="remove-item" onClick={() => {
          mutate((draft) => { draft.items = draft.items.filter((candidate) => candidate.id !== item.id) })
          select(null)
        }}><Icon name="trash" />{t('removeItem')}</button>
      </>}
    </section>
  )
}

function SettingsPanel({ settings, project }: { settings: AppSettings; project: DisplayProject }): React.JSX.Element {
  const { t } = useTranslation()
  const update = useAppStore((state) => state.updateSettings)
  const mutate = useAppStore((state) => state.mutateProject)
  const importBackground = async (): Promise<void> => {
    const asset = await window.unvirtual.importBackground(project.id)
    if (!asset) return
    mutate((draft) => {
      draft.background.mode = 'image'
      draft.background.imageUrl = asset.assetUrl
      draft.background.relativePath = asset.relativePath
    })
  }
  return (
    <section className="settings-block">
      <h3>{t('settings')}</h3>
      <label className="select-row"><span>{t('language')}</span><select value={settings.language} onChange={(event) => void update({ language: event.target.value as Language })}>{LANGUAGES.map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}</select></label>
      <Toggle checked={settings.alwaysOnTop} label={t('alwaysOnTop')} onChange={(alwaysOnTop) => void update({ alwaysOnTop })} />
      <Toggle checked={settings.clickThrough} label={t('clickThrough')} hint={t('clickThroughHint')} onChange={(clickThrough) => void update({ clickThrough })} />
      <button className="widget-adjust-button" onClick={() => void window.unvirtual.setDisplayEditing(true)}>{t('adjustWidget')}</button>
      <h3 className="subsettings-heading">{t('widgetBackground')}</h3>
      <label className="select-row"><span>{t('backgroundMode')}</span><select value={project.background.mode} onChange={(event) => mutate((draft) => { draft.background.mode = event.target.value as BackgroundMode })}>
        <option value="transparent">{t('backgroundTransparent')}</option>
        <option value="solid">{t('backgroundSolid')}</option>
        <option value="image">{t('backgroundImage')}</option>
      </select></label>
      {project.background.mode === 'solid' && <label className="color-row"><span>{t('backgroundColor')}</span><input type="color" value={project.background.color} onChange={(event) => mutate((draft) => { draft.background.color = event.target.value })} /></label>}
      {project.background.mode === 'image' && <div className="background-image-controls">
        <button onClick={() => void importBackground()}>{project.background.imageUrl ? t('changeBackground') : t('chooseBackground')}</button>
        {project.background.imageUrl
          ? <button className="background-clear" onClick={() => mutate((draft) => { delete draft.background.imageUrl; delete draft.background.relativePath })}>{t('removeBackground')}</button>
          : <p>{t('backgroundFallback')}</p>}
        <label className="select-row"><span>{t('backgroundFit')}</span><select value={project.background.fit} onChange={(event) => mutate((draft) => { draft.background.fit = event.target.value as BackgroundFit })}>
          <option value="cover">{t('cover')}</option><option value="contain">{t('contain')}</option>
        </select></label>
      </div>}
      <label className="select-row"><span>{t('quality')}</span><select value={settings.quality} onChange={(event) => void update({ quality: event.target.value as QualityPreset })}>{(['low', 'balanced', 'high'] as QualityPreset[]).map((quality) => <option key={quality} value={quality}>{t(quality)}</option>)}</select></label>
      <button className="diagnostics-button" onClick={() => void window.unvirtual.exportDiagnostics()}>{t('diagnostics')}</button>
    </section>
  )
}

export function EditorApp(): React.JSX.Element | null {
  const { t } = useTranslation()
  const project = useAppStore((state) => state.project)
  const projects = useAppStore((state) => state.projects)
  const settings = useAppStore((state) => state.settings)
  const selectedId = useAppStore((state) => state.selectedItemId)
  const transformMode = useAppStore((state) => state.transformMode)
  const saveStatus = useAppStore((state) => state.saveStatus)
  const history = useAppStore((state) => state.history)
  const future = useAppStore((state) => state.future)
  const importAssets = useAppStore((state) => state.importAssets)
  const mutate = useAppStore((state) => state.mutateProject)
  const updateTransform = useAppStore((state) => state.updateItemTransform)
  const setSelected = useAppStore((state) => state.setSelectedItem)
  const setMode = useAppStore((state) => state.setTransformMode)
  const undo = useAppStore((state) => state.undo)
  const redo = useAppStore((state) => state.redo)
  const [draggingFiles, setDraggingFiles] = useState(false)
  const [cameraResetKey, setCameraResetKey] = useState(0)
  const sceneViewRef = useRef<SceneViewHandle>(null)

  const selectedItem = useMemo(() => project?.items.find((item) => item.id === selectedId) ?? null, [project, selectedId])
  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, select, textarea')) return
      const command = event.metaKey || event.ctrlKey
      if (command && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (event.key.toLowerCase() === 'w') setMode('translate')
      if (event.key.toLowerCase() === 'e') setMode('rotate')
      if (event.key.toLowerCase() === 'r') setMode('scale')
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId && selectedId !== DISPLAY_CASE_SELECTION_ID) {
        mutate((draft) => { draft.items = draft.items.filter((item) => item.id !== selectedId) })
        setSelected(null)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [mutate, redo, selectedId, setMode, setSelected, undo])

  if (!project || !settings) return null

  const changeCase = (casePreset: CasePreset): void => mutate((draft) => { draft.casePreset = casePreset })
  const changeLighting = (value: number): void => mutate((draft) => { draft.lighting.intensity = value }, false)
  const resetCamera = (): void => {
    mutate((draft) => { draft.camera = createDefaultCameraSettings() })
    setCameraResetKey((key) => key + 1)
  }
  const saveCapture = (): void => {
    void sceneViewRef.current?.capture().then((blob) => {
      if (!blob) return
      void blob.arrayBuffer().then((buffer) => window.unvirtual.saveCapture(project.name, new Uint8Array(buffer)))
    })
  }

  return (
    <main className="editor-shell">
      <ProjectRail project={project} projects={projects} />
      <section className="workspace">
        <header className="toolbar panel-surface">
          <div className="tool-group segmented">
            {(['translate', 'rotate', 'scale'] as TransformMode[]).map((mode) => <button key={mode} className={transformMode === mode ? 'active' : ''} onClick={() => setMode(mode)}>{t(mode === 'scale' ? 'resize' : mode)}</button>)}
          </div>
          <div className="tool-group">
            <button className="icon-button" disabled={!history.length} title={t('undo')} onClick={undo}><Icon name="undo" /></button>
            <button className="icon-button" disabled={!future.length} title={t('redo')} onClick={redo}><Icon name="redo" /></button>
          </div>
          <div className="case-switcher">
            <span>{t('displayCase')}</span>
            {CASES.map((preset) => <button key={preset} title={t(preset)} className={project.casePreset === preset ? 'active' : ''} onClick={() => changeCase(preset)}>{t(`${preset}Short`)}</button>)}
          </div>
          <span className={`save-status ${saveStatus}`}>{saveStatus === 'saving' ? t('saving') : t('saved')}</span>
          <button className="icon-button capture-button" onClick={saveCapture} title={t('capture')} aria-label={t('capture')}><Icon name="camera" /></button>
          <button className="import-button" onClick={() => void importAssets().catch(() => window.alert(t('importFailed')))}><Icon name="importItem" />{t('import')}</button>
        </header>
        <div
          className={draggingFiles ? 'scene-stage file-dragging' : 'scene-stage'}
          onDragEnter={(event) => { event.preventDefault(); setDraggingFiles(true) }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => { if (event.currentTarget === event.target) setDraggingFiles(false) }}
          onDrop={(event) => {
            event.preventDefault()
            setDraggingFiles(false)
            void importAssets(Array.from(event.dataTransfer.files)).catch(() => window.alert(t('importFailed')))
          }}
        >
          <SceneView
            ref={sceneViewRef}
            project={project}
            quality={settings.quality}
            variant="editor"
            selectedItemId={selectedId}
            transformMode={transformMode}
            onSelect={setSelected}
            onTransform={updateTransform}
            onCamera={(camera) => mutate((draft) => { draft.camera = camera }, false)}
            cameraResetKey={cameraResetKey}
            onResetCamera={resetCamera}
            resetCameraLabel={t('resetCamera')}
          />
          <div className="scene-caption">{t('sceneHelp')}</div>
          {project.items.length === 0 && <div className="drop-callout"><span>＋</span><b>{t('emptyItems')}</b><small>{t('emptyHint')}</small></div>}
          {draggingFiles && <div className="drag-overlay"><span>↓</span><b>{t('import')}</b></div>}
        </div>
        <footer className="scene-footer panel-surface">
          <div className="range-row compact"><span>{t('lightIntensity')}</span><input type="range" min="0.25" max="2" step="0.05" value={project.lighting.intensity} onChange={(event) => changeLighting(Number(event.target.value))} /><b>{Math.round(project.lighting.intensity * 100)}%</b></div>
          <LightDirectionControl
            azimuth={project.lighting.azimuth}
            elevation={project.lighting.elevation}
            label={t('lightDirection')}
            hint={t('lightDirectionHint')}
            onChange={(azimuth, elevation) => mutate((draft) => {
              draft.lighting.azimuth = azimuth
              draft.lighting.elevation = elevation
            }, false)}
          />
          <Toggle checked={project.lighting.shadows} label={t('shadows')} onChange={(shadows) => mutate((draft) => { draft.lighting.shadows = shadows })} />
        </footer>
      </section>
      <aside className="inspector panel-surface">
        <Inspector item={selectedItem} project={project} caseSelected={selectedId === DISPLAY_CASE_SELECTION_ID} />
        <SettingsPanel settings={settings} project={project} />
      </aside>
      {!settings.onboardingComplete && <div className="onboarding-backdrop">
        <section className="onboarding-card">
          <span className="onboarding-mark">U</span>
          <h1>{t('welcomeTitle')}</h1>
          <p>{t('welcomeCopy')}</p>
          <div className="onboarding-steps">
            {([
              ['01', 'welcomeImport', 'welcomeImportCopy'],
              ['02', 'welcomeArrange', 'welcomeArrangeCopy'],
              ['03', 'welcomeDisplay', 'welcomeDisplayCopy']
            ] as const).map(([number, title, copy]) => <article key={number}><span>{number}</span><h2>{t(title)}</h2><p>{t(copy)}</p></article>)}
          </div>
          <button onClick={() => void useAppStore.getState().updateSettings({ onboardingComplete: true })}>{t('startCreating')}</button>
        </section>
      </div>}
    </main>
  )
}
