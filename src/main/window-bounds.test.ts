import { describe, expect, it } from 'vitest'
import { getDefaultDisplayBounds } from './window-bounds'

describe('getDefaultDisplayBounds', () => {
  it('places a compact widget in the bottom-right of a laptop work area', () => {
    expect(getDefaultDisplayBounds({ x: 0, y: 25, width: 1366, height: 743 })).toEqual({
      x: 1022,
      y: 504,
      width: 320,
      height: 240
    })
  })

  it('caps the initial widget size on a wide display', () => {
    expect(getDefaultDisplayBounds({ x: 0, y: 0, width: 1920, height: 1040 })).toEqual({
      x: 1476,
      y: 701,
      width: 420,
      height: 315
    })
  })

  it('respects an offset multi-monitor work area', () => {
    expect(getDefaultDisplayBounds({ x: -1920, y: 120, width: 1920, height: 1040 })).toEqual({
      x: -444,
      y: 821,
      width: 420,
      height: 315
    })
  })
})
