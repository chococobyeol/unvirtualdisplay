import { describe, expect, it } from 'vitest'
import { getDefaultDisplayBounds, recoverDisplayBounds } from './window-bounds'

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

describe('recoverDisplayBounds', () => {
  const primary = { x: 0, y: 25, width: 1366, height: 743 }
  const secondary = { x: -1920, y: 120, width: 1920, height: 1040 }

  it('preserves a saved position that intersects any current monitor', () => {
    const saved = { x: -400, y: 180, width: 420, height: 315 }
    expect(recoverDisplayBounds(saved, [primary, secondary], primary)).toEqual(saved)
  })

  it('preserves deliberately partial off-screen placement', () => {
    const saved = { x: 1350, y: 600, width: 420, height: 315 }
    expect(recoverDisplayBounds(saved, [primary], primary)).toEqual(saved)
  })

  it('moves a fully unreachable widget back to the primary monitor', () => {
    expect(recoverDisplayBounds({ x: 3000, y: 200, width: 420, height: 315 }, [primary, secondary], primary)).toEqual(
      getDefaultDisplayBounds(primary)
    )
  })
})
