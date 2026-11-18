// =============================================================================
// WHAT THIS FILE IS
//   Date helpers in India time (IST) for the list pages' date filters.
// WHY IT EXISTS
//   "Today" must mean today in India, even on a phone set to another time zone.
//   Shared by the date-range filters so every page agrees on what "Last 7 days" is.
// USED BY
//   pages/MySubmissions/MySubmissionsPage.tsx
// =============================================================================

export type RangeKey = 'today' | 'yesterday' | '7d' | '30d' | 'custom'

/** Today's date in India, as YYYY-MM-DD. */
export const istToday = (): string => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)

/** YYYY-MM-DD plus/minus days. */
export const shiftDay = (iso: string, days: number): string => {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** The from/to dates for a preset range (custom keeps whatever the user picked). */
export function rangeDates(r: Exclude<RangeKey, 'custom'>): { from: string; to: string } {
  const t = istToday()
  if (r === 'today') return { from: t, to: t }
  if (r === 'yesterday') return { from: shiftDay(t, -1), to: shiftDay(t, -1) }
  if (r === '7d') return { from: shiftDay(t, -6), to: t }
  return { from: shiftDay(t, -29), to: t }
}

/** Start/end instants of IST days, for timestamp queries. */
export const istDayStart = (iso: string) => `${iso}T00:00:00+05:30`
export const istDayEnd = (iso: string) => `${iso}T23:59:59.999+05:30`

/** The IST calendar day of a timestamp, as YYYY-MM-DD. */
export const istDayOf = (ts: string) => new Date(new Date(ts).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10)

/** "Today" / "Yesterday" / null. */
export const relativeDay = (iso: string): string | null => {
  const t = istToday()
  return iso === t ? 'Today' : iso === shiftDay(t, -1) ? 'Yesterday' : null
}

/** "Tue, 17 Nov". */
export const fullDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}
