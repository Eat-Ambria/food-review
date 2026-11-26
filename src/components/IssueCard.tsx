// Shows one issue as a table row; tap it to see the full transcript and recording.
import { useEffect, useRef, useState } from 'react'
import type { FeedIssue } from '../services/issueService'
import { audioUrl, deleteIssue } from '../services/issueService'
import { Button } from './ui/Button'
import { Modal } from './ui/Modal'
import { playingNow } from '../lib/singleAudio'
import { Icon } from './Icon'
import { CategoryChip } from './CategoryChip'
import { ItemTag } from './ItemTag'
import { Spinner } from './ui/Spinner'
import { personName } from '../utils/personName'

export const ISSUE_COLS = '@5xl:grid @5xl:grid-cols-[8.5rem_6.5rem_10rem_minmax(0,1fr)_7.5rem_7.75rem_1.25rem] @5xl:items-center @5xl:gap-x-4'

function Highlighted({ text, part }: { text: string; part: string | null }) {
  const i = part ? text.indexOf(part) : -1
  if (!part || i < 0) return <>{text}</>
  return <>{text.slice(0, i)}<mark className="rounded bg-accent-soft px-0.5 text-ink">{part}</mark>{text.slice(i + part.length)}</>
}

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
const istDay = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10)
const shortDay = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })
const fullStamp = (iso: string) => new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })

function Reported({ issue }: { issue: FeedIssue }) {
  const otherDay = istDay(issue.created_at) !== issue.event_day
  return (
    <span title={`Reported ${fullStamp(issue.created_at)}`} className="whitespace-nowrap tabular-nums @5xl:text-sm @5xl:text-muted">
      {otherDay && <span className="font-semibold text-ink/80">{shortDay(issue.created_at)} · </span>}
      {time(issue.created_at)}
    </span>
  )
}

export function Priority({ serious, keywords }: { serious: boolean; keywords?: string[] | null }) {
  return serious ? (
    <span title={keywords?.length ? `Keyword: ${keywords.join(', ')}` : 'Serious'}
      className="inline-flex items-center gap-1.5 rounded-full bg-danger-soft px-2.5 py-1 text-xs font-semibold text-danger">
      <Icon name="alert" className="size-3.5" strokeWidth={2.2} />Serious
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-ink/[0.06] px-2.5 py-1 text-xs font-medium text-ink/70">
      <span className="size-2 rounded-full bg-ink/30" />Normal
    </span>
  )
}

function telLink(mobile: string | null | undefined): string | null {
  const d = (mobile ?? '').replace(/\D/g, '')
  if (d.length === 10 && /^[6-9]/.test(d)) return 'tel:+91' + d
  if (d.length === 12 && d.startsWith('91')) return 'tel:+' + d
  if (d.length === 11 && d.startsWith('0')) return 'tel:+91' + d.slice(1)
  return null
}

