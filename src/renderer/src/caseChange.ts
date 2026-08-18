export function approveCaseChange(itemCount: number, confirmChange: () => boolean): boolean {
  if (itemCount === 0) return true
  return confirmChange()
}
