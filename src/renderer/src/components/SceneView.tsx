import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { House } from 'lucide-react'
import type { CameraSettings, DisplayProject, QualityPreset, TransformMode, TransformState } from '../../../shared/types'
import { SceneRuntime } from '../scene/SceneRuntime'

interface SceneViewProps {
  project: DisplayProject
  quality: QualityPreset
  variant: 'editor' | 'display'
  selectedItemId?: string | null
  transformMode?: TransformMode
  onSelect?: (id: string | null) => void
  onTransform?: (id: string, transform: TransformState, remember?: boolean) => void
  onCamera?: (camera: CameraSettings) => void
  cameraResetKey?: number
  onResetCamera?: () => void
  resetCameraLabel?: string
}

export interface SceneViewHandle {
  capture: () => Promise<Blob | null>
}

export const SceneView = forwardRef<SceneViewHandle, SceneViewProps>(function SceneView({ project, quality, variant, selectedItemId = null, transformMode = 'translate', onSelect, onTransform, onCamera, cameraResetKey = 0, onResetCamera, resetCameraLabel }, ref): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const runtimeRef = useRef<SceneRuntime | null>(null)
  const projectRef = useRef(project)
  const callbacksRef = useRef({ onSelect, onTransform, onCamera })

  projectRef.current = project
  callbacksRef.current = { onSelect, onTransform, onCamera }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    const runtime = new SceneRuntime(canvas, variant, quality, {
      onSelect: (id) => callbacksRef.current.onSelect?.(id),
      onTransform: (id, transform, remember) => callbacksRef.current.onTransform?.(id, transform, remember),
      onCameraPreview: (camera) => window.unvirtual.previewCamera({ projectId: projectRef.current.id, camera }),
      onCamera: (camera) => callbacksRef.current.onCamera?.(camera)
    })
    runtimeRef.current = runtime
    void runtime.initialize().then(() => {
      if (cancelled) return
      runtime.setSelection(selectedItemId)
      runtime.setTransformMode(transformMode)
      void runtime.syncProject(projectRef.current)
    })
    return () => {
      cancelled = true
      runtime.dispose()
      runtimeRef.current = null
    }
  }, [variant])

  useEffect(() => { void runtimeRef.current?.syncProject(project) }, [project])
  useEffect(() => window.unvirtual.onCameraPreview(({ projectId, camera }) => {
    if (projectId === projectRef.current.id) runtimeRef.current?.syncCamera(camera)
  }), [])
  useEffect(() => runtimeRef.current?.setSelection(selectedItemId), [selectedItemId])
  useEffect(() => runtimeRef.current?.setTransformMode(transformMode), [transformMode])
  useEffect(() => runtimeRef.current?.setQuality(quality), [quality])
  useEffect(() => {
    if (cameraResetKey > 0) runtimeRef.current?.setCamera(project.camera)
  }, [cameraResetKey])
  useImperativeHandle(ref, () => ({
    capture: () => runtimeRef.current?.capture() ?? Promise.resolve(null)
  }), [])

  return (
    <>
      <canvas ref={canvasRef} className="scene-canvas" tabIndex={variant === 'editor' ? 0 : -1} />
      {variant === 'editor' && onResetCamera && <button
        type="button"
        className="view-home-button"
        title={resetCameraLabel}
        aria-label={resetCameraLabel}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onResetCamera}
      ><House aria-hidden="true" /></button>}
    </>
  )
})