export function IssueCard({ issue, focused = false, onDeleted }: { issue: FeedIssue; focused?: boolean; onDeleted?: () => void }) {
  const [open, setOpen] = useState(false)
  const [askDelete, setAskDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteErr, setDeleteErr] = useState<string | null>(null)
  const remove = async () => {
    setDeleting(true)
    setDeleteErr(null)
    try { await deleteIssue(issue.issue_id); setAskDelete(false); onDeleted?.() } catch (e) { setDeleteErr((e as Error).message) }
    setDeleting(false)
  }

  const rowRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (focused) rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focused])
  const [src, setSrc] = useState<string | null>(null)
  const [audioErr, setAudioErr] = useState<string | null>(null)
  const resignedRef = useRef(false)

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next && issue.audio_path && !src) {
      try { setSrc(await audioUrl(issue.audio_path)) } catch (e) { setAudioErr((e as Error).message) }
    }
  }

  return (
    <li ref={rowRef} className={`row-hover ${focused ? 'bg-accent-soft/70 ring-2 ring-inset ring-marigold/60' : open ? 'bg-subtle/80' : ''}`}>
      {issue.is_serious && <span aria-hidden="true" className="absolute inset-y-1 left-0 w-[3px] rounded-r bg-danger" />}
      <button type="button" onClick={() => void toggle()} aria-expanded={open}
        className={`flex w-full flex-col gap-2 px-4 py-3 text-left @5xl:py-2.5 ${ISSUE_COLS}`}>

        <span className="flex flex-wrap items-center gap-1.5 @5xl:contents">
          <span className="@5xl:min-w-0"><CategoryChip name={issue.category} className="max-w-full justify-center @5xl:w-full" /></span>
          <span className={issue.is_serious ? '' : 'hidden @5xl:block'}><Priority serious={issue.is_serious} keywords={issue.serious_keywords} /></span>
          <span className="min-w-0">
            {issue.item ? <ItemTag item={issue.item} category={issue.category} wrap /> : <span className="hidden pl-3 text-ink/40 @5xl:inline">—</span>}
          </span>
        </span>
        <span className="row-text min-w-0 text-sm leading-6 text-ink">
          {issue.summary ?? issue.description}
        </span>
        <span className="flex items-center gap-2 text-[13px] text-ink/70 @5xl:contents">
          <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-ink/[0.06] px-2.5 py-1 font-semibold text-ink @5xl:bg-transparent @5xl:p-0 @5xl:text-sm @5xl:font-medium @5xl:text-ink/80">
            <Icon name="mic" className="size-3.5 shrink-0 text-accent @5xl:hidden" />
            <span className="truncate">{personName(issue.recorded_by) || 'Unknown'}</span>
          </span>
          <Reported issue={issue} />
          <Icon name="chevron" className={`row-chevron ml-auto size-4 text-ink/60 @5xl:ml-0 ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {issue.is_serious && telLink(issue.recorded_by_mobile) && (
        <div className="-mt-1 px-4 pb-3 @5xl:pl-[calc(8.5rem+6.5rem+2rem+1rem)]">
          <a href={telLink(issue.recorded_by_mobile)!}
            className="inline-flex h-9 items-center gap-2 rounded-full bg-danger px-3.5 text-sm font-semibold text-white shadow-[0_6px_16px_-8px_rgb(192_60_11/0.7)] transition-colors hover:bg-danger/90">
            <Icon name="phone" className="size-4" />Call {personName(issue.recorded_by) || 'the recorder'}
            <span className="font-normal text-white/80">{issue.recorded_by_mobile}</span>
          </a>
        </div>
      )}

      {open && (
        <div className="fade-in space-y-3 px-4 pb-4 @5xl:pl-[calc(8.5rem+6.5rem+2rem+1rem)]">
          {issue.is_serious && issue.serious_keywords?.length ? (
            <p className="text-xs font-semibold text-danger">Serious: matched &ldquo;{issue.serious_keywords.join('”, “')}&rdquo;. POCs were alerted on WhatsApp.</p>
          ) : null}
          {issue.location && (
            <p className="flex items-center gap-1.5 text-xs text-muted"><Icon name="pin" className="size-3.5" />Location: <span className="font-medium text-ink">{issue.location}</span></p>
          )}
          <div className="rounded-lg border border-line bg-surface px-3.5 py-3">
            <p className="text-xs font-semibold text-muted">What was said</p>
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">
              <Highlighted text={issue.transcript} part={issue.original_text} />
            </p>
          </div>
          {issue.audio_path ? (
            src ? <audio controls preload="none" src={src} className="h-10 w-full" onPlay={(e) => playingNow(e.currentTarget)}
              onError={() => {
                if (!issue.audio_path || resignedRef.current) { setSrc(null); setAudioErr('This recording could not be played.'); return }
                resignedRef.current = true
                void audioUrl(issue.audio_path).then(setSrc).catch(() => setAudioErr('This recording could not be played.'))
              }} />
              : audioErr ? <p className="text-xs text-danger">{audioErr}</p>
              : <p className="flex items-center gap-2 text-xs text-muted"><Spinner className="size-3" />Loading recording…</p>
          ) : (
            <p className="text-xs text-muted">Recording no longer available (auto-deleted after the retention period).</p>
          )}
          {onDeleted && (
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" className="hover:bg-danger-soft! hover:text-danger!" onClick={() => setAskDelete(true)}>
                <Icon name="trash" />Delete issue
              </Button>
            </div>
          )}
        </div>
      )}
      <Modal open={askDelete} title="Delete this issue?" onClose={() => setAskDelete(false)}
        footer={<>
          <Button variant="secondary" onClick={() => setAskDelete(false)}>Cancel</Button>
          <Button variant="danger" loading={deleting} onClick={() => void remove()}>Delete</Button>
        </>}>
        <p className="text-sm leading-relaxed text-muted">
          <b className="text-ink">{issue.item ?? issue.category}</b>: {issue.summary ?? issue.description}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-muted">It will be removed for everyone and cannot be undone. If it is the last issue of this recording, the whole recording is deleted too, with any good feedback from it.</p>
        {deleteErr && <p className="mt-3 text-sm font-semibold text-danger">{deleteErr}</p>}
      </Modal>
    </li>
  )
}

export function IssueTableHead() {
  return (
    <div className={`hidden rounded-lg bg-ink/[0.045] px-4 py-2.5 text-[13px] font-semibold text-ink/75 ${ISSUE_COLS}`} aria-hidden="true">
      <span>Department</span><span>Priority</span><span>Item</span><span>Issue</span><span>Reported by</span><span>Time</span><span />
    </div>
  )
}
