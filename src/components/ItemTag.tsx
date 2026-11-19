// Shows the dish or thing an issue is about (e.g. Paneer, AC) as a chip.
import { Icon } from './Icon'
import { displayItem } from '../utils/itemName'

const FOOD = new Set(['Kitchen', 'F&B Service', 'Beverage', 'Crockery'])

export function ItemTag({ item, category, size = 'md', count, showOne = false, className = '' }: {
  item: string | null | undefined
  category?: string | null
  size?: 'sm' | 'md'
  count?: number
  showOne?: boolean
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
