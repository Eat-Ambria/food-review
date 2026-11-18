// =============================================================================
// WHAT THIS FILE IS
//   Submits a reviewed recording: uploads the audio to private storage, then
//   asks the process-issue function to save it and extract the issues.
// WHY IT EXISTS
//   • Safe to repeat: the audio path and the submission are both keyed by the
//     recording's client_submission_id. Pressing Submit again after a network
//     drop finds what was already saved instead of creating a duplicate.
//   • The draft on the phone is deleted only after the server confirms it has
//     the submission (see RecordPage).
// USED BY
//   pages/Recording/RecordPage.tsx
// DEPENDS ON
//   Storage bucket "recordings" (migration 9), Edge Function process-issue
// =============================================================================
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

/** One extracted issue. Each has its own item, venue and event (one recording may cover several venues). */
export interface SubmittedIssue {
  category_raw: string | null
  item: string | null
  description: string
  ai_summary: string | null
  location: string | null
  venue: { venue_name: string } | null
  event_info: { guest_name?: string | null; function_name?: string | null; shift?: string | null; match_status?: string } | null
}

export interface SubmitResult {
  submission_id: string
  status: 'pending_assignment' | 'assigned' | 'needs_review' | 'failed' | 'processing'
  issues: SubmittedIssue[]
  error?: string | null
  will_retry?: boolean
  already_submitted?: boolean
}

/** The server found an almost identical complaint from the same person in the last 2 hours. */
export interface DuplicateInfo {
  submission_id: string
  created_at: string
  status: string
  issues: { category_raw: string | null; item: string | null; ai_summary: string | null }[]
}
export class DuplicateError extends Error {
  info: DuplicateInfo
  constructor(info: DuplicateInfo) { super('Looks like a complaint you already sent.'); this.info = info }
}

function extFor(mime: string): string {
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'm4a'
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('wav')) return 'wav'
  return 'webm'
}

/** Where the audio goes. Fixed by user + recording id, so it is known before uploading. */
function audioPathFor(userId: string, clientId: string, mime: string): string {
  return `${userId}/${clientId}.${extFor(mime.split(';')[0] || 'audio/webm')}`
}

/** Uploads the original audio once. "Already exists" counts as success (a retry). */
async function uploadAudio(path: string, blob: Blob, mime: string): Promise<void> {
  const contentType = mime.split(';')[0] || 'audio/webm'      // storage checks the plain type
  const { error } = await supabase.storage.from('recordings').upload(path, blob, { contentType, upsert: false })
  if (error && !/exists|duplicate/i.test(error.message)) {
    throw new Error(navigator.onLine ? `Could not upload the recording: ${error.message}` : 'You are offline. Your recording is saved; submit again when online.')
  }
}

export async function submitRecording(input: {
  userId: string
  clientSubmissionId: string
  blob: Blob
  mimeType: string
  durationSec: number
  reviewedTranscript: string
  rawTranscript: string | null
  transcriptionMeta: Record<string, unknown> | undefined
  allowDuplicate?: boolean      // user saw the "already sent" warning and chose to send anyway
  chosenCalendarEventId?: string | null   // recorder's pick when the event was uncertain ('none' = none)
}): Promise<SubmitResult> {
  // The audio upload and the processing run AT THE SAME TIME (the path is known
  // in advance), so the recorder doesn't wait for one and then the other.
  const audioPath = audioPathFor(input.userId, input.clientSubmissionId, input.mimeType)
  const upload = uploadAudio(audioPath, input.blob, input.mimeType)
  upload.catch(() => { /* checked below, after processing */ })

  const { data, error } = await supabase.functions.invoke('process-issue', {
    body: {
      action: 'submit',
      client_submission_id: input.clientSubmissionId,
      reviewed_transcript: input.reviewedTranscript,
      raw_transcript: input.rawTranscript,
      transcription_meta: input.transcriptionMeta ?? {},
      audio_path: audioPath,
      audio_mime: input.mimeType.split(';')[0],
      audio_duration_sec: Math.round(input.durationSec * 10) / 10,
      allow_duplicate: input.allowDuplicate === true,
      chosen_calendar_event_id: input.chosenCalendarEventId ?? null,
    },
  })
  if (error) {
    let message = navigator.onLine ? 'Could not reach the server. Your recording is saved; please submit again.' : 'You are offline. Your recording is saved; submit again when online.'
    if (error instanceof FunctionsHttpError) {
      try {
        const body = await error.context.json()
        if (error.context.status === 409 && body?.duplicate_of) throw new DuplicateError(body.duplicate_of)
        message = body?.error ?? message
      } catch (e) { if (e instanceof DuplicateError) throw e }
    }
    throw new Error(message)
  }
  // Issues are saved; make sure the audio got there too (one more try). If it
  // still fails, the error keeps the draft, and tapping Submit again finishes
  // the upload (the submission itself is never created twice).
  try { await upload } catch { await uploadAudio(audioPath, input.blob, input.mimeType) }
  return data as SubmitResult
}
