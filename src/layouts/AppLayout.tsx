// The frame around every page: sidebar / phone menu, and the top bar with search, bell and account menu.
import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useOutbox } from '../hooks/useOutbox'
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
  { to: '/issues', label: 'Issues', icon: 'calendarCheck', roles: ['recorder', 'poc', 'admin'] },
]
const ADMIN: NavItem[] = [
  { to: '/admin', label: 'Dashboard', icon: 'grid', roles: ['admin'] },
  { to: '/admin/users', label: 'Users', icon: 'user', roles: ['admin'] },
  { to: '/admin/venues', label: 'Venues', icon: 'pin', roles: ['admin'] },
  { to: '/admin/alerts', label: 'Serious Alerts', short: 'Alerts', icon: 'alert', roles: ['admin'] },
  { to: '/admin/deletions', label: 'Deletion Log', short: 'Deleted', icon: 'trash', roles: ['admin'] },
]

function SideLink({ it }: { it: NavItem }) {
  return (
    <NavLink to={it.to} end={it.to === '/admin'}
      className={({ isActive }) => `side-link group relative isolate flex h-12 items-center gap-3.5 overflow-hidden rounded-xl px-4 text-[15px] font-medium transition-colors duration-200
        ${isActive ? 'is-active bg-white/[0.09] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]' : 'text-white/80 hover:text-white'}`}>
      {({ isActive }) => (
        <>

          <span aria-hidden="true" className="side-edge absolute inset-y-0 left-0 w-[3px] bg-marigold" />
          <Icon name={it.icon} className={`side-icon size-5 shrink-0 ${isActive ? 'text-marigold' : 'text-white/70'}`} />
          <span className="side-label">{it.label}</span>
        </>
      )}
    </NavLink>
  )
}

function Mark({ className = 'size-5' }: { className?: string }) {
  return <BrandMark className={className} />
}

function Brand() {
  return (
    <div className="brand group flex items-start gap-2.5 px-8 pb-7 pt-8">
      <span className="brand-mark relative mt-0.5 block size-11 shrink-0 overflow-hidden rounded-[24%]">
        <Mark className="size-11" />
        <span aria-hidden="true" className="brand-shine" />
      </span>
      <div className="leading-none">
        <p className="brand-word font-serif text-[2rem] tracking-[-0.01em] text-white">Ambria</p>
        <p className="brand-sub mt-1.5 pl-0.5 text-[13px] tracking-wide text-white/70">food review</p>
      </div>
    </div>
  )
}

