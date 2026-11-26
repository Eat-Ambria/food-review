// Loads issues and submissions for the lists and the dashboard, plus the admin retry / choose-function actions.
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { MatchCandidate } from '../types/events'

export interface FeedIssue {
  issue_id: string
  submission_id: string
  issue_index: number
  created_at: string
  event_day: string
  category: string
  item: string | null
  description: string
  summary: string | null
  location: string | null
  original_text: string | null
  venue_id: string | null
  venue_name: string | null
  calendar_event_id: string | null
  guest_name: string | null
  function_name: string | null
  shift: string | null
  sub_venue: string | null
  event_title: string | null
  match_status: string | null
  transcript: string
  audio_path: string | null
  audio_duration_sec: number | null
  recorded_by: string | null
  is_serious: boolean
  serious_keywords: string[] | null
  recorded_by_mobile?: string | null
}

export interface Compliment {
  id: string; submission_id: string; created_at: string; event_day: string; item: string | null; summary: string
  original_text: string | null; venue_id: string | null; venue_name: string | null; recorded_by: string | null
  transcript?: string | null; audio_path?: string | null
}

export async function fetchCompliments(from: string, to: string): Promise<Compliment[]> {
  const { data, error } = await supabase.rpc('compliments_feed', { p_from: from, p_to: to })
  if (error) return []
  return (data ?? []) as Compliment[]
}

export async function fetchIssues(opts: { from: string; to: string; venueId?: string | null; category?: string | null }): Promise<FeedIssue[]> {
  const { data, error } = await supabase.rpc('issues_feed', {
    p_from: opts.from, p_to: opts.to, p_venue_id: opts.venueId ?? null, p_category: opts.category ?? null,
  })
  if (error) throw new Error('Could not load issues. ' + error.message)
  return (data ?? []) as FeedIssue[]
}

export async function submissionDays(submissionId: string): Promise<{ from: string; to: string } | null> {
  const [{ data: sub }, { data: issues }] = await Promise.all([
    supabase.from('submissions').select('event_date, created_at').eq('id', submissionId).maybeSingle(),
    supabase.from('issues').select('event_info').eq('submission_id', submissionId),
  ])
  if (!sub) return null
  const recorded = new Date(new Date(sub.created_at as string).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10)
  const fallback = (sub.event_date as string | null) ?? recorded
  const days = (issues ?? []).map((i) => ((i.event_info as { date?: string } | null)?.date ?? fallback).slice(0, 10))
  if (!days.length) days.push(fallback)
  days.sort()
  return { from: days[0], to: days[days.length - 1] }
}

export async function audioUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('recordings').createSignedUrl(path, 60 * 30)
  if (error || !data?.signedUrl) throw new Error('Recording is not available.')
  return data.signedUrl
}

export async function listCategories(): Promise<string[]> {
  const { data } = await supabase.from('issue_categories').select('name').eq('is_active', true).order('sort_order')
  return (data ?? []).map((c) => c.name as string)
}

export interface MySubmission {
  id: string
  created_at: string
  processing_status: string
  processing_error: string | null
  is_serious: boolean
  reviewed_transcript: string
  event_date: string | null
  guest_name: string | null
  function_name: string | null
  venue_id: string | null
  venue: { venue_name: string } | null
  issues: { issue_index: number; category_raw: string | null; item: string | null; ai_summary: string | null; venue_id: string | null; venue: { venue_name: string } | null }[]
}

export async function fetchMySubmissions(userId: string, fromTs: string, toTs: string): Promise<MySubmission[]> {
  const { data, error } = await supabase.from('submissions')
    .select('id, created_at, processing_status, processing_error, is_serious, reviewed_transcript, event_date, guest_name, function_name, venue_id, venue:venues(venue_name), issues(issue_index, category_raw, item, ai_summary, venue_id, venue:venues(venue_name))')
    .eq('submitted_by', userId)
    .gte('created_at', fromTs)
    .lte('created_at', toTs)
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) throw new Error('Could not load your submissions. ' + error.message)
  return (data ?? []) as unknown as MySubmission[]
}

export interface AttentionItem {
  submission_id: string
  created_at: string
  processing_status: string
  processing_error: string | null
  attempt_count: number
  next_attempt_at: string | null
  transcript: string
  recorded_by: string | null
  event_status: string | null
  event_match: { candidates?: MatchCandidate[]; reasons?: string[] } | null
  issue_count: number
}

export async function fetchAttention(): Promise<AttentionItem[]> {
  const { data, error } = await supabase.rpc('admin_attention')
  if (error) throw new Error('Could not load. ' + error.message)
  return (data ?? []) as AttentionItem[]
}

export interface JobRun { started_at: string; finished_at: string | null; ok: boolean | null; stats: Record<string, unknown> }

export async function lastCronRun(): Promise<JobRun | null> {
  const { data } = await supabase.from('job_runs').select('started_at, finished_at, ok, stats')
    .eq('job', 'issue-desk-cron').order('started_at', { ascending: false }).limit(1).maybeSingle()
  return (data as JobRun | null) ?? null
}

async function adminDelete(body: Record<string, string>): Promise<'issue' | 'recording'> {
  const { data, error } = await supabase.functions.invoke('process-issue', { body })
  if (error) {
    let message = 'Could not delete.'
    if (error instanceof FunctionsHttpError) {
      try { message = (await error.context.json())?.error ?? message } catch { }
    }
    throw new Error(message)
  }
  return data?.deleted === 'issue' ? 'issue' : 'recording'
}
export const deleteIssue = (issueId: string) => adminDelete({ action: 'delete_issue', issue_id: issueId })
export const deleteRecording = (submissionId: string) => adminDelete({ action: 'delete_submission', submission_id: submissionId })

export async function retryProcessing(submissionId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('process-issue', { body: { action: 'retry', submission_id: submissionId } })
  if (error) {
    let message = 'Retry failed.'
    if (error instanceof FunctionsHttpError) {
      try { message = (await error.context.json())?.error ?? message } catch { }
    }
    throw new Error(message)
  }
  if (data?.status === 'failed') throw new Error(data?.error ?? 'Processing failed again.')
}
