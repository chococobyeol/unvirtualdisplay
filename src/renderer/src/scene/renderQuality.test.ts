import { describe, expect, it } from 'vitest'
import { renderPixelRatio, renderQualitySettings, renderShadowsEnabled } from './renderQuality'

describe('render quality settings', () => {
  it('keeps every preset distinct without requiring a renderer restart', () => {
    expect(renderQualitySettings('low')).toEqual({
      pixelRatioLimit: 1,
      shadowMapSize: 1024,
      shadowsEnabled: false
    })
    expect(renderQualitySettings('balanced')).toEqual({
      pixelRatioLimit: 1.5,
      shadowMapSize: 1024,
      shadowsEnabled: true
    })
    expect(renderQualitySettings('high')).toEqual({
      pixelRatioLimit: 2,
      shadowMapSize: 2048,
      shadowsEnabled: true
    })
  })

  it('caps the live pixel ratio for each preset', () => {
    expect(renderPixelRatio('low', 2)).toBe(1)
    expect(renderPixelRatio('balanced', 2)).toBe(1.5)
    expect(renderPixelRatio('high', 2)).toBe(2)
    expect(renderPixelRatio('high', 1)).toBe(1)
  })

  it('requires both the project and preset to allow shadows', () => {
    expect(renderShadowsEnabled('low', true)).toBe(false)
    expect(renderShadowsEnabled('balanced', true)).toBe(true)
    expect(renderShadowsEnabled('high', false)).toBe(false)
  })
})
