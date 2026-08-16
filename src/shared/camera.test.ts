import { describe, expect, it } from 'vitest'
import { cameraSettingsEqual } from './camera'
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
