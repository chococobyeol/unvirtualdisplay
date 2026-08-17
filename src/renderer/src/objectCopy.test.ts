import { describe, expect, it } from 'vitest'
import { resources } from './i18n'
import { OBJECT_CATALOG, OBJECT_LIBRARY_CATEGORIES } from './objectCatalog'

const categoryKeys = {
  all: 'objectCategoryAll',
  displayCases: 'objectCategoryDisplayCases',
  acrylicCases: 'objectCategoryAcrylicCases',
  risers: 'objectCategoryRisers',
  shelvesParts: 'objectCategoryShelvesParts'
} as const

describe('object catalog copy', () => {
  it('has names, factual descriptions, and category labels in every supported language', () => {
    for (const locale of Object.keys(resources) as (keyof typeof resources)[]) {
      const translation = resources[locale].translation as Record<string, string>
      for (const category of OBJECT_LIBRARY_CATEGORIES) {
        expect(translation[categoryKeys[category]], `${locale}:${category}`).toBeTruthy()
      }
      for (const entry of OBJECT_CATALOG) {
        expect(translation[entry.nameKey], `${locale}:${entry.nameKey}`).toBeTruthy()
        expect(translation[entry.descriptionKey], `${locale}:${entry.descriptionKey}`).toBeTruthy()
      }
    }
  })

  it('does not use the rejected generic Korean placement phrases', () => {
    const translation = resources.ko.translation as Record<string, string>
    const catalogCopy = OBJECT_CATALOG.flatMap((entry) => [
      translation[entry.nameKey], translation[entry.descriptionKey]
    ]).join(' ')

    expect(catalogCopy).not.toMatch(/자유롭게|필요한 만큼|보기 좋은|멋지게/)
  })
})
