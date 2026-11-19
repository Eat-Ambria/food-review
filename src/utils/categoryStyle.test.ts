// Tests for the department colours and shift order.
import { describe, it, expect } from 'vitest'
import { categoryTone, shiftIcon, SHIFT_ORDER } from './categoryStyle'

describe('categoryTone', () => {
  it('gives each known category its fixed colour', () => {
    expect(categoryTone('Kitchen')).toContain('orange')
    expect(categoryTone('Security')).toContain('emerald')
  })
  it('falls back to slate for unknown / empty', () => {
    expect(categoryTone('Something new')).toContain('slate')
    expect(categoryTone(null)).toContain('slate')
    expect(categoryTone(undefined)).toContain('slate')
  })
})

describe('shifts', () => {
  it('orders shifts through the day', () => {
    const sorted = ['Dinner', 'Morning', 'Sundowner', 'Lunch'].sort((a, b) => SHIFT_ORDER[a] - SHIFT_ORDER[b])
    expect(sorted).toEqual(['Morning', 'Lunch', 'Sundowner', 'Dinner'])
  })
  it('maps shift to icon', () => {
    expect(shiftIcon('Morning')).toBe('sun')
    expect(shiftIcon('Lunch')).toBe('sun')
    expect(shiftIcon('Sundowner')).toBe('sunset')
    expect(shiftIcon('Dinner')).toBe('moon')
    expect(shiftIcon('Brunch')).toBeNull()
    expect(shiftIcon(null)).toBeNull()
  })
})
