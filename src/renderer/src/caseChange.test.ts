import { describe, expect, it, vi } from 'vitest'
import { approveCaseChange } from './caseChange'

describe('approveCaseChange', () => {
  it('changes an empty display without showing a confirmation', () => {
    const confirmChange = vi.fn(() => false)

    expect(approveCaseChange(0, confirmChange)).toBe(true)
    expect(confirmChange).not.toHaveBeenCalled()
  })

  it('requires approval when the display contains items', () => {
    expect(approveCaseChange(1, () => true)).toBe(true)
    expect(approveCaseChange(1, () => false)).toBe(false)
  })
})
