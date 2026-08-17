import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent } from 'react'
import {
  Box,
  Camera,
  ChevronDown,
  Copy,
  Ellipsis,
  Eraser,
  Eye,
  EyeOff,
  FileInput,
  FileOutput,
  Image as ImageIcon,
  Monitor,
  MonitorOff,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  Settings,
  Trash2,
  Undo2,
  X,
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
  ProjectSummary,
  QualityPreset,
  TransformMode,
  Vec3
} from '../../../shared/types'
import { createDefaultCameraSettings, DISPLAY_CASE_SELECTION_ID } from '../../../shared/types'
import galleryCasePreview from '../assets/case-previews/gallery.jpg'
import glassCasePreview from '../assets/case-previews/glass.jpg'
import warmCasePreview from '../assets/case-previews/warm.jpg'
import { reorderById, type ReorderPlacement } from '../reorder'
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
  undo: Undo2,
  redo: Redo2,
  backup: FileOutput,
  restore: FileInput,
  camera: Camera,
  clear: Eraser,
  reset: RotateCcw,
  more: Ellipsis,
  settings: Settings,
  close: X,
  rename: Pencil,
  monitor: Monitor,
  monitorOff: MonitorOff
} satisfies Record<string, LucideIcon>

function Icon({ name }: { name: keyof typeof ICONS }): React.JSX.Element {
  const Glyph = ICONS[name]
  return <Glyph aria-hidden="true" />
}

function autoScrollList(list: HTMLElement, clientY: number): void {
  const bounds = list.getBoundingClientRect()
  const edgeSize = Math.min(30, bounds.height / 4)
  if (clientY < bounds.top + edgeSize) list.scrollTop -= 12
  else if (clientY > bounds.bottom - edgeSize) list.scrollTop += 12
}

function isFileDrag(event: ReactDragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes('Files')
}

type PointerReorderState = {
  kind: 'project' | 'item'
  id: string
  pointerId: number
  startX: number
  startY: number
  dragging: boolean
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

function moveMenuFocus(event: React.KeyboardEvent<HTMLDivElement>): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)'))
  if (!items.length) return
  event.preventDefault()
  const current = items.indexOf(document.activeElement as HTMLButtonElement)
  const next = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? items.length - 1
      : event.key === 'ArrowDown'
        ? (current + 1 + items.length) % items.length
        : (current - 1 + items.length) % items.length
  items[next]?.focus()
}

function DisplayFileMenu(): React.JSX.Element {
  const { t } = useTranslation()
  const backup = useAppStore((state) => state.backupProject)
  const restore = useAppStore((state) => state.restoreProject)
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuPopoverRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', dismiss)
    const focusFrame = window.requestAnimationFrame(() => menuPopoverRef.current?.querySelector<HTMLButtonElement>('.menu-item:not(:disabled)')?.focus())
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('pointerdown', dismiss)
    }
  }, [open])

  return (
    <div className="toolbar-file-menu" ref={menuRef}>
      <button
        ref={menuButtonRef}
        type="button"
        className={`toolbar-menu-button${open ? ' active' : ''}`}
        title={t('fileMenu')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{t('fileMenu')}</span><ChevronDown aria-hidden="true" />
      </button>
      {open && <div
        className="menu-popover toolbar-menu-popover"
        ref={menuPopoverRef}
        role="menu"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            setOpen(false)
            window.requestAnimationFrame(() => menuButtonRef.current?.focus())
            return
          }
          moveMenuFocus(event)
        }}
      >
        <button type="button" className="menu-item" role="menuitem" onClick={() => {
          setOpen(false)
          void restore()
        }}><Icon name="restore" /><span>{t('importDisplayArchive')}</span></button>
        <button type="button" className="menu-item" role="menuitem" onClick={() => {
          setOpen(false)
          void backup()
        }}><Icon name="backup" /><span>{t('exportDisplayArchive')}</span></button>
      </div>}
    </div>
  )
}

const CASE_PREVIEW_IMAGES: Record<CasePreset, string> = {
  gallery: galleryCasePreview,
  glass: glassCasePreview,
  warm: warmCasePreview
}

