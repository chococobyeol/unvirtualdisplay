import { describe, expect, it } from 'vitest'
import { CASE_PRESETS, CASE_PRESET_META, normalizeCasePreset } from '../../../shared/types'
import { getCaseLayout } from './caseLayout'

describe('getCaseLayout', () => {
  it('builds compact one-tier and two-tier cases', () => {
    const oneTier = getCaseLayout('modern1')
    const twoTier = getCaseLayout('modern2')
    const threeTier = getCaseLayout('modern3')

    expect(oneTier.shelfHeights).toEqual([])
    expect(twoTier.shelfHeights).toEqual([1.42])
    expect(threeTier.shelfHeights).toEqual([1.42, 2.78])
    expect(oneTier.topHeight).toBeLessThan(twoTier.topHeight)
    expect(twoTier.topHeight).toBeLessThan(threeTier.topHeight)
  })

  it('provides every style in one, two, and three tiers', () => {
    for (const preset of CASE_PRESETS) {
      expect(getCaseLayout(preset).tierCount).toBe(CASE_PRESET_META[preset].tier)
    }
  })

  it('provides a floor-level freeform workspace without a primary case', () => {
    const freeform = getCaseLayout('custom')

    expect(freeform.tierCount).toBe(0)
    expect(freeform.shelfHeights).toEqual([])
    expect(freeform.placementSurfaces).toEqual([0])
  })

  it('uses each acrylic case base and interior dimensions for placement', () => {
    const low = getCaseLayout('acrylicCaseLow')
    const standard = getCaseLayout('acrylicCaseStandard')
    const tall = getCaseLayout('acrylicCaseTall')

    expect(low.placementSurfaces).toEqual([0.12])
    expect(standard.placementSurfaces).toEqual([0.12])
    expect(tall.placementSurfaces).toEqual([0.12])
    expect(low.placementBounds.maxX).toBeGreaterThan(standard.placementBounds.maxX)
    expect(standard.placementBounds.maxX).toBeGreaterThan(tall.placementBounds.maxX)
    expect(low.cameraOffsetY).toBeLessThan(standard.cameraOffsetY)
    expect(standard.cameraOffsetY).toBeLessThan(tall.cameraOffsetY)
  })

  it('migrates the previous five preset values without losing their appearance', () => {
    expect(normalizeCasePreset('custom')).toBe('custom')
    expect(normalizeCasePreset('oneTier')).toBe('modern1')
    expect(normalizeCasePreset('twoTier')).toBe('modern2')
    expect(normalizeCasePreset('gallery')).toBe('modern3')
    expect(normalizeCasePreset('glass')).toBe('glass3')
    expect(normalizeCasePreset('warm')).toBe('wood3')
    expect(normalizeCasePreset('acrylicCaseStandard')).toBe('acrylicCaseStandard')
  })
})
