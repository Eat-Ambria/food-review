// Tests for the CSV helpers.
import { describe, it, expect } from 'vitest'
import { toCsv } from './csv'

describe('toCsv', () => {
  it('joins headers and rows with CRLF', () => {
    expect(toCsv(['a', 'b'], [[1, 2], [3, 4]])).toBe('a,b\r\n1,2\r\n3,4')
  })

  it('writes null/undefined as empty cells', () => {
    expect(toCsv(['a', 'b', 'c'], [[null, undefined, 0]])).toBe('a,b,c\r\n,,0')
  })

  it('quotes commas, quotes and newlines', () => {
    expect(toCsv(['n'], [['Sharma, Rahul']])).toBe('n\r\n"Sharma, Rahul"')
    expect(toCsv(['n'], [['say "hi"']])).toBe('n\r\n"say ""hi"""')
    expect(toCsv(['n'], [['line1\nline2']])).toBe('n\r\n"line1\nline2"')
  })

  it('neutralises formula-looking values (CSV injection)', () => {
    expect(toCsv(['x'], [['=SUM(A1)']])).toBe("x\r\n'=SUM(A1)")
    expect(toCsv(['x'], [['+91 98765']])).toBe("x\r\n'+91 98765")
    expect(toCsv(['x'], [['-5']])).toBe("x\r\n'-5")
    expect(toCsv(['x'], [['@cmd']])).toBe("x\r\n'@cmd")
  })

  it('keeps Hindi text untouched', () => {
    expect(toCsv(['n'], [['राहुल']])).toBe('n\r\nराहुल')
  })
})
