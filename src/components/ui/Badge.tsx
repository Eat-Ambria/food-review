// =============================================================================
// WHAT THIS FILE IS
//   A small coloured pill for statuses (Active, Locked, Default PIN, Ready…).
// WHY IT EXISTS
//   Gives every status in the app the same look, and the colour always comes
//   with text, so it is still readable for colour-blind users. `dot` adds a
//   small leading dot for live/state badges.
// =============================================================================
import type { ReactNode } from 'react'

export type BadgeTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' | 'solid-danger'

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-ink/[0.06] text-muted',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  accent: 'bg-accent-soft text-accent',
  'solid-danger': 'bg-danger text-white',
}

export function Badge({ tone = 'neutral', dot = false, children, className = '' }: {
  tone?: BadgeTone; dot?: boolean; children: ReactNode; className?: string
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold [&_svg]:size-3 ${TONES[tone]} ${className}`}>
      {dot && <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}
