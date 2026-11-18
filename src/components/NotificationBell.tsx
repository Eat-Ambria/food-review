// =============================================================================
// WHAT THIS FILE IS
//   The bell icon with the unread count, and its drop-down list of the latest
//   notifications ("3 new issues at Ambria Pushpanjali…").
// WHY IT EXISTS
//   The in-app half of notifications. It reads the same rows the phone push is
//   made from, so the bell and the phone never disagree. It polls every 60 s,
//   and immediately when the app comes back to the foreground. Tapping a
//   notification marks it read and opens the Issues page.
//   RLS: a user only ever sees their own notifications, and may only change
//   read_at.
//   Sound: when a NEW notification arrives while the app is open, a chime
//   plays (a sharper alarm for "Serious"). The service worker pings the page
//   as soon as a push arrives, so this happens immediately, not after the
//   60-second poll.
// USED BY
//   layouts/AppLayout.tsx (POC users)
// =============================================================================
import { useCallback, useEffect, useRef, useState } from 'react'
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

/**
 * Splits a notification body into its lead and the summary, so the lead can be bold:
 *   "Mr. Rajan · Cocktail · Kitchen: पनीर: The paneer was…"
 *   → lead "Mr. Rajan · Cocktail · Kitchen: Paneer", rest "The paneer was…"
 * The database writes it as  [guest · function · ] category[: item]: summary.
 * The item is shown like everywhere else in the app (Roman script, Title Case).
 */
function splitBody(body: string): { lead: string; rest: string } {
  const start = body.lastIndexOf(' · ', 160)              // the category comes after the last " · "
  const p1 = body.indexOf(': ', start < 0 ? 0 : start)     // end of the category
  if (p1 < 0 || p1 > 160) return { lead: '', rest: body }
  const p2 = body.indexOf(': ', p1 + 2)                    // end of the item, if there is one
  const between = p2 > 0 ? body.slice(p1 + 2, p2) : ''
  // An item is a short name (1-4 words), never a sentence.
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
  const seenRef = useRef<Set<string> | null>(null)       // ids already known; null until first load

  const load = useCallback(async () => {
    const { data } = await supabase.from('notifications')
      .select('id, title, body, url, read_at, created_at, submission_id')
      .eq('recipient_user_id', userId).order('created_at', { ascending: false }).limit(20)
    const list = (data ?? []) as Note[]
    // Sound only for notifications that are NEW since the last check (never on
    // the first load), and only from the bell that is actually visible
    // (desktop and phone each render one).
    const fresh = seenRef.current ? list.filter((n) => !n.read_at && !seenRef.current!.has(n.id)) : []
    seenRef.current = new Set(list.map((n) => n.id))
    if (fresh.length && boxRef.current?.offsetParent) {
      playNotificationSound(fresh.some((n) => n.title.startsWith('Serious')) ? 'serious' : 'normal')
    }
    setNotes(list)
  }, [userId])

  useEffect(() => {
    void load()
    const id = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 60_000)
    const onFocus = () => void load()
    // The service worker tells open pages the moment a push arrives → check now.
    const onSwMessage = (e: MessageEvent) => { if (e.data?.type === 'issue-desk-push') void load() }
    window.addEventListener('focus', onFocus)
    navigator.serviceWorker?.addEventListener('message', onSwMessage)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', onFocus)
      navigator.serviceWorker?.removeEventListener('message', onSwMessage)
    }
  }, [load])

  // Close when tapping outside.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const unread = notes.filter((n) => !n.read_at).length

  const openNote = async (n: Note) => {
    setOpen(false)
    if (!n.read_at) {
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id)
      void load()
    }
    // Open that complaint's issues (on their own day), not just today's list.
    navigate(n.submission_id ? `/issues?submission=${n.submission_id}` : `/${n.url ?? 'issues'}`)
  }

  const markAll = async () => {
    await supabase.rpc('mark_all_notifications_read')
    void load()
  }

  return (
    <div className="relative" ref={boxRef}>
      <button type="button" onClick={() => { setOpen((o) => !o); void load() }} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open}
        className={`relative flex size-10 items-center justify-center rounded-full transition-colors ${tone === 'dark' ? 'text-white/85 hover:bg-white/10' : `text-muted hover:bg-ink/[0.05] hover:text-ink ${open ? 'bg-ink/[0.05] text-ink' : ''}`}`}>
        <Icon name="bell" className={tone === 'dark' ? 'size-5' : 'size-[22px]'} />
        {unread > 0 && (
          <span className={`absolute right-1 top-1 flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-[18px] ring-2 ${tone === 'dark' ? 'bg-danger text-white ring-navy-900' : 'bg-marigold text-navy-900 ring-[#f6f5f2]'}`}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className={`pop-in absolute z-50 mt-2 w-[min(23rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-line bg-surface shadow-pop ${align === 'right' ? '-right-12 md:right-0' : 'left-0'}`}>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-bold">Notifications{unread > 0 && <span className="ml-1.5 font-semibold text-muted">{unread} new</span>}</p>
            {unread > 0 && <button type="button" onClick={() => void markAll()} className="rounded-md px-1.5 py-0.5 text-xs font-semibold text-muted transition-colors hover:bg-ink/[0.05] hover:text-ink">Mark all read</button>}
          </div>
          {notes.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-10 text-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-ink/[0.05] text-muted"><Icon name="bell" className="size-5" /></span>
              <p className="mt-3 text-sm font-semibold">No notifications yet</p>
              <p className="mt-0.5 text-xs text-muted">New issues will show up here.</p>
            </div>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
              {notes.map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => void openNote(n)} className={`flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-subtle ${n.read_at ? '' : 'bg-accent-soft/40'}`}>
                    <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read_at ? 'bg-transparent' : n.title.startsWith('Serious') ? 'bg-danger' : 'bg-marigold'}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm ${n.read_at ? 'font-medium text-muted' : 'font-semibold'}`}>{n.title}</span>
                      {n.body && (() => {
                        const { lead, rest } = splitBody(n.body)
                        return (
                          <span className="mt-0.5 line-clamp-3 block text-xs leading-relaxed text-muted">
                            {lead && <b className="font-semibold text-ink/85">{lead}: </b>}{rest}
                          </span>
                        )
                      })()}
                      <span className="mt-1 block text-[11px] font-medium text-faint">{ago(n.created_at)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
