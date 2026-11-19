// Lists issues grouped by dish or thing (e.g. Paneer ×2, then its problems).
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
