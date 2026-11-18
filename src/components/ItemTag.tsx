// =============================================================================
// WHAT THIS FILE IS
//   The "what is this issue about" label: the dish, drink or thing the AI
//   picked out of the recording ("Dal Makhani", "AC", "Washroom").
// WHY IT EXISTS
//   The first thing a POC wants to know is WHICH dish / thing has the problem,
//   so it gets its own clearly visible tag instead of plain bold text:
//     [fork-and-knife] Dal Makhani     → food & drink categories
//     [tag]            AC              → everything else
//   Shown everywhere an issue is listed, so it always looks the same.
// USED BY
//   components/IssueCard.tsx, pages/MySubmissions, pages/Recording/RecordPage.tsx
// =============================================================================
import { Icon } from './Icon'
import { displayItem } from '../utils/itemName'

const FOOD = new Set(['Kitchen', 'F&B Service', 'Beverage', 'Crockery'])

export function ItemTag({ item, category, size = 'md', count, showOne = false, className = '' }: {
  item: string | null | undefined
  category?: string | null
  size?: 'sm' | 'md'
  count?: number            // > 1 → "×2" (several problems with this item)
  showOne?: boolean         // also show "×1" (the Issues page "Items" line)
  className?: string
}) {
  if (!item) return null
  const food = FOOD.has(category ?? '')
  return (
    <span title={food ? 'Dish / drink' : 'Item'}
      className={`chip-hover inline-flex max-w-full items-center gap-1.5 rounded-full align-middle font-semibold text-ink
        ${food ? 'bg-orange-100/80' : 'bg-ink/[0.07]'}
        ${size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-[13px]'} ${className}`}>
      <Icon name={food ? 'utensils' : 'tag'} className={`shrink-0 ${size === 'sm' ? 'size-3' : 'size-3.5'} ${food ? 'text-orange-700' : 'text-muted'}`} />
      <span className="truncate">{displayItem(item)}</span>
      {count !== undefined && (count > 1 || showOne) && (
        <span className={`text-[11px] font-semibold tabular-nums ${food ? 'text-orange-700/80' : 'text-muted'}`}
          aria-label={`${count} issue${count === 1 ? '' : 's'}`}>×{count}</span>
      )}
    </span>
  )
}
