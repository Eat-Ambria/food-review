// The avatar menu at the top right: name, notification and sound switches, Change PIN, Sign out.
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { disablePush, enablePush, pushState, type PushState } from '../lib/push'
import { playNotificationSound, setSoundEnabled, soundEnabled } from '../lib/sound'
import { rolesLabel, rolesOf } from '../types/auth'
import { Icon } from './Icon'
import { Switch } from './ui/Layout'
import { Spinner } from './ui/Spinner'

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')

const PUSH_NOTE: Partial<Record<PushState, string>> = {
  denied: 'Blocked in this browser. Allow notifications from the lock icon next to the address, then reload.',
  'needs-install': 'On iPhone: Share → "Add to Home Screen", then open the app from there.',
  unsupported: 'This browser cannot show notifications.',
  'not-configured': 'Notifications are not set up yet.',
}

export function AccountMenu({ tone = 'light', withName = false }: { tone?: 'light' | 'dark'; withName?: boolean }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [push, setPush] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  const [pushErr, setPushErr] = useState<string | null>(null)
  const [sound, setSound] = useState(soundEnabled)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setOpen(false) }, [location.pathname])
  useEffect(() => { if (open) void pushState().then(setPush) }, [open])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  if (!user) return null
  const isPoc = rolesOf(user).includes('poc')

  const togglePush = async () => {
    setBusy(true); setPushErr(null)
    try { setPush(push === 'on' ? await disablePush() : await enablePush(user.id)) } catch (e) { setPushErr((e as Error).message) }
    setBusy(false)
  }
  const signOut = async () => { await logout(); navigate('/login', { replace: true }) }

  return (
    <div className="relative" ref={boxRef}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" aria-label="Account menu"
        title={user.name}
        className={`flex items-center gap-2.5 rounded-full p-1 transition-colors ${tone === 'dark' ? 'hover:bg-white/10' : `pr-2.5 hover:bg-ink/[0.05] ${open ? 'bg-ink/[0.05]' : ''}`}`}>
        <span className={`flex items-center justify-center rounded-full font-bold ${tone === 'dark'
          ? 'size-8 bg-marigold text-xs text-navy-900'
          : 'size-11 bg-[#fbecc7] text-sm text-ink shadow-[0_3px_10px_-4px_rgb(185_128_15/0.55)] ring-1 ring-marigold/25'}`}>
          {initials(user.name)}
        </span>
        {withName && (
          <span className="sr-only">
            <span className="block max-w-[10rem] truncate text-sm font-semibold">{user.name}</span>
            <span className="block max-w-[10rem] truncate text-xs text-muted">{rolesLabel(user)}</span>
          </span>
        )}
        {withName && <Icon name="chevron" className={`size-4 text-ink/70 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />}
      </button>

      {open && (
        <div role="menu" className="pop-in absolute right-0 z-50 mt-2 w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-line bg-surface text-ink shadow-pop">
          <div className="flex items-center gap-3 px-4 py-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-navy-800 text-sm font-bold text-white">{initials(user.name)}</span>
            <div className="min-w-0">
              <p className="truncate font-bold">{user.name}</p>
              <p className="truncate text-xs text-muted">@{user.username} · {rolesLabel(user)}</p>
            </div>
          </div>

          {isPoc && (
            <div className="space-y-3 border-t border-line px-4 py-3.5">
              <div>
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2.5 text-sm font-semibold">
                    <Icon name="bell" className="size-4 text-muted" />Phone notifications
                  </span>
                  {(push === 'on' || push === 'off') ? (
                    <Switch checked={push === 'on'} disabled={busy} onChange={() => void togglePush()} label="Phone notifications" />
                  ) : push === null ? <Spinner className="size-4 text-muted" /> : null}
                </div>
                <p className="mt-1 pl-[26px] text-xs leading-relaxed text-muted">
                  {push === 'on' ? 'On for this device.' : push === 'off' ? 'Get a notification for every new issue.' : push ? PUSH_NOTE[push] : ''}
                </p>
                {pushErr && <p className="mt-1 pl-[26px] text-xs text-danger">{pushErr}</p>}
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2.5 text-sm font-semibold">
                    <Icon name="volume" className="size-4 text-muted" />Notification sound
                  </span>
                  <Switch checked={sound} label="Notification sound"
                    onChange={() => { const next = !sound; setSound(next); setSoundEnabled(next); if (next) playNotificationSound('normal') }} />
                </div>
                <p className="mt-1 pl-[26px] text-xs leading-relaxed text-muted">Plays when a new issue arrives while the app is open.</p>
              </div>
            </div>
          )}

          <div className="border-t border-line p-1.5">
            <button type="button" role="menuitem" onClick={() => navigate('/change-pin')}
              className="flex h-10 w-full items-center gap-2.5 rounded-lg px-3 text-sm font-semibold transition-colors hover:bg-subtle">
              <Icon name="key" className="size-4 text-muted" />Change PIN
            </button>
            <button type="button" role="menuitem" onClick={() => void signOut()}
              className="flex h-10 w-full items-center gap-2.5 rounded-lg px-3 text-sm font-semibold text-danger transition-colors hover:bg-danger-soft">
              <Icon name="logout" className="size-4" />Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
