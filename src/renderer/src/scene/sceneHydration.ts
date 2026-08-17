import type { DisplayItem } from '../../../shared/types'

export function isPhysicsSceneHydrated(
  expectedItemIds: Iterable<string>,
  loadedItemIds: Iterable<string>,
  pendingItemIds: Iterable<string>
): boolean {
  const expected = new Set(expectedItemIds)
  const loaded = new Set(loadedItemIds)
  const pending = new Set(pendingItemIds)
  if (pending.size > 0) return false
  if (loaded.size !== expected.size) return false
  for (const id of expected) {
    if (!loaded.has(id)) return false
  }
  return true
}

/**
 * Lower-priority structures are repaired after the contents they support.
 * This is independent of the user-sortable layer order.
 */
export function restoredItemSupportPriority(item: Pick<DisplayItem, 'kind' | 'builtin'>): number {
  if (item.kind !== 'builtin') return 2
  if (item.builtin?.type === 'acrylicSteps' || item.builtin?.type === 'pedestal') return 1
  return 0
}
