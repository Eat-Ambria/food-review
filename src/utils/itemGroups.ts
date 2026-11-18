// =============================================================================
// WHAT THIS FILE IS
//   Helpers that put issues about the SAME dish / thing together.
// WHY IT EXISTS
//   One recording (or one function) often has several problems, and often
//   several about the same dish ("Dal Makhani was cold" + "Dal Makhani too
//   salty"). Reading them together is much easier:
//     • groupByItem   → [{ item, category, issues[] }], items in the order they
//                       were first mentioned, issues without an item last
//     • itemCounts    → [{ item, category, count }] for a one-line overview
//     • sortByItem    → same list, re-ordered so same-item issues sit together
//   "dal makhani", "Dal Makhani" and "Dal  makhani" count as the same item.
// USED BY
//   pages/Issues/IssuesPage.tsx, pages/MySubmissions, pages/Recording/RecordPage.tsx
// =============================================================================

export const itemKey = (item: string | null | undefined) =>
  (item ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()

export interface ItemGroup<T> { key: string; item: string | null; category: string | null; issues: T[] }

export function groupByItem<T>(
  issues: T[],
  itemOf: (t: T) => string | null | undefined,
  categoryOf: (t: T) => string | null | undefined,
): ItemGroup<T>[] {
  const groups = new Map<string, ItemGroup<T>>()
  for (const it of issues) {
    const key = itemKey(itemOf(it))
    if (!groups.has(key)) groups.set(key, { key, item: itemOf(it) ?? null, category: categoryOf(it) ?? null, issues: [] })
    groups.get(key)!.issues.push(it)
  }
  const named = [...groups.values()].filter((g) => g.key)
  const unnamed = groups.get('')
  return unnamed ? [...named, unnamed] : named
}

export function itemCounts<T>(
  issues: T[],
  itemOf: (t: T) => string | null | undefined,
  categoryOf: (t: T) => string | null | undefined,
) {
  return groupByItem(issues, itemOf, categoryOf)
    .filter((g) => g.key)
    .map((g) => ({ key: g.key, item: g.item!, category: g.category, count: g.issues.length }))
}

export function sortByItem<T>(
  issues: T[],
  itemOf: (t: T) => string | null | undefined,
): T[] {
  return groupByItem(issues, itemOf, () => null).flatMap((g) => g.issues)
}
