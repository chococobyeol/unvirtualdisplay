/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const rootPath = (...segments: string[]): string => resolve(process.cwd(), ...segments)
const styles = readFileSync(rootPath('src/renderer/src/styles.css'), 'utf8')

describe('bundled UI typography', () => {
  it.each([
    ['InterVariable.woff2', 'wOF2'],
    ['NotoSansKR-VF.otf', 'OTTO'],
    ['NotoSansJP-VF.otf', 'OTTO'],
    ['NotoSansSC-VF.otf', 'OTTO']
  ])('ships a valid %s font file', (fileName, signature) => {
    const font = readFileSync(rootPath('src/renderer/src/assets/fonts', fileName))
    expect(font.subarray(0, 4).toString('ascii')).toBe(signature)
  })

  it('selects the bundled font that matches each supported writing system', () => {
    expect(styles).toContain(":root:lang(ko) { --font-ui: 'Noto Sans KR'")
    expect(styles).toContain(":root:lang(ja) { --font-ui: 'Noto Sans JP'")
    expect(styles).toContain(":root:lang(zh) { --font-ui: 'Noto Sans SC'")
    expect(styles).toContain("--font-ui: 'Inter'")
  })

  it('reserves explicit line boxes for two-line list rows', () => {
    expect(styles).toContain(".project-card b, .item-row b { min-height: 17px;")
    expect(styles).toContain(".project-card small, .item-row small { min-height: 14px;")
    expect(styles).toContain('.project-card { position: relative; height: 50px;')
    expect(styles).toContain('.item-row-main { flex: 1; min-width: 0; height: 34px;')
  })

  it('keeps complete font license texts with the distributable sources', () => {
    const interLicense = readFileSync(rootPath('licenses/fonts/Inter-OFL-1.1.txt'), 'utf8')
    const notoLicense = readFileSync(rootPath('licenses/fonts/Noto-CJK-OFL-1.1.txt'), 'utf8')

    expect(interLicense).toContain('SIL OPEN FONT LICENSE Version 1.1')
    expect(notoLicense).toContain('SIL OPEN FONT LICENSE Version 1.1')
  })
})
