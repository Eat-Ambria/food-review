// Date helpers in India time for the date filters.
export type RangeKey = 'today' | 'yesterday' | '7d' | '30d' | 'custom'

export const istToday = (): string => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)

export const shiftDay = (iso: string, days: number): string => {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function rangeDates(r: Exclude<RangeKey, 'custom'>): { from: string; to: string } {
  const t = istToday()
  if (r === 'today') return { from: t, to: t }
  if (r === 'yesterday') return { from: shiftDay(t, -1), to: shiftDay(t, -1) }
  if (r === '7d') return { from: shiftDay(t, -6), to: t }
  return { from: shiftDay(t, -29), to: t }
}

export const istDayStart = (iso: string) => `${iso}T00:00:00+05:30`
export const istDayEnd = (iso: string) => `${iso}T23:59:59.999+05:30`

export const istDayOf = (ts: string) => new Date(new Date(ts).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10)

export const relativeDay = (iso: string): string | null => {
  const t = istToday()
  return iso === t ? 'Today' : iso === shiftDay(t, -1) ? 'Yesterday' : null
}

export const dayMonth = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export const fullDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}
