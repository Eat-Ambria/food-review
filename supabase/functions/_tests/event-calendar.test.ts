// Tests for the event matcher (which function a complaint is about).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  matchEvent, detectDates, normalize, translitWord, nameKey, hindiInitials, levenshtein, shiftOf, todayIST,
  type CalEvent, type Venue, type MatchDeps,
} from '../event-calendar/index.ts'

const NOON_IST = new Date('2026-11-17T06:30:00Z')
const TODAY = '2026-11-17'

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOON_IST) })
afterEach(() => { vi.useRealTimers() })

const dates = (said: string) =>
  detectDates(said, normalize(said), todayIST()).cands.map((c) => c.date).sort()

describe('detectDates', () => {
  it('reads day + month in English and Hindi', () => {
    expect(dates('15 Nov ko khana thanda tha')).toEqual(['2026-11-15'])
    expect(dates('15th of November')).toEqual(['2026-11-15'])
    expect(dates('Nov 15 wala function')).toEqual(['2026-11-15'])
    expect(dates('15 नवंबर को')).toEqual(['2026-11-15'])
    expect(dates('१५ नवंबर')).toEqual(['2026-11-15'])
  })

  it('a date far in the future means last year', () => {
    expect(dates('25 Dec ko')).toEqual(['2025-12-25'])
  })

  it('reads numeric dates but not counts or decimals', () => {
    expect(dates('15/11 ko')).toEqual(['2026-11-15'])
    expect(dates('15-11-2026')).toEqual(['2026-11-15'])
    expect(dates('15.11.26')).toEqual(['2026-11-15'])
    expect(dates('2-3 log aaye the')).toEqual([])
    expect(dates('rating 3.4 thi')).toEqual([])
  })

  it('"15 tarikh" = this month, or last month if that day has not come yet', () => {
    expect(dates('15 tarikh')).toEqual(['2026-11-15'])
    expect(dates('१५ तारीख')).toEqual(['2026-11-15'])
    expect(dates('20 tarikh')).toEqual(['2026-10-20'])
    expect(dates('31 tarikh')).toEqual(['2026-10-31'])
  })

  it('"15th ko" is a date, "1st floor" is not', () => {
    expect(dates('15th ko function tha')).toEqual(['2026-11-15'])
    expect(dates('1st floor pe AC kharab')).toEqual([])
  })

  it('"may" / "mar" as everyday words are not months', () => {
    expect(dates('may 2 log aaye')).toEqual([])
  })

  it('kal: the tense decides yesterday vs tomorrow', () => {
    expect(dates('kal khana thanda tha')).toEqual(['2026-11-16'])
    expect(dates('कल का खाना ठंडा था')).toEqual(['2026-11-16'])
    expect(dates('kal function hoga')).toEqual(['2026-11-18'])
    const unclear = detectDates('kal', normalize('kal'), todayIST()).cands
    expect(unclear.find((c) => c.date === '2026-11-16')!.weight).toBeGreaterThan(unclear.find((c) => c.date === '2026-11-18')!.weight)
  })

  it('parso, aaj, yesterday, weekdays', () => {
    expect(dates('parso hua tha')).toEqual(['2026-11-15'])
    expect(dates('aaj lunch me')).toEqual([TODAY])
    expect(dates('yesterday')).toEqual(['2026-11-16'])
    expect(dates('day before yesterday')).toEqual(['2026-11-15'])
    expect(dates('sunday ko')).toEqual(['2026-11-15'])
    expect(dates('मंगलवार')).toEqual([TODAY])
  })

  it('explicit flag is set only for real dates', () => {
    expect(detectDates('15/11', normalize('15/11'), todayIST()).explicit).toBe(true)
    expect(detectDates('kal', normalize('kal'), todayIST()).explicit).toBe(false)
  })
})

