export type ReorderPlacement = 'before' | 'after'

export function reorderById<T extends { id: string }>(
  values: T[],
  sourceId: string,
  targetId: string,
  placement: ReorderPlacement
): T[] {
  if (sourceId === targetId) return values
  const sourceIndex = values.findIndex((value) => value.id === sourceId)
  if (sourceIndex < 0) return values

  const reordered = [...values]
  const [source] = reordered.splice(sourceIndex, 1)
  const targetIndex = reordered.findIndex((value) => value.id === targetId)
  if (targetIndex < 0) return values
  reordered.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, source)
  return reordered
}
