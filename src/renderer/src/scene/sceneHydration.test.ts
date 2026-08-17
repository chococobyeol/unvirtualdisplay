import { describe, expect, it } from 'vitest'
import { isPhysicsSceneHydrated, restoredItemSupportPriority } from './sceneHydration'

describe('physics scene hydration', () => {
  it('allows an empty display to begin immediately', () => {
    expect(isPhysicsSceneHydrated([], [], [])).toBe(true)
  })

  it('does not advance while an asynchronous image or model is still loading', () => {
    expect(isPhysicsSceneHydrated(
      ['case', 'image', 'steps'],
      ['case', 'steps'],
      ['image']
    )).toBe(false)
  })

  it('does not advance during the gap between removing a pending token and installing its runtime item', () => {
    expect(isPhysicsSceneHydrated(
      ['case', 'image', 'steps'],
      ['case', 'steps'],
      []
    )).toBe(false)
  })

  it('starts only after every expected item has a runtime object', () => {
    expect(isPhysicsSceneHydrated(
      ['case', 'image', 'steps'],
      ['case', 'image', 'steps'],
      []
    )).toBe(true)
  })

  it('rejects a stale runtime item left over from another project', () => {
    expect(isPhysicsSceneHydrated(
      ['new-case'],
      ['new-case', 'old-figure'],
      []
    )).toBe(false)
  })

  it('repairs contents before supports regardless of layer order', () => {
    expect([
      restoredItemSupportPriority({ kind: 'image' }),
      restoredItemSupportPriority({ kind: 'builtin', builtin: { type: 'pedestal' } }),
      restoredItemSupportPriority({ kind: 'builtin', builtin: { type: 'acrylicCase' } })
    ]).toEqual([2, 1, 0])
  })
})
