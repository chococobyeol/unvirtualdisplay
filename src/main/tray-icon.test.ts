import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveWindowsTrayIconPath } from './tray-icon'

describe('resolveWindowsTrayIconPath', () => {
  it('uses the extra resource in a packaged application', () => {
    expect(resolveWindowsTrayIconPath(true, '/application', '/application/resources')).toBe(
      join('/application/resources', 'tray-icon.ico')
    )
  })

  it('uses the build icon during development', () => {
    expect(resolveWindowsTrayIconPath(false, '/workspace', '/electron/resources')).toBe(
      join('/workspace', 'build', 'icon.ico')
    )
  })
})
