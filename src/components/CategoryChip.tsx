// Shows an issue's department (Kitchen, Housekeeping…) as a coloured chip.
import { categoryTone } from '../utils/categoryStyle'

export function CategoryChip({ name, className = '' }: { name: string | null | undefined; className?: string }) {
  return (
    <span className={`inline-flex items-center truncate whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-0 ${categoryTone(name)} ${className}`}>
      {name ?? 'Other'}
    </span>
  )
}
