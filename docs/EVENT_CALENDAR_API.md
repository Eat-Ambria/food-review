<!--
  WHAT THIS FILE IS: the Event Calendar API, as this app uses it.
  WHY: the Issue Desk reads bookings from the existing Ambria Event Calendar to
  match a complaint to the right event. The full API reference lives in the
  Calendar project: Desktop/ambria-calendar/ambria-calendar/API.md.
  This file covers only the parts the Issue Desk needs, plus how it is connected.
  NO KEYS IN THIS FILE: it is committed to git.
-->
# Event Calendar API (as used by Issue Desk)

Full reference: `Desktop/ambria-calendar/ambria-calendar/API.md` (Calendar project).

## 1. What it is
The Calendar has no custom backend. Its data is in a **separate Supabase project**, and Supabase
serves every table as a REST API (PostgREST).

| | |
|---|---|
| Base URL | `https://aqpaiyiriarnqhmnxtpt.supabase.co/rest/v1` |
| Key | the Calendar project's **anon key**, found in `ambria-calendar/.env` (`VITE_SUPABASE_ANON_KEY`) |
| Headers | `apikey: <KEY>` and `Authorization: Bearer <KEY>` |

⚠️ This key can also **create, change and delete** bookings. In the Issue Desk it is kept **only** as an
Edge Function secret, and the `event-calendar` function only ever makes **read (GET)** requests.

## 2. How the Issue Desk connects
Supabase (Issue Desk project) → Edge Functions → **Secrets**:

| Secret | Value |
|---|---|
| `EVENT_CALENDAR_API_URL` | `https://aqpaiyiriarnqhmnxtpt.supabase.co/rest/v1` |
| `EVENT_CALENDAR_API_KEY` | the Calendar anon key (copy it from `ambria-calendar/.env`) |

Code: `supabase/functions/event-calendar/index.ts` (Verify JWT **OFF**; it checks the user itself).

## 3. Rules from the Calendar that we follow
1. **Never show deleted bookings:** always `deleted_at=is.null`.
2. **Kill switch:** `GET /app_settings?select=value&key=eq.kill_switch`. If `value = on`, show **no** bookings.
3. **Read only.** Never `POST` / `PATCH`. Bookings with `crm_id` starting `lms:` come from LMS and are synced every 5 minutes.
4. Dates are `YYYY-MM-DD`; times are `HH:MM:SS` (24h, India time).
5. At most 1000 rows per request. We always filter by one day, so this is never reached.

## 4. Calls the Issue Desk makes

### 4.1 Categories (venues): used by Admin → Venues → "Import from Calendar"
```
GET /categories?select=venue_id,name,short_code,category_type,sub_venues,is_active,sort_order&order=sort_order
```
| venue_id | Name | Kind |
|---|---|---|
| `ap` | Ambria Pushpanjali | own venue |
| `am` | Ambria Manaktala | own venue |
| `ae` | Ambria Exotica | own venue |
| `ar` | Ambria Restro | own venue |
| `villa` | Villa (kothi stays) | stay |
| `add` | Ambria Design & Decor | outside venue (decor) |
| `ac` | Ambria Cuisine | outside venue (catering) |
| `aee` | Ambria Events | outside venue (entertainment) |
| `ws` | Wedding Services | service |
| `tender` | Tender | tender |

`sub_venues` lists the lawns and halls inside each venue (e.g. AP: Amber Lawn, Glass House, Carnelian Deck…).

### 4.2 Bookings on one day: used by the Record page to find the event
Three reads, merged and de-duplicated by `id`:
```
# single-day bookings on the date
GET /events?select=<fields>&deleted_at=is.null&or=(status.is.null,status.neq.Cancelled)
            &venue_id=in.(ap,am)&date=eq.2026-11-15&order=time.asc

# multi-day bookings (Tender / Wedding Services: date → end_date) that cover the date
GET /events?...&date=lt.2026-11-15&end_date=gte.2026-11-15

# Villa stays (check_in_date → check_out_date) that cover the date
GET /events?...&check_in_date=lt.2026-11-15&check_out_date=gte.2026-11-15
```
`<fields>` (only what is needed to recognise an event; no phone numbers or payments):
`id, venue_id, title, status, date, end_date, time, shift, sub_venue, event_type, event_type_other, guest_name, pax, check_in_date, check_out_date, venue_name`

Cancelled bookings are left out. Bookings with an empty status are kept.

## 5. Booking fields we use

| Field | Meaning |
|---|---|
| `id` | booking id (uuid). Stored on the submission as `calendar_event_id` |
| `venue_id` | category (`ap`, `am`, …), linked to our `venues.calendar_venue_id` |
| `title` | what the Calendar shows, e.g. `Sharma \| Wedding \| 300pax \| D \| MV` |
| `status` | `Confirmed`, `Tentative`, `Cancelled`, `Postponed` |
| `date`, `end_date` | event day / last day (multi-day) |
| `time`, `shift` | start time; `Morning`, `Lunch`, `Sundowner`, `Dinner` |
| `sub_venue` | lawn / hall |
| `event_type`, `event_type_other` | function type (Wedding, Engagement…; `Other` uses `event_type_other`) |
| `guest_name`, `pax` | guest name, guest count (text) |
| `check_in_date`, `check_out_date` | Villa stays |
| `venue_name` | outside-venue name (for `add`, `ac`, `aee`) |

**Guest name and function name in a complaint come only from the booking the user picks.** They are never guessed.

## 6. Checked live (2026-11-16)
- `categories` returns ap / am / ae / ar / villa / … with their sub-venues.
- Kill switch is `off`.
- The three `events` queries above return HTTP 200. On 2026-11-15 there were 6 bookings across AP / AM / AE / AR, all Confirmed, so several bookings per day are normal and the user must pick one.

## 7. Known risk
The Calendar's tables are currently readable with its public anon key. If the Calendar's planned
security lockdown makes them readable only by logged-in users, this connection will stop working and
will need a read-only access path (e.g. a dedicated read-only function in the Calendar project).
