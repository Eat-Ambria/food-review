// =============================================================================
// WHAT THIS FILE IS
//   The frame around every signed-in page: navigation, the user menu and the
//   notification bell.
// WHY IT EXISTS
//   • Desktop: a fixed navy sidebar in two groups, ordered by how often each is used:
//       Work   → Record, My submissions, Issues
//       Admin  → Dashboard, Users, Venues, Serious alerts   (admins only)
//     The active page gets a lighter pill, a marigold edge and a marigold icon.
//     A thin marigold thread curves across the bottom of the sidebar.
//   • Background: warm porcelain with slow white "silk" waves.
//   • Desktop top bar: a search box (opens Issues, or My submissions for
//     recorders, with the words filled in; "/" focuses it), the bell (POCs) and
//     the account menu (name, phone-notifications switch, Change PIN, Sign out).
//   • Phone top bar: brand + bell + account menu.
//   • Phone: a bottom tab bar with up to 4 tabs. Admin's extra pages sit
//     behind "More".
//   • Links depend on the user's roles (a user may have several).
// USED BY
//   App.tsx (wraps signed-in routes)
// =============================================================================
import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Icon, type IconName } from '../components/Icon'
import { rolesOf, type Role } from '../types/auth'
import { NotificationBell } from '../components/NotificationBell'
import { AccountMenu } from '../components/AccountMenu'
import { BrandMark } from '../components/BrandMark'
import type { LayoutContext } from './barTitle'

interface NavItem { to: string; label: string; short?: string; icon: IconName; roles: Role[] }

const WORK: NavItem[] = [
  { to: '/record', label: 'Record', icon: 'mic', roles: ['recorder', 'admin'] },
  { to: '/my-submissions', label: 'My Submissions', short: 'Sent', icon: 'layers', roles: ['recorder', 'admin'] },
  { to: '/issues', label: 'Issues', icon: 'calendarCheck', roles: ['poc', 'admin'] },
]
const ADMIN: NavItem[] = [
  { to: '/admin', label: 'Dashboard', icon: 'grid', roles: ['admin'] },
  { to: '/admin/users', label: 'Users', icon: 'user', roles: ['admin'] },
  { to: '/admin/venues', label: 'Venues', icon: 'pin', roles: ['admin'] },
  { to: '/admin/alerts', label: 'Serious Alerts', short: 'Alerts', icon: 'alert', roles: ['admin'] },
]

