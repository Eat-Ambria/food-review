// Tests for the event-matching calls.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }))
import { functionNameOf, fetchEventsOn, fetchCalendarCategories, matchEvent } from './eventCalendarService'
import type { CalendarEvent } from '../types/events'

const ev = (over: Partial<CalendarEvent>) => ({ event_type: null, event_type_other: null, ...over }) as CalendarEvent

beforeEach(() => { invoke.mockReset() })

describe('functionNameOf', () => {
  it('uses event_type, or the Other text', () => {
    expect(functionNameOf(ev({ event_type: 'Wedding' }))).toBe('Wedding')
    expect(functionNameOf(ev({ event_type: 'Other', event_type_other: 'Mehendi' }))).toBe('Mehendi')
    expect(functionNameOf(ev({ event_type: 'Other' }))).toBe('Other')
    expect(functionNameOf(ev({}))).toBeNull()
  })
})

describe('calls to the event-calendar function', () => {
  it('fetchCalendarCategories returns [] when missing', async () => {
    invoke.mockResolvedValue({ data: {}, error: null })
    expect(await fetchCalendarCategories()).toEqual([])
    expect(invoke).toHaveBeenCalledWith('event-calendar', { body: { action: 'categories' } })
  })

  it('fetchEventsOn caches by date + venue set (order-independent)', async () => {
    invoke.mockResolvedValue({ data: { events: [{ id: 'e1' }], kill_switch: true }, error: null })
    const a = await fetchEventsOn('2026-11-20', ['b', 'a'])
    const b = await fetchEventsOn('2026-11-20', ['a', 'b'])
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(a.killSwitch).toBe(true)
    expect(b.events).toEqual([{ id: 'e1' }])
    await fetchEventsOn('2026-11-21', ['a', 'b'])
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('matchEvent throws a readable error on failure', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('x') })
    await expect(matchEvent('hello')).rejects.toThrow(/Event Calendar|offline/)
  })
})
