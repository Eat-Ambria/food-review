// Builds the reason text required when deleting an issue or recording.
export const DELETE_REASONS = ['Duplicate', 'Wrong recording', 'Not an issue', 'Other'] as const
export type DeleteReasonChip = (typeof DELETE_REASONS)[number]

export const normalizeReason = (s: string): string => Array.from(s.replace(/\s+/g, ' ').trim()).slice(0, 500).join('')

export function buildDeleteReason(chip: DeleteReasonChip | null, note: string): string {
  const n = normalizeReason(note)
  if (chip && chip !== 'Other') return normalizeReason(n ? `${chip}: ${n}` : chip)
  return n
}

export const isValidDeleteReason = (r: string): boolean => {
  const n = normalizeReason(r)
  const len = Array.from(n).length
  return len >= 3 && len <= 500
}
