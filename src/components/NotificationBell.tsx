// The bell: unread count, notification list, and the popup banner and sound for new issues.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { playNotificationSound } from '../lib/sound'
import { Icon } from './Icon'
import { displayItem } from '../utils/itemName'

interface Note { id: string; title: string; body: string | null; url: string | null; read_at: string | null; created_at: string; submission_id: string | null }

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 24 ? `${h} h ago` : new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function splitBody(body: string): { lead: string; rest: string } {
  const start = body.lastIndexOf(' · ', 160)
  const p1 = body.indexOf(': ', start < 0 ? 0 : start)
  if (p1 < 0 || p1 > 160) return { lead: '', rest: body }
  const p2 = body.indexOf(': ', p1 + 2)
  const between = p2 > 0 ? body.slice(p1 + 2, p2) : ''

  if (p2 > 0 && between.length <= 40 && between.trim().split(/\s+/).length <= 4 && !/[.!?]/.test(between)) {
    return { lead: `${body.slice(0, p1)}: ${displayItem(between)}`, rest: body.slice(p2 + 2) }
  }
  return { lead: body.slice(0, p1), rest: body.slice(p1 + 2) }
}

export function NotificationBell({ userId, align = 'right', tone = 'light' }: { userId: string; align?: 'left' | 'right'; tone?: 'light' | 'dark' }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const boxRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const [pos, setPos] = useState<{ top: number; right: number; phone: boolean } | null>(null)
  const seenRef = useRef<Set<string> | null>(null)
  const [popup, setPopup] = useState<Note | null>(null)

  const load = useCallback(async (withSound = true) => {
    const { data } = await supabase.from('notifications')
      .select('id, title, body, url, read_at, created_at, submission_id')
      .eq('recipient_user_id', userId).order('created_at', { ascending: false }).limit(20)
    const list = (data ?? []) as Note[]

    const fresh = seenRef.current ? list.filter((n) => !n.read_at && !seenRef.current!.has(n.id)) : []
    seenRef.current = new Set(list.map((n) => n.id))
    if (withSound && fresh.length && boxRef.current?.offsetParent) {
      playNotificationSound(fresh.some((n) => n.title.startsWith('Serious')) ? 'serious' : 'normal')
      setPopup(fresh.find((n) => n.title.startsWith('Serious')) ?? fresh[0])
    }
    setNotes(list)
  }, [userId])

  useEffect(() => {
    void load()

    const channel = supabase.channel(`notes-${userId}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_user_id=eq.${userId}` },
        () => { if (document.visibilityState === 'visible') void load() })
      .subscribe()
    const id = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 20_000)
    const onFocus = () => void load(false)

    const onSwMessage = (e: MessageEvent) => { if (e.data?.type === 'issue-desk-push') void load() }
    window.addEventListener('focus', onFocus)
    navigator.serviceWorker?.addEventListener('message', onSwMessage)
    return () => {
      void supabase.removeChannel(channel)
      clearInterval(id)
      window.removeEventListener('focus', onFocus)
      navigator.serviceWorker?.removeEventListener('message', onSwMessage)
    }
  }, [load, userId])

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 8, right: Math.max(12, window.innerWidth - r.right), phone: window.innerWidth < 768 })
    }
    setOpen((o) => !o)
    void load(false)
  }
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!popup || popup.title.startsWith('Serious')) return
    const t = setTimeout(() => setPopup(null), 6000)
    return () => clearTimeout(t)
  }, [popup])

  const unread = notes.filter((n) => !n.read_at).length

  const openNote = async (n: Note) => {
    setOpen(false)
    if (!n.read_at) {
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id)
      void load(false)
    }

    navigate(n.submission_id ? `/issues?submission=${n.submission_id}` : `/${n.url ?? 'issues'}`)
  }

  const markAll = async () => {
    await supabase.rpc('mark_all_notifications_read')
    void load(false)
  }

  const banner = popup && (() => {
    const serious = popup.title.startsWith('Serious')
    const { lead, rest } = splitBody(popup.body ?? '')
    return createPortal(
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[90] flex justify-center px-3 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        <div role="alert" className={`banner-in pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl bg-surface p-3 pr-2 shadow-[0_18px_44px_-14px_rgb(15_22_38/0.55)] ring-1 ${serious ? 'ring-danger/40' : 'ring-black/5'}`}>
          <button type="button" onClick={() => { const n = popup; setPopup(null); void openNote(n) }} className="flex min-w-0 flex-1 items-start gap-3 text-left">
            <span className={`flex size-9 shrink-0 items-center justify-center rounded-full ${serious ? 'bg-danger text-white' : 'bg-[#fbecc7] text-[#9a6a0b]'}`}>
              <Icon name={serious ? 'alert' : 'bell'} className="size-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-bold leading-snug text-ink">
                {serious && <span className="text-danger">Serious · </span>}{popup.title.replace(/^Serious:\s*/, '')}
              </span>
              {popup.body && (
                <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-muted">
                  {lead && <b className="font-semibold text-ink/80">{lead}: </b>}{rest}
                </span>
              )}
              <span className="mt-1 block text-[11px] font-semibold text-accent">Tap to open</span>
            </span>
          </button>
          <button type="button" onClick={() => setPopup(null)} aria-label="Dismiss"
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-ink/[0.05] hover:text-ink">
            <Icon name="x" className="size-4" />
          </button>
        </div>
      </div>,
      document.body,
    )
  })()

  return (
    <div className="relative" ref={boxRef}>
      <button ref={btnRef} type="button" onClick={toggle} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open}
        className={`relative flex size-10 items-center justify-center rounded-full transition-colors ${tone === 'dark' ? 'text-white/85 hover:bg-white/10' : `text-muted hover:bg-ink/[0.05] hover:text-ink ${open ? 'bg-ink/[0.05] text-ink' : ''}`}`}>
        <Icon name="bell" className={tone === 'dark' ? 'size-5' : 'size-[22px]'} />
        {unread > 0 && (
          <span className={`absolute right-1 top-1 flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-[18px] ring-2 ${tone === 'dark' ? 'bg-danger text-white ring-navy-900' : 'bg-marigold text-navy-900 ring-[#f6f5f2]'}`}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && pos && createPortal(<>

        <div className="fade-in fixed inset-x-0 bottom-0 z-[70] bg-navy-950/25 backdrop-blur-[2px]"
          style={{ top: pos.phone ? pos.top - 8 : 0 }} onClick={() => setOpen(false)} aria-hidden="true" />
        <div role="dialog" aria-label="Notifications"
          style={pos.phone
            ? { top: pos.top - 2, left: 8, right: 8, maxHeight: `calc(100dvh - ${pos.top + 12}px)` }
            : { top: pos.top, right: align === 'right' ? pos.right : undefined, maxHeight: `calc(100dvh - ${pos.top + 24}px)` }}
          className={`pop-in fixed z-[71] flex flex-col overflow-hidden rounded-2xl bg-surface shadow-[0_24px_60px_-20px_rgb(15_22_38/0.55)] ring-1 ring-black/5 ${pos.phone ? '' : 'w-[24rem]'}`}>

          <div className="flex items-center justify-between gap-3 px-4 pb-2.5 pt-3.5">
            <p className="flex items-center gap-2 text-[15px] font-bold">
              Notifications
              {unread > 0 && <span className="rounded-full bg-marigold/20 px-2 py-0.5 text-[11px] font-bold text-[#7a5408]">{unread} new</span>}
            </p>
            {unread > 0 && (
              <button type="button" onClick={() => void markAll()}
                className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-muted transition-colors hover:bg-ink/[0.05] hover:text-ink">
                <Icon name="check" className="size-3.5" />Mark all read
              </button>
            )}
          </div>

          {notes.length === 0 ? (
            <div className="flex flex-col items-center px-6 pb-10 pt-6 text-center">
              <span className="flex size-11 items-center justify-center rounded-full bg-accent-soft text-accent"><Icon name="bell" className="size-5" /></span>
              <p className="mt-3 text-sm font-semibold">You're all caught up</p>
              <p className="mt-0.5 text-xs text-muted">New issues will show up here.</p>
            </div>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
              {notes.map((n) => {
                const serious = n.title.startsWith('Serious')
                const title = serious ? n.title.replace(/^Serious:\s*/, '') : n.title
                return (
                  <li key={n.id}>
                    <button type="button" onClick={() => void openNote(n)}
                      className={`flex w-full gap-3 rounded-xl px-2.5 py-3 text-left transition-colors hover:bg-subtle ${n.read_at ? '' : 'bg-accent-soft/50'}`}>

                      <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full ${serious ? 'bg-danger-soft text-danger' : 'bg-[#fbecc7] text-[#9a6a0b]'}`}>
                        <Icon name={serious ? 'alert' : 'bell'} className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span className={`text-[13.5px] leading-snug ${n.read_at ? 'font-medium text-ink/75' : 'font-bold text-ink'}`}>
                            {serious && <span className="mr-1 font-bold text-danger">Serious ·</span>}{title}
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5 pt-0.5 text-[11px] font-medium text-faint">
                            {ago(n.created_at)}
                            {!n.read_at && <span className={`size-2 rounded-full ${serious ? 'bg-danger' : 'bg-marigold'}`} aria-label="Unread" />}
                          </span>
                        </span>
                        {n.body && (() => {
                          const { lead, rest } = splitBody(n.body)
                          return (
                            <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted">
                              {lead && <b className="font-semibold text-ink/80">{lead}: </b>}{rest}
                            </span>
                          )
                        })()}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <button type="button" onClick={() => { setOpen(false); navigate('/issues') }}
            className="flex shrink-0 items-center justify-center gap-1.5 border-t border-line bg-subtle/70 py-3 text-[13px] font-semibold text-ink transition-colors hover:bg-subtle">
            View all issues<Icon name="chevronRight" className="size-4" />
          </button>
        </div>
      </>, document.body)}
      {banner}
    </div>
  )
}