describe('name helpers', () => {
  it('transliterates Devanagari names so they compare with English', () => {
    expect(nameKey(translitWord('शर्मा'))).toBe(nameKey('Sharma'))
    expect(nameKey(translitWord('राहुल'))).toBe('rahul')
    expect(translitWord('hello')).toBe('hello')
  })

  it('reads spelled-out initials', () => {
    expect(hindiInitials('एनपी')).toBe('np')
    expect(hindiInitials('आरके')).toBe('rk')
    expect(hindiInitials('शर्मा')).toBeNull()
    expect(hindiInitials('ए')).toBeNull()
  })

  it('nameKey ignores common spelling differences', () => {
    expect(nameKey('Baweja')).toBe(nameKey('Baveja'))
    expect(nameKey('Phool')).toBe(nameKey('Phul'))
    expect(nameKey('Preeti')).toBe(nameKey('Priti'))
  })

  it('levenshtein', () => {
    expect(levenshtein('kitchen', 'kitchn')).toBe(1)
    expect(levenshtein('same', 'same')).toBe(0)
    expect(levenshtein('a', 'abcdef')).toBe(3)
  })

  it('normalize lower-cases, strips punctuation, converts Hindi digits', () => {
    expect(normalize('Hello,  WORLD!')).toBe(' hello world ')
    expect(normalize('१५ तारीख')).toBe(' 15 तारीख ')
  })
})

describe('shiftOf', () => {
  const e = (shift: string | null, time: string | null) => ({ shift, time }) as CalEvent
  it('uses the shift field first, else the time', () => {
    expect(shiftOf(e('Lunch', '20:00'))).toBe('Lunch')
    expect(shiftOf(e(null, '09:00'))).toBe('Morning')
    expect(shiftOf(e(null, '12:30'))).toBe('Lunch')
    expect(shiftOf(e(null, '17:00'))).toBe('Sundowner')
    expect(shiftOf(e(null, '20:00'))).toBe('Dinner')
    expect(shiftOf(e(null, null))).toBeNull()
  })
})

const VENUES: Venue[] = [
  { id: 'v-ap', venue_name: 'Ambria Pushpanjali', calendar_venue_id: 'ap', sub_venues: ['Amber Lawn', 'Full Venue'],
    aliases: [{ alias: 'AP' }, { alias: 'Pushpanjali' }, { alias: 'Ambria' }] },
  { id: 'v-am', venue_name: 'Ambria Manaktala', calendar_venue_id: 'am', sub_venues: ['Crystal Hall'],
    aliases: [{ alias: 'Manaktala' }] },
]

const ev = (over: Partial<CalEvent> & { id: string; venue_id: string; date: string }): CalEvent => ({
  title: null, status: 'Confirmed', end_date: null, time: null, shift: null, sub_venue: null, event_type: null,
  event_type_other: null, guest_name: null, pax: null, check_in_date: null, check_out_date: null, venue_name: null, ...over,
})

const EVENTS: CalEvent[] = [
  ev({ id: 'e1', venue_id: 'ap', date: TODAY, shift: 'Lunch', guest_name: 'Rahul Sharma', event_type: 'Wedding', sub_venue: 'Amber Lawn' }),
  ev({ id: 'e2', venue_id: 'ap', date: TODAY, shift: 'Dinner', guest_name: 'NP Singh', event_type: 'Reception' }),
  ev({ id: 'e3', venue_id: 'am', date: TODAY, shift: 'Dinner', guest_name: 'Kapil Baweja', event_type: 'Birthday' }),
  ev({ id: 'e4', venue_id: 'am', date: '2026-11-16', shift: 'Sundowner', guest_name: 'Anita Gupta', event_type: 'Other', event_type_other: 'Kitty party' }),
  ev({ id: 'e5', venue_id: 'ap', date: '2026-11-15', shift: 'Lunch', guest_name: 'Meena Jain', event_type: 'Other', event_type_other: 'Mehendi' }),
  ev({ id: 'e6', venue_id: 'ap', date: '2026-11-14', shift: 'Sundowner', guest_name: 'Rohit Malviya', event_type: 'Other', event_type_other: 'Lagan' }),
  ev({ id: 'e7', venue_id: 'ap', date: '2026-11-14', shift: 'Dinner', guest_name: 'Sunil Mehra', event_type: 'Wedding' }),
]

