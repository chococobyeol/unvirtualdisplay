import { describe, expect, it } from 'vitest'
import { CASE_PRESETS } from '../../shared/types'
import {
  createCatalogItem,
  entriesForCategory,
  OBJECT_CATALOG,
  OBJECT_LIBRARY_CATEGORIES
} from './objectCatalog'

describe('object catalog', () => {
  it('uses the agreed categories in a stable order', () => {
    expect(OBJECT_LIBRARY_CATEGORIES).toEqual([
      'all', 'displayCases', 'acrylicCases', 'risers', 'shelvesParts'
    ])
  })

  it('offers every existing display case as its own card', () => {
    const cases = entriesForCategory('displayCases')

    expect(cases).toHaveLength(9)
    expect(cases.map((entry) => entry.builtin.casePreset)).toEqual(CASE_PRESETS.filter((preset) => preset !== 'custom'))
  })

  it('offers the visible case and step variants directly in the library', () => {
    expect(entriesForCategory('acrylicCases').map((entry) => entry.builtin.acrylicCaseVariant)).toEqual([
      'low', 'standard', 'tall'
    ])
    expect(entriesForCategory('risers').filter((entry) => entry.builtin.type === 'acrylicSteps').map((entry) => entry.builtin.steps)).toEqual([
      2, 3, 4, 5
    ])
  })

  it('shows one category at a time while all remains a flat filter', () => {
    for (const category of OBJECT_LIBRARY_CATEGORIES.slice(1)) {
      expect(entriesForCategory(category).every((entry) => entry.category === category)).toBe(true)
    }
    expect(entriesForCategory('all')).toEqual(OBJECT_CATALOG)
  })

  it('creates every built-in as an unlocked gravity-driven item by default', () => {
    for (const entry of OBJECT_CATALOG) {
      const item = createCatalogItem(entry, entry.id, entry.nameKey)
      expect(item.physics).toEqual({
        collision: true,
        preventToppling: true,
        placementLocked: false
      })
      expect(item.builtin).toEqual(entry.builtin)
    }
  })
})
