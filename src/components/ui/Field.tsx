// =============================================================================
// WHAT THIS FILE IS
//   Text inputs, selects and the search box, styled to match the rest of the app.
// WHY IT EXISTS
//   Forms (Add/Edit user, filters) repeat the same label + input + hint
//   layout. This keeps them consistent and accessible (label is linked to input).
//   inputClass() is exported for the few inputs that need a custom layout.
// USED BY
//   pages/*
// =============================================================================
import { useId, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react'
import { Icon } from '../Icon'

const BASE = 'w-full min-w-0 rounded-lg border border-line bg-surface text-ink outline-none transition-[border-color,box-shadow] placeholder:text-faint hover:border-line-strong focus:border-ink/60 focus:ring-[3px] focus:ring-marigold/20 disabled:bg-subtle disabled:text-muted aria-[invalid=true]:border-danger'

export const inputClass = (size: 'md' | 'lg' = 'md', extra = '') =>
  `${BASE} ${size === 'lg' ? 'h-12 px-4 text-[15px]' : 'h-10 px-3 text-sm'} ${extra}`

const CHEVRON = "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%235d687a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")] bg-[length:16px] bg-[right_10px_center] bg-no-repeat appearance-none pr-9"

export function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-semibold text-ink">{children}</label>
}

export function TextField({ label, hint, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = useId()
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <input id={id} {...rest} className={inputClass('md', 'h-11')} aria-describedby={hint ? `${id}-hint` : undefined} />
      {hint && <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  )
}

export function SelectField({ label, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const id = useId()
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <select id={id} {...rest} className={`${inputClass('md', 'h-11 cursor-pointer')} ${CHEVRON}`}>{children}</select>
    </div>
  )
}

/** Compact select without a visible label, for filter bars. */
export function FilterSelect({ label, children, className = '', ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <select aria-label={label} {...rest} className={`${inputClass('md', 'cursor-pointer font-medium')} ${CHEVRON} ${className}`}>
      {children}
    </select>
  )
}

/** Search box with a leading icon and a clear button. */
export function SearchInput({ value, onChange, placeholder, label, className = '', size = 'md' }: {
  value: string; onChange: (v: string) => void; placeholder: string; label: string; className?: string; size?: 'md' | 'lg'
}) {
  return (
    <div className={`relative ${className}`}>
      <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label}
        className={inputClass(size, 'pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden')} />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label="Clear search"
          className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-faint transition-colors hover:bg-ink/[0.05] hover:text-ink">
          <Icon name="x" className="size-3.5" />
        </button>
      )}
    </div>
  )
}

/** Checkbox / radio row with a title and an optional description. */
export function ChoiceRow({ type = 'checkbox', checked, onChange, title, description, name, disabled, trailing }: {
  type?: 'checkbox' | 'radio'; checked: boolean; onChange: (checked: boolean) => void
  title: React.ReactNode; description?: React.ReactNode; name?: string; disabled?: boolean; trailing?: React.ReactNode
}) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors
      ${checked ? 'border-ink/70 bg-subtle' : 'border-line hover:border-line-strong hover:bg-subtle'} ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
      <input type={type} name={name} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-ink" />
      <span className="min-w-0 flex-1 text-sm">
        <span className="block font-semibold">{title}</span>
        {description && <span className="mt-0.5 block text-xs leading-relaxed text-muted">{description}</span>}
      </span>
      {trailing}
    </label>
  )
}
