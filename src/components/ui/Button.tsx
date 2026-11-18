// =============================================================================
// WHAT THIS FILE IS
//   The shared button: primary / secondary / ghost / danger, three sizes, and a
//   loading state. buttonClass() gives a <Link> the exact same look.
// WHY IT EXISTS
//   One button style across the app. The loading state also disables the
//   button, which stops double-taps from sending a request twice.
//   Sizes: sm (32px) for row actions, md (40px) for toolbars, lg (48px) for the
//   main action of a form or screen — big enough for a thumb.
// USED BY
//   All pages
// =============================================================================
import type { ButtonHTMLAttributes } from 'react'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-[linear-gradient(180deg,#26324b,#172033)] text-white shadow-[0_8px_20px_-12px_rgb(23_32_51/0.8),inset_0_1px_0_rgb(255_255_255/0.08)] hover:shadow-[0_12px_24px_-12px_rgb(224_162_37/0.7),inset_0_1px_0_rgb(255_255_255/0.08)] active:bg-navy-950 disabled:bg-none disabled:bg-ink/35 disabled:shadow-none',
  secondary: 'bg-surface text-ink ring-1 ring-inset ring-line shadow-[0_1px_2px_rgb(23_32_51/0.05)] hover:bg-subtle hover:ring-line-strong active:bg-canvas disabled:text-faint',
  ghost: 'text-muted hover:bg-ink/[0.05] hover:text-ink active:bg-ink/[0.08] disabled:text-faint',
  danger: 'bg-danger text-white hover:bg-[#a83409] active:bg-[#922d07] disabled:bg-danger/40',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-3 text-[13px] [&_svg]:size-3.5',
  md: 'h-10 gap-2 px-4 text-sm [&_svg]:size-4',
  lg: 'h-12 gap-2 px-5 text-[15px] [&_svg]:size-[18px]',
}

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra = '') {
  return `inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-xl font-semibold
    transition-[color,background-color,box-shadow,transform] duration-200 active:scale-[0.98] motion-reduce:transform-none disabled:pointer-events-none disabled:cursor-not-allowed
    ${VARIANTS[variant]} ${SIZES[size]} ${extra}`
}

export function Button({ variant = 'primary', size = 'md', loading = false, className = '', children, disabled, type = 'button', ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }) {
  return (
    <button {...rest} type={type} disabled={disabled || loading} aria-busy={loading || undefined}
      className={buttonClass(variant, size, className)}>
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  )
}

/** Square icon-only button (toolbar refresh, close, etc.). Always needs an aria-label. */
export function IconButton({ className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { 'aria-label': string }) {
  return (
    <button type="button" {...rest}
      className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-ink/[0.05] hover:text-ink disabled:opacity-50 [&_svg]:size-[18px] ${className}`}>
      {children}
    </button>
  )
}
