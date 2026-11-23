// Finds menu dishes in spoken text, allowing near spellings ("gold coin" = "Golden Coin"); same rules as the server.
export interface DishRow { name: string; name_hi: string | null; section: string | null }
export interface DishEntry { dish: DishRow; forms: string[][] }

const WORD = /[\p{L}\p{M}\p{N}]+/gu
const words = (t: string) => [...t.normalize('NFKC').toLowerCase().matchAll(WORD)].map((m) => m[0])

export function dishEntries(rows: DishRow[]): DishEntry[] {
  return rows.map((dish) => {
    const forms = new Map<string, string[]>()
    for (const raw of [dish.name, dish.name_hi]) {
      if (!raw) continue
      for (const v of [raw, raw.split('(')[0]]) {
        const w = words(v)
        if (w.length && w.join(' ').length >= 3) forms.set(w.join(' '), w)
      }
    }
    return { dish, forms: [...forms.values()] }
  })
}

const same = (a: string, b: string) =>
  a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)))

export function findDishes(text: string, entries: DishEntry[]): { dishes: DishRow[]; stripped: string; words: Set<string> } {
  const norm = text.normalize('NFKC')
  const toks = [...norm.matchAll(WORD)].map((m) => ({ w: m[0].toLowerCase(), start: m.index!, end: m.index! + m[0].length }))
  const hits = new Map<string, DishRow>()
  const ranges: [number, number][] = []
  const matched = new Set<string>()
  for (const { dish, forms } of entries) {
    for (const f of forms) {
      if (f.length === 1) {
        if (toks.some((t) => t.w === f[0])) hits.set(dish.name, dish)
        continue
      }
      for (let i = 0; i + f.length <= toks.length; i++) {
        if (f.every((w, k) => same(w, toks[i + k].w))) {
          hits.set(dish.name, dish)
          ranges.push([toks[i].start, toks[i + f.length - 1].end])
          for (let k = 0; k < f.length; k++) matched.add(toks[i + k].w)
        }
      }
    }
  }
  ranges.sort((a, b) => a[0] - b[0])
  let stripped = ''
  let pos = 0
  for (const [s, e] of ranges) {
    if (e <= pos) continue
    stripped += norm.slice(pos, Math.max(pos, s)) + ' '
    pos = e
  }
  stripped += norm.slice(pos)
  return { dishes: [...hits.values()], stripped: stripped.replace(/\s{2,}/g, ' ').trim(), words: matched }
}

export function isDishWord(said: string | null | undefined, matched: Set<string>): boolean {
  const w = words(said ?? '')
  return w.length > 0 && w.every((x) => matched.has(x) || [...matched].some((d) => same(d, x)))
}
