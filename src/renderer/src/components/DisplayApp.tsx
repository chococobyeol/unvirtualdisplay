import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { DisplayResizeEdge } from '../../../shared/types'
import { SceneView } from './SceneView'
import { useAppStore } from '../store'

export function DisplayApp(): React.JSX.Element | null {
  const { t } = useTranslation()
  const project = useAppStore((state) => state.project)
  const settings = useAppStore((state) => state.settings)
  const mutate = useAppStore((state) => state.mutateProject)
  const [editing, setEditing] = useState(false)
  const lastIgnored = useRef<boolean | null>(null)

  useEffect(() => window.unvirtual.onDisplayEditingChanged(setEditing), [])

  useEffect(() => {
    if (!project || !settings || settings.clickThrough || editing) return
    let frame = 0
    let latestPoint: { clientX: number; clientY: number; buttons: number } | null = null
    const setIgnored = (ignored: boolean): void => {
      if (lastIgnored.current === ignored) return
      lastIgnored.current = ignored
      window.unvirtual.setDisplayPointerIgnored(ignored)
    }
    const sample = (): void => {
      frame = 0
      const point = latestPoint
      const canvas = document.querySelector<HTMLCanvasElement>('.display-shell .scene-canvas')
      if (!point || !canvas) return
      if (point.buttons !== 0) {
        setIgnored(false)
        return
      }
      if (project.background.mode !== 'transparent') {
        setIgnored(false)
        return
      }
      const context = canvas.getContext('webgl2')
      if (!context) {
        setIgnored(false)
        return
      }
      const bounds = canvas.getBoundingClientRect()
      const x = Math.max(0, Math.min(canvas.width - 1, Math.floor((point.clientX - bounds.left) * canvas.width / bounds.width)))
      const y = Math.max(0, Math.min(canvas.height - 1, Math.floor((bounds.bottom - point.clientY) * canvas.height / bounds.height)))
      const pixel = new Uint8Array(4)
      context.readPixels(x, y, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel)
      setIgnored(pixel[3] < 12)
    }
    const queueSample = (point: { clientX: number; clientY: number; buttons: number }): void => {
      latestPoint = point
      if (!frame) frame = requestAnimationFrame(sample)
    }
    const handleMove = (event: MouseEvent): void => queueSample(event)
    if (project.background.mode !== 'transparent') {
      lastIgnored.current = false
      window.unvirtual.setDisplayPointerIgnored(false)
      return
    }
    const removePointerPositionListener = window.unvirtual.onDisplayPointerPosition((point) => {
      queueSample({ clientX: point.x, clientY: point.y, buttons: 0 })
    })
    window.addEventListener('mousemove', handleMove, { passive: true })
    return () => {
      window.removeEventListener('mousemove', handleMove)
      removePointerPositionListener()
      if (frame) cancelAnimationFrame(frame)
      lastIgnored.current = null
    }
  }, [editing, project?.background.mode, settings?.clickThrough])

  useEffect(() => {
    if (!settings || settings.clickThrough) return
    let resetTimer = 0
    let secondaryClick: {
      x: number
      y: number
      moved: boolean
      released: boolean
      menuRequested: boolean
      shown: boolean
    } | null = null

    const reset = (): void => {
      secondaryClick = null
      if (resetTimer) window.clearTimeout(resetTimer)
      resetTimer = 0
    }
    const showIfReady = (): void => {
      if (!secondaryClick || secondaryClick.shown || secondaryClick.moved || !secondaryClick.released || !secondaryClick.menuRequested) return
      secondaryClick.shown = true
      window.unvirtual.showDisplayContextMenu()
    }
    const handlePointerDown = (event: PointerEvent): void => {
      if (event.button !== 2) return
      reset()
      secondaryClick = {
        x: event.screenX,
        y: event.screenY,
        moved: false,
        released: false,
        menuRequested: false,
        shown: false
      }
    }
    const handlePointerMove = (event: PointerEvent): void => {
      if (!secondaryClick || secondaryClick.moved) return
      const dx = event.screenX - secondaryClick.x
      const dy = event.screenY - secondaryClick.y
      if (dx * dx + dy * dy > 36) secondaryClick.moved = true
    }
    const handlePointerUp = (event: PointerEvent): void => {
      if (event.button !== 2 || !secondaryClick) return
      secondaryClick.released = true
      showIfReady()
      resetTimer = window.setTimeout(reset, 500)
    }
    const handlePointerCancel = (event: PointerEvent): void => {
      if (event.button === 2) reset()
    }
    const handleContextMenu = (event: MouseEvent): void => {
      event.preventDefault()
      if (!secondaryClick) {
        window.unvirtual.showDisplayContextMenu()
        return
      }
      secondaryClick.menuRequested = true
      showIfReady()
    }

    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('pointermove', handlePointerMove, true)
    window.addEventListener('pointerup', handlePointerUp, true)
    window.addEventListener('pointercancel', handlePointerCancel, true)
    window.addEventListener('contextmenu', handleContextMenu, true)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('pointermove', handlePointerMove, true)
      window.removeEventListener('pointerup', handlePointerUp, true)
      window.removeEventListener('pointercancel', handlePointerCancel, true)
      window.removeEventListener('contextmenu', handleContextMenu, true)
      reset()
    }
  }, [settings?.clickThrough])

  if (!project || !settings) return null

  const backgroundStyle: CSSProperties = (() => {
    const background = project.background
    if (background.mode === 'transparent') return { background: 'transparent' }
    if (background.mode === 'solid') return { backgroundColor: background.color }
    return {
      backgroundColor: '#000000',
      backgroundImage: background.imageUrl ? `url("${background.imageUrl}")` : undefined,
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      backgroundSize: background.fit
    }
  })()

  const toggleEditing = (): void => {
    if (!editing && settings.clickThrough) return
    void window.unvirtual.setDisplayEditing(!editing)
  }

  const beginResize = (edge: DisplayResizeEdge, event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    const handle = event.currentTarget
    const pointerId = event.pointerId
    handle.setPointerCapture(pointerId)
    const move = (pointer: PointerEvent): void => window.unvirtual.updateDisplayResize({ x: pointer.screenX, y: pointer.screenY })
    const finish = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
      window.unvirtual.endDisplayResize()
    }
    window.unvirtual.startDisplayResize(edge, { x: event.screenX, y: event.screenY })
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const beginMove = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    const handle = event.currentTarget
    const pointerId = event.pointerId
    handle.setPointerCapture(pointerId)
    const move = (pointer: PointerEvent): void => window.unvirtual.updateDisplayMove({ x: pointer.screenX, y: pointer.screenY })
    const finish = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
      window.unvirtual.endDisplayMove()
    }
    window.unvirtual.startDisplayMove({ x: event.screenX, y: event.screenY })
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  return (
    <main className={editing ? 'display-shell editing' : 'display-shell'} style={backgroundStyle} onPointerDown={beginMove} onDoubleClick={toggleEditing}>
      <SceneView
        project={project}
        quality={settings.quality}
        variant="display"
        onCamera={(camera) => mutate((draft) => { draft.camera = camera }, false)}
      />
      {editing && <section className="widget-adjust-frame">
        <button className="widget-adjust-done" onClick={() => void window.unvirtual.setDisplayEditing(false)}>{t('done')}</button>
        {(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as DisplayResizeEdge[]).map((edge) => (
          <div key={edge} className={`widget-resize-handle ${edge}`} onPointerDown={(event) => beginResize(edge, event)} />
        ))}
      </section>}
    </main>
  )
}
