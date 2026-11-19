// Tests for the formatting helpers.
import { describe, it, expect } from 'vitest'
import { fmtTime } from './format'

describe('fmtTime', () => {
  it('formats seconds as m:ss', () => {
    expect(fmtTime(65)).toBe('1:05')
    expect(fmtTime(0)).toBe('0:00')
    expect(fmtTime(600)).toBe('10:00')
  })

  it('drops fractional seconds', () => {
    expect(fmtTime(59.9)).toBe('0:59')
  })

  it('clamps negative values to 0:00', () => {
    expect(fmtTime(-5)).toBe('0:00')
  })
})
