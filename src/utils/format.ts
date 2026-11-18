// =============================================================================
// WHAT THIS FILE IS
//   Small display formatters shared across screens.
// WHY IT EXISTS
//   Keeps formatting consistent (e.g. every timer reads 1:05, never 65s) and
//   keeps component files exporting only components (needed by React Fast Refresh).
// =============================================================================

/** Seconds → "m:ss", e.g. 65 → "1:05". */
export const fmtTime = (s: number): string => {
  const t = Math.max(0, Math.floor(s))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}
