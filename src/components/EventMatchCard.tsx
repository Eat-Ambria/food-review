// Shows which Calendar function a recording was matched to, and lets the recorder pick one when unsure.
import type { EventMatch } from '../types/events'
import { Icon } from './Icon'
import { Badge } from './ui/Badge'
import { Card, Skeleton } from './ui/Layout'
import { ChoiceRow } from './ui/Field'
import { Spinner } from './ui/Spinner'
import { shiftIcon } from '../utils/categoryStyle'

function prettyDate(iso: string | null): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function EventMatchCard({ match, loading, error, chosenId, onChoose }: {
  match: EventMatch | null; loading: boolean; error: string | null
  chosenId: string | null
  onChoose: (id: string | null) => void
}) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-bold">Event</p>
        {loading && <span className="flex items-center gap-2 text-xs font-medium text-muted"><Spinner className="size-3.5" />Checking calendar</span>}
        {!loading && match?.status === 'matched' && <Badge tone="ok" dot>Found in calendar</Badge>}
        {!loading && match?.status === 'ambiguous' && (chosenId && chosenId !== 'none'
          ? <Badge tone="ok" dot>Chosen by you</Badge>
          : <Badge tone="warn" dot>Choose one</Badge>)}
        {!loading && (match?.status === 'no_events' || match?.status === 'not_enough_info') && <Badge tone="neutral">Not identified</Badge>}
      </div>

      {error && !loading && (
        <p className="flex gap-2 text-sm text-muted"><Icon name="alert" className="mt-0.5 size-4 shrink-0 text-warn" />{error}</p>
      )}

      {!error && !match && loading && (
        <div className="space-y-2 rounded-lg border border-line p-3.5" aria-hidden="true">
          <Skeleton className="h-4 w-1/2" /><Skeleton className="h-3 w-3/4" />
        </div>
      )}

      {match?.status === 'matched' && match.event && (
        <div className="rounded-lg border border-ok/20 bg-ok-soft/50 px-3.5 py-3">
          <p className="font-semibold">
            {[match.event.guest_name, match.event.function_name].filter(Boolean).join(' · ') || match.event.title}
          </p>
          <p className="mt-0.5 text-sm text-muted">
            {[match.event.venue_name, match.event.sub_venue, match.event.shift, prettyDate(match.event.date)].filter(Boolean).join(' · ')}
          </p>
          {match.date_source === 'assumed_today' && <p className="mt-1 text-xs text-muted">Date not said, so taken as today.</p>}
          <p className="mt-2 text-xs text-muted">Matched because: {match.reasons.join(', ')}.</p>
        </div>
      )}

      {match && match.status !== 'matched' && (
        <>
          {(match.venue || match.date) && (
            <p className="text-sm font-semibold">
              {[match.venue?.name, match.date && prettyDate(match.date)].filter(Boolean).join(' · ')}
            </p>
          )}
          <p className="mt-0.5 text-sm leading-relaxed text-muted">{match.reasons.join(' ')}</p>
          {match.status === 'ambiguous' && match.candidates && match.candidates.length > 0 && (
            <fieldset className="mt-4">
              <legend className="text-sm font-semibold">Which function is this about?</legend>
              <div className="mt-2 space-y-1.5">
                {match.candidates.map((c) => {
                  const icon = shiftIcon(c.shift)
                  return (
                    <ChoiceRow key={c.calendar_event_id} type="radio" name="event-choice"
                      checked={chosenId === c.calendar_event_id} onChange={() => onChoose(c.calendar_event_id)}
                      title={[c.guest_name, c.function_name].filter(Boolean).join(' · ') || c.title}
                      description={
                        <span className="flex flex-wrap items-center gap-x-1.5">
                          {c.shift && <span className="inline-flex items-center gap-1 font-semibold text-ink/80">{icon && <Icon name={icon} className="size-3.5 text-accent" />}{c.shift}</span>}
                          <span>{[c.venue_name, c.sub_venue, prettyDate(c.date)].filter(Boolean).join(' · ')}</span>
                        </span>
                      } />
                  )
                })}
                <ChoiceRow type="radio" name="event-choice" checked={chosenId === 'none'} onChange={() => onChoose('none')}
                  title={<span className="font-medium text-muted">None of these / not sure</span>} />
              </div>
            </fieldset>
          )}
          <p className="mt-3 text-xs leading-relaxed text-muted">
            {match.status === 'ambiguous'
              ? 'Pick the function if you know it. Otherwise just submit; Admin will link it later.'
              : 'You can still submit; Admin will link the right event. Or add the detail in the transcript above and it will be checked again.'}
          </p>
        </>
      )}
    </Card>
  )
}
