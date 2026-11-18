// =============================================================================
// WHAT THIS FILE IS
//   Reading and editing the venue master list and its aliases.
// WHY IT EXISTS
//   People call the same venue by different names (Ambria Pushpanjali / AP /
//   Pushpanjali / पुष्पांजलि). Admin keeps that list here, and the Record page
//   uses it to recognise venues in a transcript. Writes go straight to the
//   tables; RLS (migration 2) allows them for admins only.
// USED BY
//   pages/Venues/VenuesPage.tsx, components/EventDetailsCard.tsx
// =============================================================================
import { supabase } from '../lib/supabase'
import type { CalendarCategory, Venue } from '../types/events'

export async function listVenues(includeInactive = false): Promise<Venue[]> {
  let q = supabase.from('venues')
    .select('id, venue_name, calendar_venue_id, sub_venues, is_active, sort_order, aliases:venue_aliases(id, venue_id, alias, alias_normalized)')
    .order('sort_order').order('venue_name')
  if (!includeInactive) q = q.eq('is_active', true)
  const { data, error } = await q
  if (error) throw new Error('Could not load venues. ' + error.message)
  return (data ?? []) as Venue[]
}

export async function saveVenue(v: { id?: string; venue_name: string; calendar_venue_id: string | null; sub_venues: string[]; is_active: boolean }): Promise<string> {
  const row = { venue_name: v.venue_name.trim(), calendar_venue_id: v.calendar_venue_id || null, sub_venues: v.sub_venues, is_active: v.is_active }
  const { data, error } = v.id
    ? await supabase.from('venues').update(row).eq('id', v.id).select('id').single()
    : await supabase.from('venues').insert(row).select('id').single()
  if (error) {
    if (error.code === '23505') throw new Error('A venue with this name or calendar link already exists.')
    throw new Error('Could not save venue. ' + error.message)
  }
  return data.id as string
}

export async function addAlias(venueId: string, alias: string): Promise<void> {
  const clean = alias.trim().replace(/\s+/g, ' ')
  if (!clean) return
  const { error } = await supabase.from('venue_aliases').insert({ venue_id: venueId, alias: clean })
  if (error && error.code !== '23505') throw new Error('Could not add alias. ' + error.message)   // 23505 = already there
}

export async function removeAlias(aliasId: string): Promise<void> {
  const { error } = await supabase.from('venue_aliases').delete().eq('id', aliasId)
  if (error) throw new Error('Could not remove alias. ' + error.message)
}

// Short codes that are also everyday words in complaints ("AC kharab", "7 AM").
// They are never added automatically; an admin can still add one on purpose.
const UNSAFE_SHORT_CODES = new Set(['ac', 'am', 'pm', 'tv', 'ok', 'no', 'hi', 'ws'])

/** Sensible starting aliases for a calendar category: full name, safe short code, and the name without "Ambria". */
export function defaultAliases(c: CalendarCategory): string[] {
  const out = new Set<string>([c.name])
  if (c.short_code && c.short_code.length <= 6 && !UNSAFE_SHORT_CODES.has(c.short_code.toLowerCase())) out.add(c.short_code)
  const stripped = c.name.replace(/^ambria\s+/i, '').trim()
  // "Ambria Events" → "Events" would match everyday speech ("aaj do events the"), so skip such words.
  const everyday = ['events', 'event', 'decor', 'design', 'services', 'cuisine', 'tender', 'villa', 'wedding services']
  if (stripped && stripped.toLowerCase() !== c.name.toLowerCase() && !everyday.includes(stripped.toLowerCase())) out.add(stripped)
  return [...out]
}

/**
 * Creates (or refreshes) one venue per chosen calendar category. Re-running is
 * safe: an existing venue linked to the same category is updated, and aliases
 * that already exist are skipped.
 */
export async function importFromCalendar(categories: CalendarCategory[]): Promise<{ created: number; updated: number }> {
  const existing = await listVenues(true)
  let created = 0
  let updated = 0
  for (const [i, c] of categories.entries()) {
    const subs = (c.sub_venues ?? []).filter((s) => s && !/^full venue$/i.test(s))
    // Same calendar link, or a venue the admin already created by hand with the same name.
    const match = existing.find((v) => v.calendar_venue_id === c.venue_id)
      ?? existing.find((v) => !v.calendar_venue_id && v.venue_name.trim().toLowerCase() === c.name.trim().toLowerCase())
    let venueId: string
    if (match) {
      const { error } = await supabase.from('venues').update({ sub_venues: subs, calendar_venue_id: c.venue_id }).eq('id', match.id)
      if (error) throw new Error(`Could not update ${c.name}. ${error.message}`)
      venueId = match.id
      updated++
    } else {
      const { data, error } = await supabase.from('venues')
        .insert({ venue_name: c.name, calendar_venue_id: c.venue_id, sub_venues: subs, sort_order: i })
        .select('id').single()
      if (error) throw new Error(`Could not create ${c.name}. ${error.message}`)
      venueId = data.id
      created++
    }
    for (const a of defaultAliases(c)) await addAlias(venueId, a)
  }
  return { created, updated }
}
