import { describe, expect, it } from 'vitest'
import { cameraSettingsEqual, shouldApplySyncedCamera } from './camera'
import { createDefaultCameraSettings } from './types'

describe('cameraSettingsEqual', () => {
  it('accepts an unchanged camera', () => {
    const camera = createDefaultCameraSettings()
    expect(cameraSettingsEqual(camera, structuredClone(camera))).toBe(true)
  })

  it('detects a camera rotation or pan', () => {
    const current = createDefaultCameraSettings()
    const incoming = structuredClone(current)
    incoming.position.x += 0.5
    incoming.target.y += 0.25
    expect(cameraSettingsEqual(current, incoming)).toBe(false)
  })

  it('detects a camera zoom', () => {
    const current = createDefaultCameraSettings()
    const incoming = structuredClone(current)
    incoming.position.z -= 1
    expect(cameraSettingsEqual(current, incoming)).toBe(false)
  })
})

describe('shouldApplySyncedCamera', () => {
  it('applies an incoming camera while idle', () => {
    const current = createDefaultCameraSettings()
    const incoming = structuredClone(current)
    incoming.position.x += 1
    expect(shouldApplySyncedCamera(current, incoming, false)).toBe(true)
  })

  it('does not restore a stale saved camera during a local interaction', () => {
    const saved = createDefaultCameraSettings()
    const locallyDragged = structuredClone(saved)
    locallyDragged.position.x += 1
    expect(shouldApplySyncedCamera(locallyDragged, saved, true)).toBe(false)
  })

  it('does not reapply an unchanged camera', () => {
    const current = createDefaultCameraSettings()
    expect(shouldApplySyncedCamera(current, structuredClone(current), false)).toBe(false)
  })
})
