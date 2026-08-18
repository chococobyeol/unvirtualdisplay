import { describe, expect, it } from 'vitest'
import { shouldRecoverDisplayPointer, toDisplayClientPoint } from './display-pointer'

describe('toDisplayClientPoint', () => {
  const bounds = { x: 100, y: 200, width: 320, height: 240 }

  it('converts a screen point inside the widget to client coordinates', () => {
    expect(toDisplayClientPoint({ x: 132, y: 248 }, bounds)).toEqual({ x: 32, y: 48 })
  })

  it('includes the top-left pixel and excludes the bottom-right boundary', () => {
    expect(toDisplayClientPoint({ x: 100, y: 200 }, bounds)).toEqual({ x: 0, y: 0 })
    expect(toDisplayClientPoint({ x: 420, y: 440 }, bounds)).toBeNull()
  })

  it('rejects points outside the widget', () => {
    expect(toDisplayClientPoint({ x: 99, y: 220 }, bounds)).toBeNull()
    expect(toDisplayClientPoint({ x: 120, y: 199 }, bounds)).toBeNull()
  })
})

describe('shouldRecoverDisplayPointer', () => {
  const interactiveWindowsState = {
    platform: 'win32' as const,
    pointerIgnored: true,
    editing: false,
    clickThrough: false,
    visible: true
  }

  it('recovers an automatically ignored Windows widget', () => {
    expect(shouldRecoverDisplayPointer(interactiveWindowsState)).toBe(true)
  })

  it('never recovers while full click-through is enabled', () => {
    expect(shouldRecoverDisplayPointer({ ...interactiveWindowsState, clickThrough: true })).toBe(false)
  })

  it('does not poll while editing, hidden, interactive, or on another platform', () => {
    expect(shouldRecoverDisplayPointer({ ...interactiveWindowsState, editing: true })).toBe(false)
    expect(shouldRecoverDisplayPointer({ ...interactiveWindowsState, visible: false })).toBe(false)
    expect(shouldRecoverDisplayPointer({ ...interactiveWindowsState, pointerIgnored: false })).toBe(false)
    expect(shouldRecoverDisplayPointer({ ...interactiveWindowsState, platform: 'darwin' })).toBe(false)
  })
})
