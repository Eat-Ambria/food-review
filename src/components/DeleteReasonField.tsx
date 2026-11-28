// Reason picker for deletes: quick chips plus a note box. The reason is required and saved in the deletion log.
import { useId } from 'react'
import { DELETE_REASONS, type DeleteReasonChip } from '../utils/deleteReason'
import { inputClass } from './ui/Field'

export function DeleteReasonField({ chip, note, onChip, onNote, disabled }: {
  chip: DeleteReasonChip | null; note: string; onChip: (c: DeleteReasonChip | null) => void; onNote: (n: string) => void; disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="mb-4">
      <p className="mb-2 text-sm font-semibold">Reason (required)</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Reason for deleting">
        {DELETE_REASONS.map((r) => (
          <button key={r} type="button" disabled={disabled} aria-pressed={chip === r} onClick={() => onChip(chip === r ? null : r)}
            className={`inline-flex h-9 items-center rounded-full px-3.5 text-sm font-semibold transition-colors ${chip === r ? 'bg-accent-soft text-accent ring-1 ring-marigold/40' : 'bg-ink/[0.06] text-ink/70 hover:bg-ink/10'}`}>
            {r}
          </button>
        ))}
      </div>
      <label htmlFor={id} className="mt-3 block text-xs font-semibold text-muted">{chip === 'Other' ? 'Tell us why' : 'Add detail (optional)'}</label>
      <textarea id={id} rows={2} maxLength={500} value={note} disabled={disabled} onChange={(e) => onNote(e.target.value)}
        className={inputClass('md', 'mt-1 h-auto w-full py-2')} />
    </div>
  )
}
