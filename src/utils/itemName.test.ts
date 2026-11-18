// =============================================================================
// WHAT THIS FILE IS
//   Tests for utils/itemName.ts (item names shown in Roman script, Title Case)
//   and that itemGroups puts "पनीर" and "Paneer" together.
// =============================================================================
import { describe, expect, it } from 'vitest'
import { displayItem } from './itemName'
import { itemCounts } from './itemGroups'

describe('displayItem', () => {
  it.each([
    ['पनीर', 'Paneer'], ['दाल मखनी', 'Dal Makhani'], ['गुलाब जामुन', 'Gulab Jamun'], ['मटर पनीर', 'Matar Paneer'],
    ['khana', 'Khana'], ['dal  makhani', 'Dal Makhani'], ['AC', 'AC'], ['Paneer Tikka', 'Paneer Tikka'], ['', ''],
  ])('%s → %s', (input, out) => expect(displayItem(input)).toBe(out))
})

describe('grouping across scripts', () => {
  it('counts पनीर and Paneer as one item', () => {
    const rows = [{ item: 'पनीर' }, { item: 'Paneer' }, { item: 'paneer' }, { item: 'AC' }]
    expect(itemCounts(rows, (r) => r.item, () => 'Kitchen').map((x) => [x.item, x.count])).toEqual([['Paneer', 3], ['AC', 1]])
  })
})
