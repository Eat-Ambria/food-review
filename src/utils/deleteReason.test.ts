import { describe, expect, it } from 'vitest'
import { buildDeleteReason, DELETE_REASONS, isValidDeleteReason, normalizeReason } from './deleteReason'

describe('deleteReason', () => {
  it('chip alone', () => expect(buildDeleteReason('Duplicate', '')).toBe('Duplicate'))
  it('chip plus note', () => expect(buildDeleteReason('Duplicate', 'same as 2pm')).toBe('Duplicate: same as 2pm'))
  it('Other plus note', () => expect(buildDeleteReason('Other', 'test entry')).toBe('test entry'))
  it('Other with no note is empty', () => expect(buildDeleteReason('Other', '')).toBe(''))
  it('no chip uses the note', () => expect(buildDeleteReason(null, 'by mistake')).toBe('by mistake'))
  it('collapses whitespace', () => expect(normalizeReason('  a   b\n c ')).toBe('a b c'))
  it('validates length', () => {
    for (const r of ['', '  ', 'ab']) expect(isValidDeleteReason(r)).toBe(false)
    for (const r of ['abc', 'Duplicate']) expect(isValidDeleteReason(r)).toBe(true)
  })
  it('cuts long text to 500 and stays valid', () => {
    const r = buildDeleteReason(null, 'x'.repeat(800))
    expect(r.length).toBe(500)
    expect(isValidDeleteReason(r)).toBe(true)
  })
  it('cuts by code points without a broken surrogate', () => {
    const r = normalizeReason('😀'.repeat(600))
    expect(Array.from(r).length).toBe(500)
    expect(r).toBe('😀'.repeat(500))
    expect(isValidDeleteReason(r)).toBe(true)
  })
  it('offers Other', () => expect(DELETE_REASONS).toContain('Other'))
})
