// =============================================================================
// WHAT THIS FILE IS
//   The Ambria Issue Desk mark: a gold cloche (the dome a banquet dish is
//   served under) on its tray, with a small sparkle: food, service, review.
// WHY IT EXISTS
//   One mark everywhere: sidebar, phone top bar, login page. The favicon
//   (public/favicon.svg) and the PNG app icons (scripts/make-icons.mjs) draw
//   the same shape from the same numbers, so they always match.
//   Geometry (32×32 grid):
//     dome      half circle, centre (15, 21), radius 9   (x 6 → 24, top at y 12)
//     knob      circle (15, 10.2), r 1.9
//     tray      line y 24.5, x 4 → 26
//     shine     short arc inside the dome (pale gold)
//     sparkle   4-point star centred (25.5, 8), arms 3.4
// USED BY
//   layouts/AppLayout.tsx, pages/Login/LoginPage.tsx
// =============================================================================
import { useId } from 'react'

export const DOME_PATH = 'M6 21 A9 9 0 0 1 24 21'
export const SPARKLE_PATH = 'M25.5 4.6 L26.5 7 L28.9 8 L26.5 9 L25.5 11.4 L24.5 9 L22.1 8 L24.5 7 Z'

export function BrandMark({ className = 'size-9', tile = true }: { className?: string; tile?: boolean }) {
  const id = useId()
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6dc94" />
          <stop offset="1" stopColor="#e0a225" />
        </linearGradient>
      </defs>
      {tile && <rect width="32" height="32" rx="8" fill="#1d2840" stroke="#e0a225" strokeOpacity="0.35" strokeWidth="0.8" />}
      <path d={DOME_PATH} fill="none" stroke={`url(#${id}-gold)`} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M10.6 18.6 A5.2 5.2 0 0 1 13.4 15.4" fill="none" stroke="#f6dc94" strokeOpacity="0.8" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="15" cy="10.2" r="1.9" fill="#e9b544" />
      <path d="M4 24.5 H26" stroke="#e0a225" strokeWidth="2.2" strokeLinecap="round" />
      <path d={SPARKLE_PATH} fill="#f6dc94" />
    </svg>
  )
}
