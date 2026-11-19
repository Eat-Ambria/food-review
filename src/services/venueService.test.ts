// Tests for venues.
import { describe, it, expect, vi } from 'vitest'
vi.mock('../lib/supabase', () => ({ supabase: {} }))
import { defaultAliases } from './venueService'
import type { CalendarCategory } from '../types/events'

const cat = (name: string, short_code: string | null = null): CalendarCategory =>
  ({ venue_id: 'v', name, short_code, category_type: null, sub_venues: null, is_active: true })

describe('defaultAliases', () => {
  it('adds the name, a safe short code and the name without "Ambria"', () => {
    expect(defaultAliases(cat('Ambria Pushpanjali', 'AP'))).toEqual(['Ambria Pushpanjali', 'AP', 'Pushpanjali'])
  })
  it('skips short codes that are everyday words', () => {
    expect(defaultAliases(cat('Ambria Courtyard', 'AC'))).toEqual(['Ambria Courtyard', 'Courtyard'])
    expect(defaultAliases(cat('Ambria Manor', 'am'))).toEqual(['Ambria Manor', 'Manor'])
  })
  it('skips over-long short codes', () => {
    expect(defaultAliases(cat('Hall', 'LONGCODE'))).toEqual(['Hall'])
  })
  it('skips stripped names that are everyday words', () => {
    expect(defaultAliases(cat('Ambria Events'))).toEqual(['Ambria Events'])
    expect(defaultAliases(cat('Ambria Wedding Services'))).toEqual(['Ambria Wedding Services'])
  })
  it('does not duplicate when the name has no Ambria prefix', () => {
    expect(defaultAliases(cat('Villa One'))).toEqual(['Villa One'])
  })
})
