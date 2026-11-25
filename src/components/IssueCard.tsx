// Shows one issue as a table row; tap it to see the full transcript and recording.
import { useEffect, useRef, useState } from 'react'
import type { FeedIssue } from '../services/issueService'
import { audioUrl } from '../services/issueService'
import { Icon } from './Icon'
import { CategoryChip } from './CategoryChip'
import { ItemTag } from './ItemTag'
import { Spinner } from './ui/Spinner'
import { personName } from '../utils/personName'

export const ISSUE_COLS = '@3xl:grid @3xl:grid-cols-[8.5rem_6.5rem_10rem_minmax(0,1fr)_7.5rem_7.75rem_1.25rem] @3xl:items-center @3xl:gap-x-4'

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
    <span title={`Reported ${fullStamp(issue.created_at)}`} className="whitespace-nowrap tabular-nums @3xl:text-sm @3xl:text-muted">
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

export function IssueCard({ issue, focused = false }: { issue: FeedIssue; focused?: boolean }) {
  const [open, setOpen] = useState(false)

  const rowRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (focused) rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focused])
  const [src, setSrc] = useState<string | null>(null)
  const [audioErr, setAudioErr] = useState<string | null>(null)

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
        className={`flex w-full flex-col gap-2 px-4 py-3 text-left @3xl:py-2.5 ${ISSUE_COLS}`}>

        <span className="flex flex-wrap items-center gap-1.5 @3xl:contents">
          <span className="@3xl:min-w-0"><CategoryChip name={issue.category} className="max-w-full justify-center @3xl:w-full" /></span>
          <span className={issue.is_serious ? '' : 'hidden @3xl:block'}><Priority serious={issue.is_serious} keywords={issue.serious_keywords} /></span>
          <span className="min-w-0">
            {issue.item ? <ItemTag item={issue.item} category={issue.category} wrap /> : <span className="hidden pl-3 text-ink/40 @3xl:inline">—</span>}
          </span>
        </span>
        <span className="row-text min-w-0 text-sm leading-6 text-ink">
          {issue.summary ?? issue.description}
        </span>
        <span className="flex items-center gap-2 text-xs text-muted @3xl:contents">
          <span className="truncate font-medium text-ink/80 @3xl:text-sm">{personName(issue.recorded_by) || 'Unknown'}</span>
          <Reported issue={issue} />
          <Icon name="chevron" className={`row-chevron ml-auto size-4 text-ink/60 @3xl:ml-0 ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {open && (
        <div className="fade-in space-y-3 px-4 pb-4 @3xl:pl-[calc(8.5rem+6.5rem+2rem+1rem)]">
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
            src ? <audio controls preload="none" src={src} className="h-10 w-full" />
              : audioErr ? <p className="text-xs text-danger">{audioErr}</p>
              : <p className="flex items-center gap-2 text-xs text-muted"><Spinner className="size-3" />Loading recording…</p>
          ) : (
            <p className="text-xs text-muted">Recording no longer available (auto-deleted after the retention period).</p>
          )}
        </div>
      )}
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