function TopSearch({ canSeeIssues }: { canSeeIssues: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [q, setQ] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  const target = canSeeIssues ? '/issues' : '/my-submissions'

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
    <form role="search" className="group relative min-w-0 flex-1 max-w-sm"
      onSubmit={(e) => { e.preventDefault(); const t = q.trim(); if (t) { navigate(`${target}?q=${encodeURIComponent(t)}`); ref.current?.blur() } }}>
      <Icon name="search" className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-ink/70" />
      <input ref={ref} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search"
        onKeyDown={(e) => { if (e.key === 'Escape' && q) { e.preventDefault(); clear() } }}
        placeholder={canSeeIssues ? 'Search issues, dishes, venues…' : 'Search your submissions…'}
        className="h-11 w-full rounded-full border border-ink/10 bg-white/85 pl-11 pr-11 text-[15px] text-ink shadow-[0_1px_2px_rgb(23_32_51/0.04)] outline-none transition-[border-color,box-shadow,background-color] placeholder:text-ink/45 hover:border-ink/20 focus:border-ink/30 focus:bg-white focus:ring-4 focus:ring-ink/[0.05]" />
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

function SideNav({ work, admin, action }: { work: NavItem[]; admin: NavItem[]; action?: { label: string; icon: IconName; onClick: () => void; className?: string } }) {
  return (
    <>
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
      {action && (
        <div className={`relative z-10 px-4 pb-5 pt-4 ${action.className ?? ''}`}>
          <button type="button" onClick={action.onClick}
            className="flex h-11 w-full items-center gap-3 rounded-xl px-4 text-sm font-medium text-white/65 transition-colors hover:bg-white/[0.07] hover:text-white">
            <Icon name={action.icon} className="size-5 shrink-0" />{action.label}
          </button>
        </div>
      )}

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
    </>
  )
}

function useWide(): boolean {
  const query = '(min-width: 768px)'
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return wide
}

const SIDEBAR_BG = 'bg-[linear-gradient(180deg,#1a2335_0%,#141c2c_100%)]'

export function AppLayout() {
  const { user } = useAuth()
  useOutbox(user?.id)
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [barTitle, setBarTitle] = useState<string | null>(null)
  const [docked, setDocked] = useState(() => {
    try { const saved = localStorage.getItem('sidebar-docked'); if (saved !== null) return saved === '1' } catch { }
    return typeof window !== 'undefined' && window.innerWidth >= 1280
  })
  const dock = (on: boolean) => {
    setDocked(on)
    setMenuOpen(false)
    try { localStorage.setItem('sidebar-docked', on ? '1' : '0') } catch { }
  }
  useEffect(() => { setMenuOpen(false) }, [location.pathname])

  const wide = useWide()
  const drawerRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const opener = document.activeElement as HTMLElement | null
    requestAnimationFrame(() => drawerRef.current?.querySelector<HTMLElement>('a[href]')?.focus())
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setMenuOpen(false); return }
      if (e.key !== 'Tab' || !drawerRef.current) return
      const items = [...drawerRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')]
      if (!items.length) return
      if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items[items.length - 1].focus() }
      else if (!e.shiftKey && document.activeElement === items[items.length - 1]) { e.preventDefault(); items[0].focus() }
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; opener?.focus?.() }
  }, [menuOpen])

  if (!user) return null

  const mine = rolesOf(user)
  const allowed = (it: NavItem) => it.roles.some((r) => mine.includes(r))
  const work = WORK.filter(allowed)
  const admin = ADMIN.filter(allowed)
  const isPoc = mine.includes('poc')
  const hasMenu = work.length + admin.length > 1

  return (
    <div className="relative flex min-h-full">

      <svg aria-hidden="true" className="silk" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
        <path d="M-40 760 C 240 640, 520 820, 820 700 S 1300 520, 1500 600 L 1500 960 L -40 960 Z" fill="#ffffff" fillOpacity="0.55" />
        <path d="M600 900 C 820 760, 1040 700, 1220 520 S 1420 260, 1520 230 L 1520 960 L 600 960 Z" fill="#ffffff" fillOpacity="0.45" />
      </svg>

      {docked && (
        <aside className={`sticky top-0 z-20 hidden h-screen w-[17rem] shrink-0 flex-col overflow-y-auto ${SIDEBAR_BG} md:flex`}>
          <SideNav work={work} admin={admin} action={{ label: 'Hide menu', icon: 'arrowLeft', onClick: () => dock(false) }} />
        </aside>
      )}

      {menuOpen && (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="fade-in absolute inset-0 bg-navy-950/45 backdrop-blur-[2px]" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <aside ref={drawerRef} className={`drawer-in absolute inset-y-0 left-0 flex w-[17rem] max-w-[85vw] flex-col overflow-y-auto pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-[8px_0_30px_-10px_rgb(0_0_0/0.5)] ${SIDEBAR_BG}`}>
            <button type="button" onClick={() => setMenuOpen(false)} aria-label="Close menu"
              className="absolute right-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-20 flex size-9 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white">
              <Icon name="x" className="size-5" />
            </button>
            <SideNav work={work} admin={admin}
              action={{ label: 'Keep menu open', icon: 'menu', onClick: () => dock(true), className: 'hidden md:block' }} />
          </aside>
        </div>
      )}

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">

        <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-[linear-gradient(180deg,#1a2335,#151d2d)] px-2 shadow-[0_6px_18px_-10px_rgb(23_32_51/0.6)] pt-[env(safe-area-inset-top)] text-white md:hidden">
          <div className="flex min-w-0 items-center gap-1.5">
            {hasMenu && (
              <button type="button" onClick={() => setMenuOpen(true)} aria-label="Open menu" aria-expanded={menuOpen}
                className="flex size-10 shrink-0 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/10 active:bg-white/15">
                <Icon name="menu" className="size-[22px]" />
              </button>
            )}
            <Mark className="size-7 shrink-0" />
            <p className="font-serif text-xl leading-none">Ambria</p>
            <span className="truncate text-xs font-medium text-white/50">food review</span>
          </div>
          <div className="flex items-center gap-1 pr-1">
            {isPoc && !wide && <NotificationBell userId={user.id} tone="dark" />}
            <AccountMenu tone="dark" />
          </div>
        </header>

        <div className="sticky top-0 z-30 hidden h-[4.5rem] items-center justify-end border-b border-black/[0.04] bg-[#f6f5f2]/80 px-8 shadow-[0_8px_24px_-20px_rgb(23_32_51/0.35)] backdrop-blur-md md:flex lg:px-10">
          {!docked && hasMenu && (
            <button type="button" onClick={() => setMenuOpen(true)} aria-label="Open menu" aria-expanded={menuOpen}
              className={`-ml-2 flex size-11 shrink-0 items-center justify-center rounded-full text-ink/80 transition-colors hover:bg-ink/[0.06] hover:text-ink ${barTitle ? 'mr-3' : 'mr-auto'}`}>
              <Icon name="menu" className="size-6" />
            </button>
          )}
          {barTitle && <h1 className="mr-auto shrink-0 whitespace-nowrap pr-4 font-serif text-[1.75rem] font-medium lg:pr-6 lg:text-[2.1rem] leading-none tracking-[-0.02em] text-ink">{barTitle}</h1>}
          <TopSearch canSeeIssues={work.some((w) => w.to === '/issues')} />
          {isPoc && wide && (
            <>
              <span aria-hidden="true" className="mx-4 h-9 w-px bg-ink/10 lg:mx-5" />
              <NotificationBell userId={user.id} align="right" />
            </>
          )}
          <span aria-hidden="true" className="mx-4 h-9 w-px bg-ink/10 lg:mx-5" />
          <AccountMenu withName />
        </div>

        <main key={location.pathname} className="page-in flex-1 px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-5 md:px-8 md:pb-14 md:pt-10 lg:px-12">
          <Outlet context={{ setBarTitle } satisfies LayoutContext} />
        </main>
      </div>
    </div>
  )
}
