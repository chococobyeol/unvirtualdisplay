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

  it('migrates the previous five preset values without losing their appearance', () => {
    expect(normalizeCasePreset('oneTier')).toBe('modern1')
    expect(normalizeCasePreset('twoTier')).toBe('modern2')
    expect(normalizeCasePreset('gallery')).toBe('modern3')
    expect(normalizeCasePreset('glass')).toBe('glass3')
    expect(normalizeCasePreset('warm')).toBe('wood3')
  })
})
