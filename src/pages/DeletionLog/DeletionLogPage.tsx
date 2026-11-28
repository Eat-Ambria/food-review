// Admin page listing every deleted issue or recording, who deleted it and why.
import { useEffect, useState } from 'react'
import { fetchDeletionLog, type DeletionLogEntry } from '../../services/issueService'
import { Alert, Card, EmptyState, ListSkeleton, PageHeader } from '../../components/ui/Layout'
import { Badge } from '../../components/ui/Badge'
import { CategoryChip } from '../../components/CategoryChip'
import { personName } from '../../utils/personName'

const stamp = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })

function Row({ e }: { e: DeletionLogEntry }) {
  const issues = Array.isArray(e.issues) ? e.issues : []
  return (
    <li className="p-4">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <Badge tone={e.deleted_what === 'issue' ? 'warn' : 'danger'}>{e.deleted_what === 'issue' ? 'Issue' : 'Whole recording'}</Badge>
        <span className="text-xs text-muted">{stamp(e.created_at)}</span>
        <span className="text-xs text-muted">
          by <span className="font-semibold text-ink/80">{personName(e.actor_name) || 'Unknown'}</span>
        </span>
        {e.actor_is_owner ? <Badge tone="accent">own recording</Badge> : <Badge>{(e.actor_roles ?? []).join(', ') || 'no role'}</Badge>}
      </div>
      <p className="mt-2 text-sm font-bold">{e.reason}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        {e.action === 'delete_issue' ? (
          <>
            <CategoryChip name={e.category} />
            {e.item && <span className="font-semibold">{e.item}</span>}
            <span className="text-ink/80">{e.summary ?? e.description}</span>
          </>
        ) : (
          <span className="text-ink/80">{issues.length} issue{issues.length === 1 ? '' : 's'}{e.compliments_removed > 0 ? `, ${e.compliments_removed} good feedback` : ''}</span>
        )}
      </div>
      <p className="mt-1.5 text-xs text-muted">
        {e.venue_name ?? 'Venue not identified'} · recorded by {personName(e.recorded_by_name) || 'Unknown'}
        {e.recorded_at && <> · {stamp(e.recorded_at)}</>}
        {e.had_audio && ' · audio removed'}
      </p>
      {(e.transcript_snippet || issues.length > 0) && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-xs font-semibold text-accent">Details</summary>
          {e.transcript_snippet && <p className="mt-2 whitespace-pre-wrap rounded-lg border border-line bg-surface px-3 py-2 text-ink/85">{e.transcript_snippet}</p>}
          {issues.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {issues.map((i) => (
                <li key={i.issue_id} className="flex flex-wrap items-center gap-2">
                  <CategoryChip name={i.category} />
                  {i.item && <span className="font-semibold">{i.item}</span>}
                  <span className="text-ink/80">{i.summary ?? i.description}</span>
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </li>
  )
}

export function DeletionLogPage() {
  const [rows, setRows] = useState<DeletionLogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetchDeletionLog().then((r) => { if (live) setRows(r) }).catch((e: Error) => { if (live) setError(e.message) })
    return () => { live = false }
  }, [])

  return (
    <div>
      <PageHeader title="Deletion Log" description="Every issue or recording that was deleted, who deleted it and why." />
      {error ? <Alert>{error}</Alert>
        : rows === null ? <ListSkeleton label="Loading deletion log" />
        : rows.length === 0 ? <EmptyState icon="trash" title="Nothing deleted yet" description="Deleted issues and recordings will be listed here." />
        : <Card as="div"><ul className="divide-y divide-line">{rows.map((e) => <Row key={e.id} e={e} />)}</ul></Card>}
    </div>
  )
}
