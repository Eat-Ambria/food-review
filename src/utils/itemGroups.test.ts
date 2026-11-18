// =============================================================================
// WHAT THIS FILE IS
//   Tests for utils/itemGroups.ts (putting issues about the same dish together).
// =============================================================================
import { describe, expect, it } from 'vitest'
import { groupByItem, itemCounts, sortByItem } from './itemGroups'

type I = { id: number; item: string | null; cat: string }
const rows: I[] = [
  { id: 1, item: 'Dal Makhani', cat: 'Kitchen' },
  { id: 2, item: 'AC', cat: 'Maintenance' },
  { id: 3, item: 'dal  makhani', cat: 'Kitchen' },   // same dish, different spelling/spaces
  { id: 4, item: null, cat: 'Other' },
  { id: 5, item: 'Paneer Tikka', cat: 'Kitchen' },
]
const itemOf = (r: I) => r.item
const catOf = (r: I) => r.cat

describe('itemGroups', () => {
  it('groups the same dish together, in first-mentioned order, no-item last', () => {
    const g = groupByItem(rows, itemOf, catOf)
    expect(g.map((x) => x.issues.map((r) => r.id))).toEqual([[1, 3], [2], [5], [4]])
    expect(g[0].item).toBe('Dal Makhani')
  })

  it('counts items, ignoring issues without one', () => {
    expect(itemCounts(rows, itemOf, catOf).map((x) => [x.item, x.count])).toEqual([
      ['Dal Makhani', 2], ['AC', 1], ['Paneer Tikka', 1],
    ])
  })

  it('re-orders so same-item issues sit next to each other', () => {
    expect(sortByItem(rows, itemOf).map((r) => r.id)).toEqual([1, 3, 2, 5, 4])
  })
})
