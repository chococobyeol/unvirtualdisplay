import type { CasePreset, DisplayItem } from '../../shared/types'

export const OBJECT_LIBRARY_CATEGORIES = [
  'all',
  'displayCases',
  'acrylicCases',
  'risers',
  'shelvesParts'
] as const

export type ObjectLibraryCategory = typeof OBJECT_LIBRARY_CATEGORIES[number]
export type ObjectCatalogCategory = Exclude<ObjectLibraryCategory, 'all'>

export interface ObjectCatalogEntry {
  id: string
  category: ObjectCatalogCategory
  nameKey: string
  descriptionKey: string
  descriptionCount?: number
  previewId: string
  builtin: NonNullable<DisplayItem['builtin']>
}

const DISPLAY_CASE_PRESETS: readonly Exclude<CasePreset, 'custom'>[] = [
  'modern1', 'modern2', 'modern3',
  'glass1', 'glass2', 'glass3',
  'wood1', 'wood2', 'wood3'
]

const displayCases: ObjectCatalogEntry[] = DISPLAY_CASE_PRESETS.map((preset) => {
  const count = Number(preset.at(-1))
  const style = preset.startsWith('glass') ? 'glass' : preset.startsWith('wood') ? 'wood' : 'modern'
  return {
    id: `display-case-${preset}`,
    category: 'displayCases',
    nameKey: preset,
    descriptionKey: `${style}CaseDescription`,
    descriptionCount: count,
    previewId: preset,
    builtin: { type: 'displayCase', casePreset: preset }
  }
})

export const OBJECT_CATALOG: readonly ObjectCatalogEntry[] = [
  ...displayCases,
  {
    id: 'acrylic-case-low',
    category: 'acrylicCases',
    nameKey: 'acrylicCaseLow',
    descriptionKey: 'acrylicCaseLowDescription',
    previewId: 'acrylicCaseLow',
    builtin: { type: 'acrylicCase', acrylicCaseVariant: 'low' }
  },
  {
    id: 'acrylic-case-standard',
    category: 'acrylicCases',
    nameKey: 'acrylicCaseStandard',
    descriptionKey: 'acrylicCaseStandardDescription',
    previewId: 'acrylicCaseStandard',
    builtin: { type: 'acrylicCase', acrylicCaseVariant: 'standard' }
  },
  {
    id: 'acrylic-case-tall',
    category: 'acrylicCases',
    nameKey: 'acrylicCaseTall',
    descriptionKey: 'acrylicCaseTallDescription',
    previewId: 'acrylicCaseTall',
    builtin: { type: 'acrylicCase', acrylicCaseVariant: 'tall' }
  },
  ...([2, 3, 4, 5] as const).map((steps): ObjectCatalogEntry => ({
    id: `acrylic-steps-${steps}`,
    category: 'risers',
    nameKey: `acrylicSteps${steps}`,
    descriptionKey: 'acrylicStepsDescription',
    descriptionCount: steps,
    previewId: `acrylicSteps${steps}`,
    builtin: { type: 'acrylicSteps', steps }
  })),
  {
    id: 'square-pedestal',
    category: 'risers',
    nameKey: 'squarePedestal',
    descriptionKey: 'squarePedestalDescription',
    previewId: 'pedestal',
    builtin: { type: 'pedestal' }
  },
  {
    id: 'flat-shelf',
    category: 'shelvesParts',
    nameKey: 'flatShelf',
    descriptionKey: 'flatShelfDescription',
    previewId: 'shelf',
    builtin: { type: 'shelf' }
  }
]

export function entriesForCategory(category: ObjectLibraryCategory): readonly ObjectCatalogEntry[] {
  return category === 'all' ? OBJECT_CATALOG : OBJECT_CATALOG.filter((entry) => entry.category === category)
}

export function createCatalogItem(entry: ObjectCatalogEntry, id: string, name: string): DisplayItem {
  return {
    id,
    name,
    kind: 'builtin',
    format: 'object',
    assetUrl: '',
    relativePath: '',
    visible: true,
    selectionPassThrough: false,
    builtin: structuredClone(entry.builtin),
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    },
    physics: {
      collision: true,
      preventToppling: true,
      placementLocked: false
    },
    animation: {
      enabled: false,
      clipIndex: 0,
      loop: true,
      speed: 1
    }
  }
}
