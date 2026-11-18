// =============================================================================
// WHAT THIS FILE IS
//   Page-level building blocks: PageHeader, Card, SectionHeader, Segmented,
//   Switch, Alert, EmptyState and Skeleton.
// WHY IT EXISTS
//   Every page used to repeat its own title block, error box, empty state and
//   "Loading…" text with slightly different spacing. These keep the rhythm of
//   every screen identical:
//     PageHeader   serif title + short marigold rule + one line of context +
//                  actions on the right (align="center" for the Record page)
//     Card         white surface, 16px radius, warm hairline, soft float shadow
//                  (interactive → lifts on hover)
//     Alert        inline message: info / ok / warn / danger
//     EmptyState   icon + what is empty + what to do about it
//     Skeleton     grey placeholders in the shape of the content to come
// USED BY
//   pages/*
// =============================================================================
import type { ReactNode } from 'react'
import { Icon, type IconName } from '../Icon'

export function PageHeader({ title, description, actions, back, align = 'left' }: {
  title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode; align?: 'left' | 'center'
}) {
  const center = align === 'center'
  return (
    <header className={`mb-5 md:mb-9 ${center ? 'text-center' : ''}`}>
      {back && <div className="mb-3">{back}</div>}
      <div className={`flex flex-wrap gap-x-4 gap-y-4 ${center ? 'flex-col items-center' : 'items-end justify-between'}`}>
        <div className="min-w-0">
          <h1 className={`font-serif font-normal leading-[1.08] tracking-[-0.02em] text-ink
            ${center ? 'text-[2.1rem] md:text-[3.4rem]' : 'text-[2.15rem] md:text-[2.6rem]'}`}>{title}</h1>
          <span aria-hidden="true" className={`mt-2.5 block h-0.5 w-12 rounded-full bg-marigold md:mt-3 ${center ? 'mx-auto w-14' : ''}`} />
          {description && (
            <div className={`mt-3 max-w-2xl leading-relaxed text-ink/75 md:mt-3.5 ${center ? 'mx-auto text-sm md:text-base' : 'text-sm md:text-[15px]'}`}>{description}</div>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}

export function Card({ children, className = '', as: As = 'div', interactive = false }: {
  children: ReactNode; className?: string; as?: 'div' | 'section' | 'li' | 'aside'; interactive?: boolean
}) {
  return <As className={`rounded-2xl border border-line/80 bg-surface shadow-card ${interactive ? 'lift' : ''} ${className}`}>{children}</As>
}

export function SectionHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[17px] font-bold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-sm leading-relaxed text-muted">{description}</p>}
      </div>
      {actions}
    </div>
  )
}

/** Segmented control: a few mutually exclusive options in one bar. */
export function Segmented<T extends string>({ value, onChange, options, label, className = '' }: {
  value: T; onChange: (v: T) => void; options: readonly (readonly [T, string])[]; label: string; className?: string
}) {
  return (
    <div role="radiogroup" aria-label={label}
      className={`inline-grid auto-cols-fr grid-flow-col gap-1 rounded-xl border border-line/80 bg-surface p-1 shadow-card ${className}`}>
      {options.map(([key, text]) => {
        const on = value === key
        return (
          <button key={key} type="button" role="radio" aria-checked={on} onClick={() => onChange(key)}
            className={`h-8 min-w-0 truncate rounded-lg px-1 text-xs font-semibold transition-all duration-200 sm:px-3.5 sm:text-[13px]
              ${on ? 'bg-ink text-white shadow-[0_6px_14px_-8px_rgb(23_32_51/0.8)]' : 'text-muted hover:bg-ink/[0.05] hover:text-ink'}`}>
            {text}
          </button>
        )
      })}
    </div>
  )
}

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: () => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onChange}
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50 ${checked ? 'bg-ok' : 'bg-line-strong'}`}>
      <span className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${checked ? 'translate-x-4' : ''}`} />
    </button>
  )
}

type AlertTone = 'info' | 'ok' | 'warn' | 'danger'
const ALERT: Record<AlertTone, { box: string; icon: IconName }> = {
  info: { box: 'bg-accent-soft text-[#7a5408] border-marigold/25', icon: 'sparkles' },
  ok: { box: 'bg-ok-soft text-ok border-ok/20', icon: 'checkCircle' },
  warn: { box: 'bg-warn-soft text-warn border-warn/20', icon: 'alert' },
  danger: { box: 'bg-danger-soft text-danger border-danger/20', icon: 'alert' },
}

export function Alert({ tone = 'danger', title, children, action, icon, className = '' }: {
  tone?: AlertTone; title?: ReactNode; children?: ReactNode; action?: ReactNode; icon?: IconName; className?: string
}) {
  const s = ALERT[tone]
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`flex items-start gap-3 rounded-lg border px-3.5 py-3 text-sm ${s.box} ${className}`}>
      <Icon name={icon ?? s.icon} className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 leading-relaxed">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-0.5 opacity-90' : ''}>{children}</div>}
      </div>
      {action && <div className="-my-1 shrink-0">{action}</div>}
    </div>
  )
}

export function EmptyState({ icon = 'inbox', title, description, action }: {
  icon?: IconName; title: ReactNode; description?: ReactNode; action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong bg-surface/70 px-6 py-14 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent ring-1 ring-marigold/25">
        <Icon name={icon} className="size-5" />
      </span>
      <p className="mt-4 font-serif text-xl">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`skeleton block rounded-md ${className}`} />
}

/** A stack of skeleton rows inside a card, used while a list loads. */
export function ListSkeleton({ rows = 5, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <Card className="divide-y divide-line overflow-hidden">
      <span className="sr-only" role="status">{label}…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-4">
          <Skeleton className="h-5 w-20 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className={`h-3.5 ${i % 3 === 0 ? 'w-4/5' : 'w-full'}`} />
            <Skeleton className={`h-3 ${i % 2 ? 'w-2/5' : 'w-3/5'}`} />
          </div>
          <Skeleton className="hidden h-3 w-16 sm:block" />
        </div>
      ))}
    </Card>
  )
}
