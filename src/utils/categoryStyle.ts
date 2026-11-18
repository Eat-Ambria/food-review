// =============================================================================
// WHAT THIS FILE IS
//   A fixed colour for each issue category, plus the order of the day's shifts.
// WHY IT EXISTS
//   Scanning a long list is faster when "Kitchen" always looks the same. Each
//   category has ONE fixed soft colour (never assigned by position), and the
//   name is always written next to it, so colour is never the only clue.
//   Shifts are listed in the order they happen during the day.
// USED BY
//   components/IssueCard.tsx, pages/Issues/IssuesPage.tsx
// =============================================================================

const TONES: Record<string, string> = {
  'Kitchen':       'bg-orange-100 text-orange-800 ring-orange-200',
  'F&B Service':   'bg-amber-100 text-amber-800 ring-amber-200',
  'Beverage':      'bg-teal-100 text-teal-800 ring-teal-200',
  'Crockery':      'bg-stone-200/80 text-stone-700 ring-stone-200',
  'Housekeeping':  'bg-sky-100 text-sky-800 ring-sky-200',
  'Maintenance':   'bg-rose-100 text-rose-800 ring-rose-200',
  'Decor':         'bg-pink-100 text-pink-800 ring-pink-200',
  'Entertainment': 'bg-violet-100 text-violet-800 ring-violet-200',
  'Security':      'bg-emerald-100 text-emerald-800 ring-emerald-200',
  'Horticulture':  'bg-lime-100 text-lime-800 ring-lime-200',
  'IT & Tech':     'bg-indigo-100 text-indigo-800 ring-indigo-200',
}
const OTHER = 'bg-slate-200/80 text-slate-700 ring-slate-200'

/** Tailwind classes for a category chip (background, text, ring). */
export const categoryTone = (name: string | null | undefined) => TONES[name ?? ''] ?? OTHER

export const SHIFT_ORDER: Record<string, number> = { Morning: 1, Lunch: 2, Sundowner: 3, Dinner: 4 }

/** Morning/Lunch → sun, Sundowner → sunset, Dinner → moon (shown next to the shift name). */
export const shiftIcon = (shift: string | null | undefined): 'sun' | 'sunset' | 'moon' | null =>
  shift === 'Dinner' ? 'moon' : shift === 'Sundowner' ? 'sunset' : shift === 'Morning' || shift === 'Lunch' ? 'sun' : null
