// Types for venues and Calendar bookings.
export interface VenueAlias { id: string; venue_id: string; alias: string; alias_normalized: string }

export interface Venue {
  id: string
  venue_name: string
  calendar_venue_id: string | null
  sub_venues: string[]
  is_active: boolean
  sort_order: number
  aliases: VenueAlias[]
}

export interface CalendarCategory {
  venue_id: string
  name: string
  short_code: string | null
  category_type: string | null
  sub_venues: string[] | null
  is_active: boolean
}

export interface CalendarEvent {
  id: string
  venue_id: string
  title: string | null
  status: string | null
  date: string
  end_date: string | null
  time: string | null
  shift: string | null
  sub_venue: string | null
  event_type: string | null
  event_type_other: string | null
  guest_name: string | null
  pax: string | null
  check_in_date: string | null
  check_out_date: string | null
  venue_name: string | null
}

export interface MatchCandidate {
  calendar_event_id: string
  date: string
  title: string | null
  guest_name: string | null
  function_name: string | null
  shift: string | null
  time: string | null
  sub_venue: string | null
  calendar_venue_id: string
  venue_id: string | null
  venue_name: string
  score: number
  reasons: string[]
}

export interface EventMatch {
  status: 'matched' | 'ambiguous' | 'no_events' | 'not_enough_info' | 'calendar_paused'
  date: string | null
  date_source?: 'explicit' | 'relative' | 'assumed_today'
  venue: { id: string; name: string } | null
  venue_candidates?: { id: string; name: string; via: string }[]
  event: MatchCandidate | null
  candidates?: MatchCandidate[]
  reasons: string[]
}
