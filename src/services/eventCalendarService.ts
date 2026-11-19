// Asks the server which Calendar function a transcript is about.
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { CalendarCategory, CalendarEvent, EventMatch } from '../types/events'

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('event-calendar', { body })
  if (error) {
    let message = navigator.onLine ? 'Could not reach the Event Calendar.' : 'You are offline.'
    if (error instanceof FunctionsHttpError) {
      try { message = (await error.context.json())?.error ?? message } catch { }
    }
    throw new Error(message)
  }
  return data as T
}

export async function fetchCalendarCategories(): Promise<CalendarCategory[]> {
  const res = await call<{ categories: CalendarCategory[] }>({ action: 'categories' })
  return res.categories ?? []
}

const cache = new Map<string, { at: number; events: CalendarEvent[]; killSwitch: boolean }>()
const CACHE_MS = 2 * 60_000

export async function fetchEventsOn(date: string, calendarVenueIds: string[]): Promise<{ events: CalendarEvent[]; killSwitch: boolean }> {
  const key = `${date}|${[...calendarVenueIds].sort().join(',')}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit
  const res = await call<{ events: CalendarEvent[]; kill_switch?: boolean }>({
    action: 'events', date, calendar_venue_ids: calendarVenueIds,
  })
  const value = { at: Date.now(), events: res.events ?? [], killSwitch: Boolean(res.kill_switch) }
  cache.set(key, value)
  return value
}

export function functionNameOf(e: CalendarEvent): string | null {
  if (e.event_type === 'Other') return e.event_type_other || 'Other'
  return e.event_type || null
}

export async function matchEvent(transcript: string): Promise<EventMatch> {
  return call<EventMatch>({ action: 'match', transcript })
}
