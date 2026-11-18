// =============================================================================
// WHAT THIS FILE IS
//   The coloured chip for an issue category ("Kitchen", "Decor"…).
// WHY IT EXISTS
//   The same category must look the same on Record, Issues and My submissions,
//   so scanning a long list is fast. Colours come from utils/categoryStyle.ts.
// =============================================================================
import { categoryTone } from '../utils/categoryStyle'

export function CategoryChip({ name, className = '' }: { name: string | null | undefined; className?: string }) {
  return (
    <span className={`inline-flex items-center truncate whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${categoryTone(name)} ${className}`}>
      {name ?? 'Other'}
    </span>
  )
}