function CasePresetPreview({ preset }: { preset: CasePreset }): React.JSX.Element {
  return <img className="case-preset-preview" src={CASE_PREVIEW_IMAGES[preset]} alt="" draggable={false} aria-hidden="true" />
}

function CasePresetControl({
  value,
  label,
  getName,
  onChange
}: {
  value: CasePreset
  label: string
  getName: (preset: CasePreset) => string
  onChange: (preset: CasePreset) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const controlRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent): void => {
      if (!controlRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeFromKeyboard = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      setOpen(false)
      window.requestAnimationFrame(() => triggerRef.current?.focus())
    }
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', closeFromKeyboard)
    const focusFrame = window.requestAnimationFrame(() => {
      popoverRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus()
    })
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('keydown', closeFromKeyboard)
    }
  }, [open])

  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    const cards = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.case-preset-card'))
    if (!cards.length) return
    event.preventDefault()
    const current = Math.max(0, cards.indexOf(document.activeElement as HTMLButtonElement))
    const offset = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? cards.length - 1
        : (current + offset + cards.length) % cards.length
    cards[next]?.focus()
  }

  return (
    <div className="case-picker" ref={controlRef}>
      <span className="case-picker-label">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className={`case-picker-trigger${open ? ' open' : ''}`}
        title={getName(value)}
        aria-label={`${label}: ${getName(value)}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{getName(value)}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open && <div className="case-picker-popover" ref={popoverRef}>
        <strong>{label}</strong>
        <div className="case-picker-grid" role="listbox" aria-label={label} onKeyDown={moveFocus}>
          {CASES.map((preset) => <button
            key={preset}
            type="button"
            className="case-preset-card"
            role="option"
            aria-selected={value === preset}
            title={getName(preset)}
            onClick={() => {
              if (preset !== value) onChange(preset)
              setOpen(false)
              window.requestAnimationFrame(() => triggerRef.current?.focus())
            }}
          >
            <CasePresetPreview preset={preset} />
            <span>{getName(preset)}</span>
          </button>)}
        </div>
      </div>}
    </div>
  )
}

const normalizeAzimuth = (value: number): number => ((Math.round(value) % 360) + 360) % 360

function LightDirectionControl({
  azimuth,
  elevation,
  label,
  horizontalLabel,
  horizontalHint,
  heightLabel,
  heightHint,
  heightMapHint,
  frontLabel,
  rightLabel,
  backLabel,
  leftLabel,
  hint,
  resetLabel,
  resetText,
  onChange
}: {
  azimuth: number
  elevation: number
  label: string
  horizontalLabel: string
  horizontalHint: string
  heightLabel: string
  heightHint: string
  heightMapHint: string
  frontLabel: string
  rightLabel: string
  backLabel: string
  leftLabel: string
  hint: string
  resetLabel: string
  resetText: string
  onChange: (azimuth: number, elevation: number) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const controlRef = useRef<HTMLDivElement>(null)
  const radial = Math.min(1, Math.max(0, (90 - elevation) / 90))
  const azimuthRadians = azimuth * Math.PI / 180
  const dotLeft = 50 + Math.sin(azimuthRadians) * radial * 38
  const dotTop = 50 - Math.cos(azimuthRadians) * radial * 38

  useEffect(() => {
    if (!open) return
    const closeFromOutside = (event: PointerEvent): void => {
      if (!controlRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeFromKeyboard = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      setOpen(false)
    }
    window.addEventListener('pointerdown', closeFromOutside)
    window.addEventListener('keydown', closeFromKeyboard)
    return () => {
      window.removeEventListener('pointerdown', closeFromOutside)
      window.removeEventListener('keydown', closeFromKeyboard)
    }
  }, [open])

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
    const nextElevation = 90 - clampedDistance * 90
    onChange(normalizeAzimuth(nextAzimuth), Math.round(nextElevation))
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
    onChange(normalizeAzimuth(nextAzimuth), Math.min(90, Math.max(0, nextElevation)))
  }

  return (
    <div className="light-direction-row" ref={controlRef}>
      <span>{label}</span>
      <button
        type="button"
        className={`light-direction-summary ${open ? 'open' : ''}`}
        title={hint}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-valuetext={`${Math.round(azimuth)}°, ${Math.round(elevation)}°`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="light-direction-mini" aria-hidden="true"><i style={{ left: `${dotLeft}%`, top: `${dotTop}%` }} /></span>
        <span className="light-direction-value"><small>{horizontalLabel}</small><b>{Math.round(azimuth)}°</b></span>
        <span className="light-direction-divider" aria-hidden="true" />
        <span className="light-direction-value"><small>{heightLabel}</small><b>{Math.round(elevation)}°</b></span>
        <span className="light-direction-caret" aria-hidden="true" />
      </button>
      {open && <section className="light-direction-popover" role="dialog" aria-label={label}>
        <header>
          <strong>{label}</strong>
          <button type="button" className="light-direction-reset" title={resetLabel} aria-label={resetLabel} onClick={() => onChange(30, 45)}>
            <Icon name="reset" /><span>{resetText}</span>
          </button>
        </header>
        <div className="light-direction-popover-body">
          <div className="light-direction-compass">
            <span className="compass-label front"><b>0°</b><small>{frontLabel}</small></span>
            <span className="compass-label right"><b>90°</b><small>{rightLabel}</small></span>
            <span className="compass-label back"><b>180°</b><small>{backLabel}</small></span>
            <span className="compass-label left"><b>270°</b><small>{leftLabel}</small></span>
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
          </div>
          <div className="light-direction-fields">
            <label className="light-direction-field">
              <span><strong>{horizontalLabel}</strong><small>{horizontalHint}</small></span>
              <span className="light-angle-input">
                <NumberField
                  value={Math.round(azimuth)}
                  step={5}
                  ariaLabel={horizontalLabel}
                  normalize={normalizeAzimuth}
                  suffix="°"
                  onChange={(value) => onChange(normalizeAzimuth(value), elevation)}
                />
              </span>
            </label>
            <label className="light-direction-field">
              <span><strong>{heightLabel}</strong><small>{heightHint}</small></span>
              <span className="light-angle-input">
                <NumberField
                  value={Math.round(elevation)}
                  step={5}
                  ariaLabel={heightLabel}
                  normalize={(value) => Math.min(90, Math.max(0, Math.round(value)))}
                  suffix="°"
                  onChange={(value) => onChange(azimuth, Math.min(90, Math.max(0, Math.round(value))))}
                />
              </span>
            </label>
            <p>{heightMapHint}</p>
          </div>
        </div>
      </section>}
    </div>
  )
}

function NumberField({ value, onChange, step = 0.1, ariaLabel, normalize, suffix }: {
  value: number
  onChange: (value: number) => void
  step?: number
  ariaLabel: string
  normalize?: (value: number) => number
  suffix?: string
}): React.JSX.Element {
  const format = (next: number): string => Number(next.toFixed(3)).toString()
  const [draft, setDraft] = useState(format(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setDraft(format(value))
  }, [focused, value])

  const apply = (next: number): void => {
    const normalized = normalize ? normalize(next) : next
    const rounded = Number(normalized.toFixed(6))
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
          if (nextDraft.trim() && Number.isFinite(next)) onChange(normalize ? normalize(next) : next)
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
      {suffix && <span className="number-suffix" aria-hidden="true">{suffix}</span>}
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

function ProjectRail({ project, projects, onInspect }: {
  project: DisplayProject
  projects: ReturnType<typeof useAppStore.getState>['projects']
  onInspect: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const activate = useAppStore((state) => state.activateProject)
  const create = useAppStore((state) => state.createProject)
  const duplicate = useAppStore((state) => state.duplicateProject)
  const remove = useAppStore((state) => state.deleteProject)
  const reorderProjects = useAppStore((state) => state.reorderProjects)
  const clear = useAppStore((state) => state.clearProject)
  const importAssets = useAppStore((state) => state.importAssets)
  const mutate = useAppStore((state) => state.mutateProject)
  const selectedId = useAppStore((state) => state.selectedItemId)
  const select = useAppStore((state) => state.setSelectedItem)
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null)
  const [projectNameDraft, setProjectNameDraft] = useState('')
  const [projectMenu, setProjectMenu] = useState<{ projectId: string; left: number; top: number } | null>(null)
  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(null)
  const [projectDrop, setProjectDrop] = useState<{ targetId: string; placement: ReorderPlacement } | null>(null)
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null)
  const [itemDrop, setItemDrop] = useState<{ targetId: string; placement: ReorderPlacement } | null>(null)
  const cancelProjectRename = useRef(false)
  const suppressProjectClick = useRef(false)
  const suppressItemClick = useRef(false)
  const projectDropRef = useRef<{ targetId: string; placement: ReorderPlacement } | null>(null)
  const itemDropRef = useRef<{ targetId: string; placement: ReorderPlacement } | null>(null)
  const pointerReorder = useRef<PointerReorderState | null>(null)
  const projectMenuRef = useRef<HTMLDivElement>(null)
  const projectMenuAnchorRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!projectMenu) return
    const dismiss = (event: PointerEvent): void => {
      const target = event.target
      if (projectMenuRef.current?.contains(target as Node)) return
      if (target instanceof Element && target.closest('.project-menu-button')) return
      setProjectMenu(null)
    }
    const dismissFromViewportChange = (): void => setProjectMenu(null)
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('resize', dismissFromViewportChange)
    document.addEventListener('scroll', dismissFromViewportChange, true)
    const focusFrame = window.requestAnimationFrame(() => projectMenuRef.current?.querySelector<HTMLButtonElement>('.menu-item:not(:disabled)')?.focus())
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('resize', dismissFromViewportChange)
      document.removeEventListener('scroll', dismissFromViewportChange, true)
    }
  }, [projectMenu])

  useEffect(() => () => document.body.classList.remove('list-reordering'), [])

  const toggleProjectMenu = (summary: ProjectSummary, anchor: HTMLButtonElement): void => {
    if (projectMenu?.projectId === summary.id) {
      setProjectMenu(null)
      return
    }
    projectMenuAnchorRef.current = anchor
    const bounds = anchor.getBoundingClientRect()
    const menuWidth = 170
    const menuHeight = 150
    const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, bounds.right - menuWidth))
    const top = bounds.bottom + menuHeight <= window.innerHeight - 8
      ? bounds.bottom + 4
      : Math.max(8, bounds.top - menuHeight - 4)
    setProjectMenu({ projectId: summary.id, left, top })
  }

  const beginProjectRename = (summary: ProjectSummary): void => {
    setProjectMenu(null)
    cancelProjectRename.current = false
    setProjectNameDraft(summary.name)
    setRenamingProjectId(summary.id)
  }
  const finishProjectRename = async (summary: ProjectSummary): Promise<void> => {
    const cancelled = cancelProjectRename.current
    cancelProjectRename.current = false
    setRenamingProjectId(null)
    if (cancelled) return

    const name = projectNameDraft.trim()
    if (!name || name === summary.name) return
    if (useAppStore.getState().project?.id !== summary.id) await activate(summary.id)
    mutate((draft) => { draft.name = name })
  }
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
  const finishProjectDrag = (): void => {
    setDraggingProjectId(null)
    setProjectDrop(null)
    projectDropRef.current = null
    suppressProjectClick.current = true
    window.setTimeout(() => { suppressProjectClick.current = false }, 0)
  }
  const finishItemDrag = (): void => {
    setDraggingItemId(null)
    setItemDrop(null)
    itemDropRef.current = null
    suppressItemClick.current = true
    window.setTimeout(() => { suppressItemClick.current = false }, 0)
  }
  const reorderProjectRows = (sourceId: string, targetId: string, placement: ReorderPlacement): void => {
    const next = reorderById(projects, sourceId, targetId, placement)
    if (next.some((summary, index) => summary.id !== projects[index]?.id)) {
      void reorderProjects(next.map((summary) => summary.id))
    }
  }
  const reorderItemRows = (sourceId: string, targetId: string, placement: ReorderPlacement): void => {
    mutate((draft) => {
      draft.items = reorderById(draft.items, sourceId, targetId, placement)
    })
  }
  const beginPointerReorder = (event: ReactPointerEvent<HTMLButtonElement>, kind: PointerReorderState['kind'], id: string): void => {
    if (event.button !== 0) return
    pointerReorder.current = {
      kind,
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const updatePointerReorder = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = pointerReorder.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!drag.dragging) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return
      drag.dragging = true
      document.body.classList.add('list-reordering')
      if (drag.kind === 'project') {
        setProjectMenu(null)
        setDraggingProjectId(drag.id)
      } else {
        setDraggingItemId(drag.id)
      }
    }

    event.preventDefault()
    const selector = drag.kind === 'project' ? '[data-reorder-project-id]' : '[data-reorder-item-id]'
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(selector)
    const targetId = drag.kind === 'project' ? target?.dataset.reorderProjectId : target?.dataset.reorderItemId
    const list = event.currentTarget.closest<HTMLElement>(drag.kind === 'project' ? '.project-list' : '.item-list')
    if (list) autoScrollList(list, event.clientY)
    if (!target || !targetId || targetId === drag.id) {
      if (drag.kind === 'project') {
        projectDropRef.current = null
        setProjectDrop(null)
      } else {
        itemDropRef.current = null
        setItemDrop(null)
      }
      return
    }

    const bounds = target.getBoundingClientRect()
    const nextDrop = {
      targetId,
      placement: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
    } satisfies { targetId: string; placement: ReorderPlacement }
    if (drag.kind === 'project') {
      projectDropRef.current = nextDrop
      setProjectDrop(nextDrop)
    } else {
      itemDropRef.current = nextDrop
      setItemDrop(nextDrop)
    }
  }
  const endPointerReorder = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = pointerReorder.current
    if (!drag || drag.pointerId !== event.pointerId) return
    pointerReorder.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    document.body.classList.remove('list-reordering')
    if (!drag.dragging) return
    event.preventDefault()
    if (drag.kind === 'project') {
      const drop = projectDropRef.current
      if (drop) reorderProjectRows(drag.id, drop.targetId, drop.placement)
      finishProjectDrag()
    } else {
      const drop = itemDropRef.current
      if (drop) reorderItemRows(drag.id, drop.targetId, drop.placement)
      finishItemDrag()
    }
  }
  const cancelPointerReorder = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = pointerReorder.current
    if (!drag || drag.pointerId !== event.pointerId) return
    pointerReorder.current = null
    document.body.classList.remove('list-reordering')
    if (drag.kind === 'project') finishProjectDrag()
    else finishItemDrag()
  }
  const projectCardClass = (projectId: string): string => [
    'project-card',
    projectId === project.id ? 'active' : '',
    projectId === draggingProjectId ? 'dragging' : '',
    projectDrop?.targetId === projectId ? `drop-${projectDrop.placement}` : ''
  ].filter(Boolean).join(' ')
  const itemRowClass = (item: DisplayItem): string => [
    'item-row',
    item.id === selectedId ? 'active' : '',
    item.visible === false ? 'hidden' : '',
    item.id === draggingItemId ? 'dragging' : '',
    itemDrop?.targetId === item.id ? `drop-${itemDrop.placement}` : ''
  ].filter(Boolean).join(' ')
  const menuProject = projectMenu ? projects.find((summary) => summary.id === projectMenu.projectId) ?? null : null

  return (
    <aside className="project-rail panel-surface">
      <div className="brand"><span className="brand-mark">U</span><span><b>{t('appName')}</b><small>{t('editor')}</small></span></div>
      <section className="panel-section grow">
        <div className="section-heading"><h2>{t('projects')}</h2><button className="icon-button" onClick={() => void create()} title={t('newProject')}><Icon name="plus" /></button></div>
        <div className="project-list">
          {projects.map((summary) => renamingProjectId === summary.id
            ? <div key={summary.id} className={`project-card editing${summary.id === project.id ? ' active' : ''}`}>
              <span className="project-thumb"><DisplayCaseGlyph /></span>
              <span className="project-card-editor">
                <input
                  className="project-card-name-input"
                  value={projectNameDraft}
                  aria-label={t('displayName')}
                  maxLength={80}
                  autoFocus
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => setProjectNameDraft(event.target.value)}
                  onBlur={() => void finishProjectRename(summary)}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      event.stopPropagation()
                      event.currentTarget.blur()
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      event.stopPropagation()
                      cancelProjectRename.current = true
                      event.currentTarget.blur()
                    }
                  }}
                />
                <small>{summary.itemCount} {t('items').toLowerCase()}</small>
              </span>
            </div>
            : <div
              key={summary.id}
              className={projectCardClass(summary.id)}
              data-reorder-project-id={summary.id}
            >
              <button
                type="button"
                className="project-card-main reorderable-row-main"
                title={`${t('dragToReorder')} · ${t('renameDisplayHint')}`}
                aria-current={summary.id === project.id ? 'true' : undefined}
                onPointerDown={(event) => beginPointerReorder(event, 'project', summary.id)}
                onPointerMove={updatePointerReorder}
                onPointerUp={endPointerReorder}
                onPointerCancel={cancelPointerReorder}
                onClick={(event) => {
                  if (suppressProjectClick.current) {
                    event.preventDefault()
                    return
                  }
                  if (event.detail !== 1) return
                  onInspect()
                  if (summary.id !== project.id) void activate(summary.id)
                }}
                onDoubleClick={() => beginProjectRename(summary)}
              >
                <span className="project-thumb"><DisplayCaseGlyph /></span>
                <span><b>{summary.name}</b><small>{summary.itemCount} {t('items').toLowerCase()}</small></span>
              </button>
              <button
                type="button"
                className={`project-menu-button${projectMenu?.projectId === summary.id ? ' open' : ''}`}
                title={t('displayActions', { name: summary.name })}
                aria-label={t('displayActions', { name: summary.name })}
                aria-haspopup="menu"
                aria-expanded={projectMenu?.projectId === summary.id}
                onDoubleClick={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  toggleProjectMenu(summary, event.currentTarget)
                }}
              ><Icon name="more" /></button>
            </div>)}
        </div>
        {projectMenu && menuProject && <div
          className="menu-popover project-menu-popover"
          ref={projectMenuRef}
          role="menu"
          style={{ left: projectMenu.left, top: projectMenu.top }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              setProjectMenu(null)
              window.requestAnimationFrame(() => projectMenuAnchorRef.current?.focus())
              return
            }
            moveMenuFocus(event)
          }}
        >
          <button type="button" className="menu-item" role="menuitem" onClick={() => beginProjectRename(menuProject)}>
            <Icon name="rename" /><span>{t('rename')}</span>
          </button>
          <button type="button" className="menu-item" role="menuitem" onClick={() => {
            setProjectMenu(null)
            void duplicate(menuProject.id)
          }}><Icon name="copy" /><span>{t('duplicate')}</span></button>
          <div className="menu-separator" role="separator" />
          <button type="button" className="menu-item danger" role="menuitem" disabled={menuProject.itemCount === 0} onClick={() => {
            setProjectMenu(null)
            if (window.confirm(t('clearConfirm'))) void clear(menuProject.id)
          }}><Icon name="clear" /><span>{t('clearDisplay')}</span></button>
          <button type="button" className="menu-item danger" role="menuitem" disabled={projects.length <= 1} onClick={() => {
            setProjectMenu(null)
            if (window.confirm(t('deleteConfirm'))) void remove(menuProject.id).catch(() => window.alert(t('lastProject')))
          }}><Icon name="trash" /><span>{t('delete')}</span></button>
        </div>}
      </section>
      <section className="panel-section item-list-section">
        <div className="section-heading">
          <span className="section-heading-title"><h2>{t('items')}</h2><span className="count-badge">{project.items.length}</span></span>
          <button
            type="button"
            className="icon-button"
            title={t('import')}
            aria-label={t('import')}
            onClick={() => void importAssets().catch(() => window.alert(t('importFailed')))}
          ><Icon name="plus" /></button>
        </div>
        <div className="item-list">
          <div className={`item-row case-row${selectedId === DISPLAY_CASE_SELECTION_ID ? ' active' : ''}${project.caseVisible === false ? ' hidden' : ''}`}>
            <button className="item-row-main" onClick={() => {
              onInspect()
              select(DISPLAY_CASE_SELECTION_ID)
            }}>
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
          {project.items.map((item) => (
            <div
              key={item.id}
              className={itemRowClass(item)}
              data-reorder-item-id={item.id}
            >
              <button
                className="item-row-main reorderable-row-main"
                title={t('dragToReorder')}
                onPointerDown={(event) => beginPointerReorder(event, 'item', item.id)}
                onPointerMove={updatePointerReorder}
                onPointerUp={endPointerReorder}
                onPointerCancel={cancelPointerReorder}
                onClick={(event) => {
                  if (suppressItemClick.current) {
                    event.preventDefault()
                    return
                  }
                onInspect()
                select(item.id)
              }}>
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

function SettingsPanel({ settings, project, onClose }: { settings: AppSettings; project: DisplayProject; onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const update = useAppStore((state) => state.updateSettings)
  const mutate = useAppStore((state) => state.mutateProject)
  const resetData = useAppStore((state) => state.resetData)
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
    <section className="settings-panel">
      <header className="settings-panel-header">
        <span><Icon name="settings" /><h2>{t('settings')}</h2></span>
        <button type="button" className="icon-button" title={t('closeSettings')} aria-label={t('closeSettings')} onClick={onClose}><Icon name="close" /></button>
      </header>
      <div className="settings-panel-body">
        <section className="settings-section">
          <h3>{t('settingsGeneral')}</h3>
          <label className="select-row"><span>{t('language')}</span><select value={settings.language} onChange={(event) => void update({ language: event.target.value as Language })}>{LANGUAGES.map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}</select></label>
          <label className="select-row"><span>{t('quality')}</span><select value={settings.quality} onChange={(event) => void update({ quality: event.target.value as QualityPreset })}>{(['low', 'balanced', 'high'] as QualityPreset[]).map((quality) => <option key={quality} value={quality}>{t(quality)}</option>)}</select></label>
        </section>
        <section className="settings-section">
          <h3>{t('settingsWidget')}</h3>
          <Toggle checked={settings.alwaysOnTop} label={t('alwaysOnTop')} onChange={(alwaysOnTop) => void update({ alwaysOnTop })} />
          <Toggle checked={settings.clickThrough} label={t('clickThrough')} hint={t('clickThroughHint')} onChange={(clickThrough) => void update({ clickThrough })} />
          <button className="widget-adjust-button" onClick={() => void window.unvirtual.setDisplayEditing(true)}>{t('adjustWidget')}</button>
          <h4>{t('widgetBackground')}</h4>
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
        </section>
        <section className="settings-section settings-diagnostics">
          <h3>{t('settingsDiagnostics')}</h3>
          <button className="diagnostics-button" onClick={() => void window.unvirtual.exportDiagnostics()}>{t('diagnostics')}</button>
        </section>
        <section className="settings-danger-zone">
          <h3>{t('dataManagement')}</h3>
          <p>{t('resetDataDescription')}</p>
          <button type="button" onClick={() => {
            if (window.confirm(t('resetDataConfirm'))) void resetData().then(onClose)
          }}><Icon name="reset" /><span>{t('resetData')}</span></button>
        </section>
      </div>
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
  const displayVisible = useAppStore((state) => state.displayVisible)
  const history = useAppStore((state) => state.history)
  const future = useAppStore((state) => state.future)
  const importAssets = useAppStore((state) => state.importAssets)
  const mutate = useAppStore((state) => state.mutateProject)
  const updateTransform = useAppStore((state) => state.updateItemTransform)
  const setSelected = useAppStore((state) => state.setSelectedItem)
  const setMode = useAppStore((state) => state.setTransformMode)
  const undo = useAppStore((state) => state.undo)
  const redo = useAppStore((state) => state.redo)
  const setDisplayVisible = useAppStore((state) => state.setDisplayVisible)
  const [draggingFiles, setDraggingFiles] = useState(false)
  const [cameraResetKey, setCameraResetKey] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const sceneViewRef = useRef<SceneViewHandle>(null)

  const selectedItem = useMemo(() => project?.items.find((item) => item.id === selectedId) ?? null, [project, selectedId])
  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (document.querySelector('[role="menu"], [role="listbox"]')) return
        event.preventDefault()
        if (settingsOpen) {
          setSettingsOpen(false)
          return
        }
        setSelected(null)
        return
      }
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
  }, [mutate, redo, selectedId, setMode, setSelected, settingsOpen, undo])

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
      <ProjectRail project={project} projects={projects} onInspect={() => setSettingsOpen(false)} />
      <section className="workspace">
        <header className="toolbar panel-surface">
          <div className="tool-group segmented">
            {(['translate', 'rotate', 'scale'] as TransformMode[]).map((mode) => <button key={mode} className={transformMode === mode ? 'active' : ''} onClick={() => setMode(mode)}>{t(mode === 'scale' ? 'resize' : mode)}</button>)}
          </div>
          <div className="tool-group">
            <button className="icon-button" disabled={!history.length} title={t('undo')} onClick={undo}><Icon name="undo" /></button>
            <button className="icon-button" disabled={!future.length} title={t('redo')} onClick={redo}><Icon name="redo" /></button>
          </div>
          <DisplayFileMenu />
          <CasePresetControl
            value={project.casePreset}
            label={t('displayCase')}
            getName={(preset) => t(preset)}
            onChange={changeCase}
          />
          <span className={`save-status ${saveStatus}`}>{saveStatus === 'saving' ? t('saving') : t('saved')}</span>
          <button
            type="button"
            className={`icon-button display-visibility-button${displayVisible ? ' visible' : ''}`}
            title={t(displayVisible ? 'hideWidget' : 'showWidget')}
            aria-label={t(displayVisible ? 'hideWidget' : 'showWidget')}
            aria-pressed={displayVisible}
            onClick={() => void setDisplayVisible(!displayVisible)}
          ><Icon name={displayVisible ? 'monitor' : 'monitorOff'} /></button>
          <button className="icon-button capture-button" onClick={saveCapture} title={t('capture')} aria-label={t('capture')}><Icon name="camera" /></button>
          <button
            type="button"
            className={`icon-button settings-button${settingsOpen ? ' active' : ''}`}
            title={t('settings')}
            aria-label={t('settings')}
            aria-pressed={settingsOpen}
            onClick={() => setSettingsOpen((open) => !open)}
          ><Icon name="settings" /></button>
        </header>
        <div
          className={draggingFiles ? 'scene-stage file-dragging' : 'scene-stage'}
          onDragEnter={(event) => {
            if (!isFileDrag(event)) return
            event.preventDefault()
            setDraggingFiles(true)
          }}
          onDragOver={(event) => { if (isFileDrag(event)) event.preventDefault() }}
          onDragLeave={(event) => { if (event.currentTarget === event.target) setDraggingFiles(false) }}
          onDrop={(event) => {
            if (!isFileDrag(event)) return
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
            onSelect={(id) => {
              setSettingsOpen(false)
              setSelected(id)
            }}
            onTransform={updateTransform}
            onCamera={(camera) => mutate((draft) => { draft.camera = camera }, false)}
            cameraResetKey={cameraResetKey}
            onResetCamera={settings.onboardingComplete ? resetCamera : undefined}
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
            horizontalLabel={t('lightAzimuth')}
            horizontalHint={t('lightAzimuthHint')}
            heightLabel={t('lightElevation')}
            heightHint={t('lightElevationHint')}
            heightMapHint={t('lightElevationMapHint')}
            frontLabel={t('front')}
            rightLabel={t('right')}
            backLabel={t('back')}
            leftLabel={t('left')}
            hint={t('lightDirectionHint')}
            resetLabel={t('resetLightDirection')}
            resetText={t('resetDisplay')}
            onChange={(azimuth, elevation) => mutate((draft) => {
              draft.lighting.azimuth = azimuth
              draft.lighting.elevation = elevation
            }, false)}
          />
          <Toggle checked={project.lighting.shadows} label={t('shadows')} onChange={(shadows) => mutate((draft) => { draft.lighting.shadows = shadows })} />
        </footer>
      </section>
      <aside className="inspector panel-surface">
        {settingsOpen
          ? <SettingsPanel settings={settings} project={project} onClose={() => setSettingsOpen(false)} />
          : <Inspector item={selectedItem} project={project} caseSelected={selectedId === DISPLAY_CASE_SELECTION_ID} />}
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