function deps(over: Partial<MatchDeps> = {}) {
  const eventsOn = vi.fn(async (date: string, ids: string[]) =>
    EVENTS.filter((e) => e.date === date && (!ids.length || ids.includes(e.venue_id))))
  return { venues: VENUES, killSwitchOn: async () => false, eventsOn, ...over }
}

type Result = Awaited<ReturnType<typeof matchEvent>> & {
  event?: { calendar_event_id: string } | null
  venue?: { id: string } | null
  date?: string
  date_source?: string
  candidates?: unknown[]
}
const match = async (said: string, d = deps(), hint: string | null = null) => (await matchEvent(d, said, hint)) as Result

describe('matchEvent', () => {
  it('venue + shift picks one booking', async () => {
    const d = deps()
    const r = await match('Pushpanjali mein lunch ka khana thanda tha', d)
    expect(r.status).toBe('matched')
    expect(r.event!.calendar_event_id).toBe('e1')
    expect(r.venue!.id).toBe('v-ap')
    expect(r.date_source).toBe('assumed_today')
    expect(d.eventsOn).toHaveBeenCalledWith(TODAY, ['ap'])
  })

  it('a lawn that belongs to only one venue identifies the venue', async () => {
    const r = await match('Amber Lawn pe shaadi mein khana kam pada')
    expect(r.venue!.id).toBe('v-ap')
    expect(r.event!.calendar_event_id).toBe('e1')
  })

  it('a distinctive guest name is enough without a venue', async () => {
    const r = await match('Baweja ji ke function mein paneer kaccha tha')
    expect(r.status).toBe('matched')
    expect(r.event!.calendar_event_id).toBe('e3')
    expect(r.venue).toBeNull()
  })

  it('Hindi guest name with spelled initials + function type', async () => {
    const r = await match('एनपी सिंह के रिसेप्शन में खाना ठंडा था')
    expect(r.status).toBe('matched')
    expect(r.event!.calendar_event_id).toBe('e2')
  })

  it('initials written apart ("N P Singh") count as one name', async () => {
    const r = await match('N P Singh ke yahan AC band tha')
    expect(r.event!.calendar_event_id).toBe('e2')
  })

  it('a common surname alone is not enough', async () => {
    const r = await match('Sharma ji ke yahan khana thanda tha')
    expect(r.status).toBe('ambiguous')
  })

  it('never guesses between two equal bookings', async () => {
    const r = await match('Pushpanjali mein khana thanda tha')
    expect(r.status).toBe('ambiguous')
    expect(r.event).toBeNull()
    expect(r.candidates!.length).toBe(2)
    expect(r.reasons[0]).toMatch(/More than one booking/)
  })

  it('without a venue and several bookings, asks for the venue', async () => {
    const r = await match('khana thanda tha')
    expect(r.status).toBe('ambiguous')
    expect(r.reasons[0]).toMatch(/venue was not mentioned/)
  })

  it('short alias counts only in CAPITALS, not "7 am" / "ap log"', async () => {
    const d = deps()
    const r = await match('7 am ko ap log aaye, khana thanda tha', d)
    expect(r.venue).toBeNull()
    expect(d.eventsOn).toHaveBeenCalledWith(TODAY, ['ap', 'am'])

    const r2 = await match('AP mein dinner kharab tha')
    expect(r2.venue!.id).toBe('v-ap')
    expect(r2.event!.calendar_event_id).toBe('e2')
  })

  it('a venue said in Hindi script or split in two words is still found', async () => {

    const r = await match('आज मानक तला में function है उसमें smell आ रही है।')
    expect(r.venue!.id).toBe('v-am')
    expect(r.event!.calendar_event_id).toBe('e3')
    expect((await match('Manak Tala mein dinner mein AC band tha')).venue!.id).toBe('v-am')

    expect((await match('आज मानकतला के function में food में smell आई है, fix करो।')).venue!.id).toBe('v-am')
    expect((await match('पुष्पांजलि में lunch में खाना ठंडा था')).event!.calendar_event_id).toBe('e1')
  })

  it('guest names and function words are also matched as they sound in Hindi', async () => {

    expect((await match('14 तारीख को मालवीय जी के function में AC खराब था')).event!.calendar_event_id).toBe('e6')

    expect((await match('14 तारीख को पुष्पांजलि में लगन में खाना ठंडा था')).event!.calendar_event_id).toBe('e6')
    expect((await match('14 tarikh ko Pushpanjali mein shaadi mein khana thanda tha')).event!.calendar_event_id).toBe('e7')
  })

  it('"Ambria Manaktala" is AM, even though "Ambria" is an AP alias', async () => {
    const r = await match('Ambria Manaktala mein dinner')
    expect(r.venue!.id).toBe('v-am')
    expect(r.event!.calendar_event_id).toBe('e3')
  })

  it('a near-miss spelling of a venue is used when nothing matches exactly', async () => {
    const r = await match('Manaktla mein dinner thanda tha')
    expect(r.venue!.id).toBe('v-am')
  })

  it('a spoken date moves the search to that day', async () => {
    const r = await match('15/11 ko Pushpanjali mein mehendi mein chai thandi thi')
    expect(r.status).toBe('matched')
    expect(r.event!.calendar_event_id).toBe('e5')
    expect(r.date).toBe('2026-11-15')
    expect(r.date_source).toBe('explicit')
  })

  it('kal + past tense → yesterday', async () => {
    const r = await match('kal Manaktala mein kitty party mein khana kam tha')
    expect(r.event!.calendar_event_id).toBe('e4')
    expect(r.date_source).toBe('relative')
  })

  it('no booking on the day said → no_events', async () => {
    const r = await match('kal Pushpanjali mein khana thanda tha')
    expect(r.status).toBe('no_events')
    expect(r.reasons[0]).toMatch(/date and venue mentioned/)
  })

  it('after midnight, last night counts too', async () => {
    vi.setSystemTime(new Date('2026-11-16T20:30:00Z'))
    const d = deps()
    const r = await match('Manaktala mein shaam ko khana thanda tha', d)
    expect(d.eventsOn).toHaveBeenCalledWith('2026-11-16', ['am'])
    expect(r.status).toBe('matched')
    expect(r.event!.calendar_event_id).toBe('e4')
    expect(r.date).toBe('2026-11-16')
  })

  it('during the day, yesterday is NOT searched unless said', async () => {
    const d = deps()
    await match('Manaktala mein shaam ko khana thanda tha', d)
    expect(d.eventsOn).toHaveBeenCalledTimes(1)
    expect(d.eventsOn).toHaveBeenCalledWith(TODAY, ['am'])
  })

  it('hint date (from the recording) is used when the words say no date', async () => {
    const r = await match('Pushpanjali mehendi', deps(), '2026-11-15')
    expect(r.date_source).toBe('from_recording')
    expect(r.event!.calendar_event_id).toBe('e5')
  })

  it('kill switch on → calendar_paused, no bookings read', async () => {
    const d = deps({ killSwitchOn: async () => true })
    const r = await match('Pushpanjali lunch', d)
    expect(r.status).toBe('calendar_paused')
    expect(d.eventsOn).not.toHaveBeenCalled()
  })

  it('the only booking that day is matched even with nothing specific said', async () => {
    const r = await match('khana thanda tha', deps({ eventsOn: vi.fn(async () => [EVENTS[2]]) }))
    expect(r.status).toBe('matched')
    expect(r.reasons).toContain('the only booking that day at any venue')
  })
})
