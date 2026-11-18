// =============================================================================
// WHAT THIS FILE IS
//   A list of issues grouped by the dish / thing they are about.
// WHY IT EXISTS
//   One recording can have many problems, several about the same dish:
//
//     [fork] Dal Makhani ×2
//       │ [Kitchen] Served cold at the buffet…
//       │ [Kitchen] Too much salt…
//     [fork] Paneer Tikka
//       │ [Kitchen] Undercooked…
//     [tag] Washroom
//       │ [Housekeeping] Not cleaned…
//     Other issues                 ← problems with no specific item
//       │ …
//
//   The dish name appears once; its problems sit under it. The caller decides
//   how each single issue looks (renderIssue), so this works for any issue type.
// USED BY
//   pages/MySubmissions/MySubmissionsPage.tsx, pages/Recording/RecordPage.tsx
// =============================================================================
import type { ReactNode } from 'react'
import { ItemTag } from './ItemTag'
import { groupByItem } from '../utils/itemGroups'

export function IssuesByItem<T>({ issues, itemOf, categoryOf, renderIssue, className = '' }: {
  issues: T[]
  itemOf: (t: T) => string | null | undefined
  categoryOf: (t: T) => string | null | undefined
  renderIssue: (t: T, index: number) => ReactNode
  className?: string
}) {
  const groups = groupByItem(issues, itemOf, categoryOf)
  return (
    <ul className={`space-y-3.5 ${className}`}>
      {groups.map((g) => (
        <li key={g.key || 'none'}>
          {g.key
            ? <ItemTag item={g.item} category={g.category} count={g.issues.length} />
            : groups.length > 1 && <p className="text-xs font-semibold text-muted">Other issues</p>}
          <ul className={`mt-2 space-y-2.5 ${g.key || groups.length > 1 ? 'ml-1.5 border-l-2 border-line pl-3' : ''}`}>
            {g.issues.map((t, i) => <li key={i}>{renderIssue(t, i)}</li>)}
          </ul>
        </li>
      ))}
    </ul>
  )
}
