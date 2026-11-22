// Finds serious keywords in complaint text as whole words, ignoring venue, lawn and hall names (same rules as the server).
export const padNorm = (t: string) => ' ' + t.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim() + ' '

export interface PlaceSource { venue_name: string; sub_venues?: string[] | null; aliases?: { alias: string }[] | null }

export function placeNames(venues: PlaceSource[]): string[] {
  return [...new Set(venues.flatMap((v) => [v.venue_name, ...(v.sub_venues ?? []), ...(v.aliases ?? []).map((a) => a.alias)])
    .filter(Boolean))]
}

export function matchKeywords(keywords: string[], texts: (string | null | undefined)[], places: string[]): string[] {
  if (!texts.some(Boolean)) return []
  const strip = places.map((p) => padNorm(p).trim()).filter((p) => p.includes(' ')).sort((a, b) => b.length - a.length)
  let hay = padNorm(texts.filter(Boolean).join(' \n '))
  for (const p of strip) hay = hay.split(' ' + p + ' ').join(' ')
  return keywords.filter((k) => {
    const kw = padNorm(k).trim()
    return kw && hay.includes(' ' + kw + ' ')
  })
}

export function placesContaining(keyword: string, places: string[]): string[] {
  const kw = padNorm(keyword).trim()
  if (!kw) return []
  return places.filter((p) => padNorm(p).includes(' ' + kw + ' '))
}
