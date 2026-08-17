import { Fragment } from 'react'
import { FileInput, X } from 'lucide-react'
import type { ObjectLibraryCategory } from '../objectCatalog'

export interface ObjectLibraryCategoryView {
  id: ObjectLibraryCategory
  label: string
}

export interface ObjectLibraryEntryView {
  id: string
  name: string
  description: string
  preview: string
  group?: string
}

interface ObjectLibraryProps {
  heading: string
  hint: string
  closeLabel: string
  categoryLabel: string
  categories: readonly ObjectLibraryCategoryView[]
  activeCategory: ObjectLibraryCategory
  entries: readonly ObjectLibraryEntryView[]
  importLabel: string
  importHint: string
  onClose: () => void
  onCategoryChange: (category: ObjectLibraryCategory) => void
  onAdd: (entryId: string) => void
  onImport: () => void
}

export function ObjectLibrary({
  heading,
  hint,
  closeLabel,
  categoryLabel,
  categories,
  activeCategory,
  entries,
  importLabel,
  importHint,
  onClose,
  onCategoryChange,
  onAdd,
  onImport
}: ObjectLibraryProps): React.JSX.Element {
  const panelId = `object-library-${activeCategory}`
  return <>
    <div className="object-library-heading">
      <span><strong>{heading}</strong><small>{hint}</small></span>
      <button type="button" className="icon-button" title={closeLabel} aria-label={closeLabel} onClick={onClose}><X aria-hidden="true" /></button>
    </div>
    <div className="object-library-body">
      <nav className="object-library-categories" role="tablist" aria-label={categoryLabel}>
        {categories.map((category) => <button
          key={category.id}
          type="button"
          role="tab"
          id={`object-library-tab-${category.id}`}
          aria-controls={`object-library-${category.id}`}
          aria-selected={activeCategory === category.id}
          data-object-category={category.id}
          onClick={() => onCategoryChange(category.id)}
        >{category.label}</button>)}
      </nav>
      <section
        className="object-library-results"
        role="tabpanel"
        id={panelId}
        aria-labelledby={`object-library-tab-${activeCategory}`}
      >
        <div className="object-library-grid">
          {entries.map((entry, index) => <Fragment key={entry.id}>
            {entry.group && entry.group !== entries[index - 1]?.group && <h3
              className="object-library-group-label"
              data-object-group={entry.group}
            >{entry.group}</h3>}
            <button
              type="button"
              className="object-library-card"
              data-catalog-entry={entry.id}
              title={`${entry.name} — ${entry.description}`}
              onClick={() => onAdd(entry.id)}
            >
              <img src={entry.preview} alt="" draggable={false} aria-hidden="true" />
              <span><b>{entry.name}</b><small>{entry.description}</small></span>
            </button>
          </Fragment>)}
        </div>
      </section>
    </div>
    <button type="button" className="object-library-import" onClick={onImport}>
      <FileInput aria-hidden="true" />
      <span><b>{importLabel}</b><small>{importHint}</small></span>
    </button>
  </>
}