function SideLink({ it }: { it: NavItem }) {
  return (
    <NavLink to={it.to} end={it.to === '/admin'}
      className={({ isActive }) => `group relative flex h-12 items-center gap-3.5 overflow-hidden rounded-xl px-4 text-[15px] font-medium transition-colors duration-150
        ${isActive ? 'bg-white/[0.09] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]' : 'text-white/80 hover:bg-white/[0.04] hover:text-white'}`}>
      {({ isActive }) => (
        <>
          <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] bg-marigold transition-opacity ${isActive ? 'opacity-100' : 'opacity-0'}`} />
          <Icon name={it.icon} className={`size-5 shrink-0 transition-[color,transform] duration-200 group-hover:scale-110 ${isActive ? 'text-marigold' : 'text-white/70 group-hover:text-marigold'}`} />
          {it.label}
        </>
      )}
    </NavLink>
  )
}

/** The brand mark (gold arch + lamp on navy): components/BrandMark.tsx */
function Mark({ className = 'size-5' }: { className?: string }) {
  return <BrandMark className={className} />
}

function Brand() {
  return (
    <div className="flex items-start gap-2.5 px-8 pb-7 pt-8">
      <Mark className="mt-0.5 size-11 shrink-0 drop-shadow-[0_6px_14px_rgb(224_162_37/0.25)]" />
      <div className="leading-none">
        <p className="font-serif text-[2rem] tracking-[-0.01em] text-white">Ambria</p>
        <p className="mt-1.5 pl-0.5 text-[13px] tracking-wide text-white/70">Issue Desk</p>
      </div>
    </div>
  )
}

// Search in the top bar: Enter opens Issues (or My submissions for recorders)
// with the words filled in and a 30-day range. "/" jumps to it.
function TopSearch({ canSeeIssues }: { canSeeIssues: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [q, setQ] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  const target = canSeeIssues ? '/issues' : '/my-submissions'

  // ✕: empty the box; if that page is showing a search, clear it there too ("?q=" = clear).
  const clear = () => {
    setQ('')
    if (location.pathname === target) navigate(`${target}?q=`, { replace: true })
    ref.current?.focus()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault(); ref.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <form role="search" className="group relative w-full max-w-sm"
      onSubmit={(e) => { e.preventDefault(); const t = q.trim(); if (t) { navigate(`${target}?q=${encodeURIComponent(t)}`); ref.current?.blur() } }}>
      <Icon name="search" className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-ink/70" />
      <input ref={ref} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search"
        onKeyDown={(e) => { if (e.key === 'Escape' && q) { e.preventDefault(); clear() } }}
        placeholder={canSeeIssues ? 'Search issues, venues, users...' : 'Search your submissions...'}
        className="h-11 w-full rounded-full border border-ink/10 bg-white/85 pl-11 pr-11 text-[15px] text-ink shadow-[0_1px_2px_rgb(23_32_51/0.04)] outline-none transition-[border-color,box-shadow,background-color] placeholder:text-ink/45 hover:border-ink/20 focus:border-ink/30 focus:bg-white focus:ring-4 focus:ring-marigold/15" />
      {q ? (
        <button type="button" onClick={clear} aria-label="Clear search"
          className="fade-in absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full bg-ink/[0.06] text-ink/70 transition-[background-color,color,transform] hover:rotate-90 hover:bg-ink/10 hover:text-ink">
          <Icon name="x" className="size-4" />
        </button>
      ) : (
        <kbd aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 rounded border border-line bg-subtle px-1.5 font-sans text-[11px] font-semibold text-faint group-focus-within:hidden">/</kbd>
      )}
    </form>
  )
}

export function AppLayout() {
  const { user } = useAuth()
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const [barTitle, setBarTitle] = useState<string | null>(null)   // a page's title shown in the top bar (layouts/barTitle.ts)
  useEffect(() => { setMoreOpen(false) }, [location.pathname])
  if (!user) return null

  const mine = rolesOf(user)
  const allowed = (it: NavItem) => it.roles.some((r) => mine.includes(r))
  const work = WORK.filter(allowed)
  const admin = ADMIN.filter(allowed)
  const isPoc = mine.includes('poc')

  // Phone: up to 4 tabs; anything else goes under "More".
  const mobileAll = [...work, ...admin]
  const mobileTabs = mobileAll.length <= 4 ? mobileAll : mobileAll.slice(0, 3)
  const mobileMore = mobileAll.length <= 4 ? [] : mobileAll.slice(3)
  const moreActive = mobileMore.some((m) => location.pathname === m.to || location.pathname.startsWith(m.to + '/'))

  return (
    <div className="relative flex min-h-full">
      {/* White silk waves drifting slowly behind every page. */}
      <svg aria-hidden="true" className="silk" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
        <path d="M-40 760 C 240 640, 520 820, 820 700 S 1300 520, 1500 600 L 1500 960 L -40 960 Z" fill="#ffffff" fillOpacity="0.55" />
        <path d="M600 900 C 820 760, 1040 700, 1220 520 S 1420 260, 1520 230 L 1520 960 L 600 960 Z" fill="#ffffff" fillOpacity="0.45" />
      </svg>

      {/* ---------- Desktop sidebar ---------- */}
      <aside className="sticky top-0 z-20 hidden h-screen w-[17rem] shrink-0 flex-col overflow-y-auto bg-[linear-gradient(180deg,#1a2335_0%,#141c2c_100%)] md:flex">
        <Brand />
        <nav aria-label="Main" className="relative z-10 flex-1 space-y-7 px-4 pt-2">
          {work.length > 0 && (
            <div>
              <p className="mb-2 px-4 text-xs font-medium uppercase tracking-[0.08em] text-white/55">Work</p>
              <div className="space-y-1">{work.map((it) => <SideLink key={it.to} it={it} />)}</div>
            </div>
          )}
          {admin.length > 0 && (
            <div>
              <p className="mb-2 px-4 text-xs font-medium uppercase tracking-[0.08em] text-white/55">Admin</p>
              <div className="space-y-1">{admin.map((it) => <SideLink key={it.to} it={it} />)}</div>
            </div>
          )}
        </nav>
        {/* A thin marigold thread across the bottom, drawn in once. */}
        <svg aria-hidden="true" viewBox="0 0 272 140" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 bottom-0 h-36 w-full">
          <defs>
            <linearGradient id="thread" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#e0a225" stopOpacity="0" />
              <stop offset="0.45" stopColor="#e0a225" stopOpacity="0.85" />
              <stop offset="1" stopColor="#e0a225" stopOpacity="0.15" />
            </linearGradient>
          </defs>
          <path d="M0 132 C 70 128, 120 110, 170 72 S 250 14, 272 6" fill="none" stroke="#ffffff" strokeOpacity="0.06" strokeWidth="1" />
          <path className="thread" d="M0 128 C 80 126, 130 104, 180 68 S 252 22, 272 16" fill="none" stroke="url(#thread)" strokeWidth="1.4" />
        </svg>
      </aside>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        {/* ---------- Phone top bar ---------- */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-[linear-gradient(180deg,#1a2335,#151d2d)] px-4 shadow-[0_6px_18px_-10px_rgb(23_32_51/0.6)] pt-[env(safe-area-inset-top)] text-white md:hidden">
          <div className="flex items-center gap-2">
            <Mark className="size-7" />
            <p className="font-serif text-xl leading-none">Ambria</p>
            <span className="text-xs font-medium text-white/50">Issue Desk</span>
          </div>
          <div className="flex items-center gap-1">
            {isPoc && <NotificationBell userId={user.id} tone="dark" />}
            <AccountMenu tone="dark" />
          </div>
        </header>

        {/* ---------- Desktop top bar: search | bell | account ---------- */}
        <div className="sticky top-0 z-30 hidden h-[4.5rem] items-center justify-end border-b border-black/[0.04] bg-[#f6f5f2]/80 px-8 shadow-[0_8px_24px_-20px_rgb(23_32_51/0.35)] backdrop-blur-md md:flex lg:px-10">
          {barTitle && <h1 className="mr-auto truncate pr-6 font-serif text-[2.1rem] font-medium leading-none tracking-[-0.02em] text-ink">{barTitle}</h1>}
          <TopSearch canSeeIssues={work.some((w) => w.to === '/issues')} />
          {isPoc && (
            <>
              <span aria-hidden="true" className="mx-4 h-9 w-px bg-ink/10 lg:mx-5" />
              <NotificationBell userId={user.id} align="right" />
            </>
          )}
          <span aria-hidden="true" className="mx-4 h-9 w-px bg-ink/10 lg:mx-5" />
          <AccountMenu withName />
        </div>

        <main key={location.pathname} className="page-in flex-1 px-4 pb-28 pt-7 md:px-8 md:pb-14 md:pt-10 lg:px-12">
          <Outlet context={{ setBarTitle } satisfies LayoutContext} />
        </main>

        {/* ---------- Phone bottom tabs ---------- */}
        {mobileAll.length > 1 && (
          <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
            {moreOpen && <div className="fade-in fixed inset-0 -z-10 bg-navy-950/20" onClick={() => setMoreOpen(false)} aria-hidden="true" />}
            <div className="flex">
              {mobileTabs.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.to === '/admin'}
                  className={({ isActive }) => `flex flex-1 flex-col items-center gap-0.5 pb-2 pt-2 text-[11px] font-semibold transition-colors ${isActive ? 'text-ink' : 'text-faint'}`}>
                  {({ isActive }) => (
                    <>
                      <span className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${isActive ? 'bg-accent-soft text-accent' : ''}`}>
                        <Icon name={it.icon} className="size-5" />
                      </span>
                      {it.short ?? it.label}
                    </>
                  )}
                </NavLink>
              ))}
              {mobileMore.length > 0 && (
                <button type="button" onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen}
                  className={`flex flex-1 flex-col items-center gap-0.5 pb-2 pt-2 text-[11px] font-semibold ${moreOpen || moreActive ? 'text-ink' : 'text-faint'}`}>
                  <span className={`flex h-7 w-12 items-center justify-center rounded-full ${moreOpen || moreActive ? 'bg-accent-soft text-accent' : ''}`}>
                    <Icon name="more" className="size-5" />
                  </span>
                  More
                </button>
              )}
            </div>
            {moreOpen && (
              <div className="sheet-in absolute inset-x-3 bottom-full mb-2 overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-pop">
                {mobileMore.map((it) => (
                  <NavLink key={it.to} to={it.to} end={it.to === '/admin'}
                    className={({ isActive }) => `flex h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold ${isActive ? 'bg-accent-soft text-ink' : 'text-ink hover:bg-subtle'}`}>
                    {({ isActive }) => <><Icon name={it.icon} className={`size-5 ${isActive ? 'text-accent' : 'text-muted'}`} />{it.label}</>}
                  </NavLink>
                ))}
              </div>
            )}
          </nav>
        )}
      </div>
    </div>
  )
}
