// Groups issues about the same dish or thing together.
import { displayItem } from './itemName'

export const itemKey = (item: string | null | undefined) =>
  displayItem(item).toLowerCase()

export interface ItemGroup<T> { key: string; item: string | null; category: string | null; issues: T[] }

export function groupByItem<T>(
  issues: T[],
  itemOf: (t: T) => string | null | undefined,
  categoryOf: (t: T) => string | null | undefined,
): ItemGroup<T>[] {
  const groups = new Map<string, ItemGroup<T>>()
  for (const it of issues) {
    const key = itemKey(itemOf(it))
    if (!groups.has(key)) groups.set(key, { key, item: key ? displayItem(itemOf(it)) : null, category: categoryOf(it) ?? null, issues: [] })
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
