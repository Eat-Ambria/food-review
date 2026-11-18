import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { istToday, shiftDay, rangeDates, istDayStart, istDayEnd, istDayOf, relativeDay } from './dates'

describe('dates (IST)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('istToday uses India time, not UTC', () => {
    // 2026-11-17 20:00 UTC = 2026-11-18 01:30 IST
    vi.setSystemTime(new Date('2026-11-17T20:00:00Z'))
    expect(istToday()).toBe('2026-11-18')
    // 2026-11-17 18:29 UTC = 23:59 IST, still the 17th
    vi.setSystemTime(new Date('2026-11-17T18:29:00Z'))
    expect(istToday()).toBe('2026-11-17')
  })

  it('shiftDay crosses month and year boundaries', () => {
    expect(shiftDay('2026-11-30', 1)).toBe('2026-12-01')
    expect(shiftDay('2027-01-01', -1)).toBe('2026-12-31')
    expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29') // leap year
  })

  it('rangeDates presets', () => {
    vi.setSystemTime(new Date('2026-11-17T06:00:00Z'))
    expect(rangeDates('today')).toEqual({ from: '2026-11-17', to: '2026-11-17' })
    expect(rangeDates('yesterday')).toEqual({ from: '2026-11-16', to: '2026-11-16' })
    expect(rangeDates('7d')).toEqual({ from: '2026-11-11', to: '2026-11-17' })
    expect(rangeDates('30d')).toEqual({ from: '2026-10-19', to: '2026-11-17' })
  })

  it('IST day start/end strings', () => {
    expect(istDayStart('2026-11-17')).toBe('2026-11-17T00:00:00+05:30')
    expect(istDayEnd('2026-11-17')).toBe('2026-11-17T23:59:59.999+05:30')
  })

  it('istDayOf converts a UTC timestamp to its IST day', () => {
    expect(istDayOf('2026-11-16T19:00:00Z')).toBe('2026-11-17')
    expect(istDayOf('2026-11-16T18:00:00Z')).toBe('2026-11-16')
  })

  it('relativeDay', () => {
    vi.setSystemTime(new Date('2026-11-17T06:00:00Z'))
    expect(relativeDay('2026-11-17')).toBe('Today')
    expect(relativeDay('2026-11-16')).toBe('Yesterday')
    expect(relativeDay('2026-11-15')).toBeNull()
  })
})
