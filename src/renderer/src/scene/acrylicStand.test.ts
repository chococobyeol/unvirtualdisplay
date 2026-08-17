import { describe, expect, it } from 'vitest'
import {
  acrylicOffsetPixelRadius,
  acrylicStandBaseDimensions,
  clampAcrylicOffset,
  DEFAULT_ACRYLIC_OFFSET
} from './acrylicStand'

describe('acrylic stand offset', () => {
  it('allows a zero offset so the acrylic can sit flush with its base', () => {
    expect(clampAcrylicOffset(0)).toBe(0)
    expect(acrylicOffsetPixelRadius(0, 100)).toBe(0)
  })

  it('keeps offset values inside the supported range', () => {
    expect(clampAcrylicOffset(-0.01)).toBe(0)
    expect(clampAcrylicOffset(0.2)).toBe(0.12)
    expect(clampAcrylicOffset(Number.NaN)).toBe(DEFAULT_ACRYLIC_OFFSET)
  })

  it('converts a visible offset to pixels without exceeding the texture limit', () => {
    expect(acrylicOffsetPixelRadius(0.045, 100)).toBe(5)
    expect(acrylicOffsetPixelRadius(0.12, 1000)).toBe(48)
  })
})

describe('acrylic stand base proportions', () => {
  it('uses the shallow oval ratio of a typical character acrylic stand', () => {
    const base = acrylicStandBaseDimensions(0.885)

    expect(base.width / 0.885).toBeCloseTo(0.65)
    expect(base.depth / base.width).toBeCloseTo(0.55)
    expect(base.height).toBe(0.045)
  })

  it('keeps a narrow character stable without returning to a circular base', () => {
    const base = acrylicStandBaseDimensions(0.3)

    expect(base.width).toBe(0.36)
    expect(base.depth).toBe(0.2)
    expect(base.depth).toBeLessThan(base.width)
  })

  it('scales a wide stand base without making its front-to-back depth equal its width', () => {
    const base = acrylicStandBaseDimensions(1.8)

    expect(base.width).toBeCloseTo(1.17)
    expect(base.depth).toBeCloseTo(0.6435)
    expect(base.depth).toBeLessThan(base.width * 0.6)
  })
})
