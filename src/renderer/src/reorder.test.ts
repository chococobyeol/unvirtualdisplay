import { describe, expect, it } from 'vitest'
import { reorderById } from './reorder'

const values = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]

describe('reorderById', () => {
  it('moves a value before an earlier target', () => {
    expect(reorderById(values, 'd', 'b', 'before').map((value) => value.id)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('moves a value after a later target', () => {
    expect(reorderById(values, 'a', 'c', 'after').map((value) => value.id)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('keeps the original array when source and target match', () => {
    expect(reorderById(values, 'b', 'b', 'after')).toBe(values)
  })

  it('keeps the original array when either id is missing', () => {
    expect(reorderById(values, 'missing', 'b', 'before')).toBe(values)
    expect(reorderById(values, 'a', 'missing', 'after')).toBe(values)
  })
})
