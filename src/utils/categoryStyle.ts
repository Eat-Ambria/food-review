// A colour for each department, and the order of the day's shifts.
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

export const categoryTone = (name: string | null | undefined) => TONES[name ?? ''] ?? OTHER

export const SHIFT_ORDER: Record<string, number> = { Morning: 1, Lunch: 2, Sundowner: 3, Dinner: 4 }

export const shiftIcon = (shift: string | null | undefined): 'sun' | 'sunset' | 'moon' | null =>
  shift === 'Dinner' ? 'moon' : shift === 'Sundowner' ? 'sunset' : shift === 'Morning' || shift === 'Lunch' ? 'sun' : null
