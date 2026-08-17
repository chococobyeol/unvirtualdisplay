import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ObjectLibraryCategoryView, ObjectLibraryEntryView } from './ObjectLibrary'
import { ObjectLibrary } from './ObjectLibrary'

const categories: ObjectLibraryCategoryView[] = [
  { id: 'all', label: 'All' },
  { id: 'displayCases', label: 'Display cases' },
  { id: 'risers', label: 'Stands & steps' },
  { id: 'shelvesParts', label: 'Shelves & parts' }
]

const entries: ObjectLibraryEntryView[] = [
  { id: 'case-modern1', name: 'Modern · 1 tier', description: '1-tier case with a back panel', preview: '/modern1.jpg', group: 'Shelving cases' },
  { id: 'case-modern2', name: 'Modern · 2 tiers', description: '2-tier case with a back panel', preview: '/modern2.jpg', group: 'Shelving cases' },
  { id: 'case-acrylic', name: 'Acrylic case · Low', description: 'Wide, low clear case', preview: '/acrylic.jpg', group: 'Acrylic cases' }
]

function renderLibrary(activeCategory: ObjectLibraryCategoryView['id'], visibleEntries = entries): string {
  return renderToStaticMarkup(<ObjectLibrary
    heading="Add item"
    hint="Choose a built-in object or import a file."
    closeLabel="Close"
    categoryLabel="Object categories"
    categories={categories}
    activeCategory={activeCategory}
    entries={visibleEntries}
    importLabel="Import my file"
    importHint="3D models · PNG · JPG · WebP"
    onClose={vi.fn()}
    onCategoryChange={vi.fn()}
    onAdd={vi.fn()}
    onImport={vi.fn()}
  />)
}

describe('ObjectLibrary', () => {
  it('renders categories as one mutually exclusive tab list', () => {
    const markup = renderLibrary('displayCases')

    expect(markup.match(/role="tab"/g)).toHaveLength(4)
    expect(markup).toContain('data-object-category="displayCases"')
    expect(markup).toContain('aria-selected="true"')
    expect(markup).toContain('role="tabpanel"')
  })

  it('renders only the entries supplied for the active category', () => {
    const markup = renderLibrary('displayCases', [entries[1]])

    expect(markup).toContain('data-catalog-entry="case-modern2"')
    expect(markup).not.toContain('data-catalog-entry="case-modern1"')
  })

  it('keeps file import outside the scrollable category results', () => {
    const markup = renderLibrary('all')
    const resultsEnd = markup.indexOf('</section>')
    const importButton = markup.indexOf('object-library-import')

    expect(resultsEnd).toBeGreaterThan(-1)
    expect(importButton).toBeGreaterThan(resultsEnd)
  })

  it('uses factual one-line descriptions instead of generic placement copy', () => {
    const markup = renderLibrary('displayCases')

    expect(markup).toContain('1-tier case with a back panel')
    expect(markup).not.toMatch(/freely|as many as|perfect for/i)
  })

  it('renders case subgroups once without turning them into top-level categories', () => {
    const markup = renderLibrary('displayCases')

    expect(markup.match(/data-object-group="Shelving cases"/g)).toHaveLength(1)
    expect(markup.match(/data-object-group="Acrylic cases"/g)).toHaveLength(1)
    expect(markup).not.toContain('data-object-category="acrylicCases"')
  })
})
