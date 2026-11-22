// Keeps finished recordings on the phone and sends them in the background, one by one, until each is submitted.
import { TranscriptionError, transcribe, type TranscriptionState } from './sarvamService'
import { DuplicateError, submitRecording, type SubmitResult } from './submitService'

const DB_NAME = 'issue-desk'
const OLD_STORE = 'drafts'
const STORE = 'outbox'

export interface OutboxItem {
  clientSubmissionId: string
  userId: string
  blob: Blob
  mimeType: string
  durationSec: number
  createdAt: string
  transcript?: string
  transcriptionState?: TranscriptionState
  transcriptionMeta?: Record<string, unknown>
  attempts: number
  nextTryAt?: string
}

export type OutboxNotice =
  | { kind: 'sent'; result: SubmitResult }
  | { kind: 'dropped'; message: string }
  | { kind: 'duplicate' }
  | { kind: 'changed' }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB not available')); return }
    const req = indexedDB.open(DB_NAME, 2)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'clientSubmissionId' })
      if (!db.objectStoreNames.contains(OLD_STORE)) return
      const t = req.transaction!
      const all = t.objectStore(OLD_STORE).getAll()
      all.onsuccess = () => {
        for (const d of all.result ?? []) {
          t.objectStore(STORE).put({
            clientSubmissionId: d.clientSubmissionId, userId: d.userId, blob: d.blob, mimeType: d.mimeType,
            durationSec: d.durationSec, createdAt: d.createdAt, transcript: d.editedTranscript ?? d.rawTranscript,
            transcriptionState: d.transcriptionState, transcriptionMeta: d.transcriptionMeta, attempts: 0,
          } satisfies OutboxItem)
        }
        t.objectStore(OLD_STORE).clear()
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = op(t.objectStore(STORE))
    t.oncomplete = () => { db.close(); resolve(req.result as T) }
    t.onerror = () => { db.close(); reject(t.error) }
    t.onabort = () => { db.close(); reject(t.error) }
  })
}

const listeners = new Set<(n: OutboxNotice) => void>()
export function onOutboxNotice(fn: (n: OutboxNotice) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
const notify = (n: OutboxNotice) => listeners.forEach((fn) => fn(n))

const memory = new Map<string, OutboxItem>()

async function put(item: OutboxItem): Promise<void> {
  try { await run('readwrite', (s) => s.put(item)); memory.delete(item.clientSubmissionId) } catch { memory.set(item.clientSubmissionId, item) }
  notify({ kind: 'changed' })
}

async function remove(id: string): Promise<void> {
  memory.delete(id)
  try { await run('readwrite', (s) => s.delete(id)) } catch { }
  notify({ kind: 'changed' })
}

export const listOutbox = (userId: string) => list(userId)

async function list(userId: string): Promise<OutboxItem[]> {
  let stored: OutboxItem[] = []
  try { stored = await run<OutboxItem[]>('readonly', (s) => s.getAll()) } catch { }
  const byId = new Map([...stored, ...memory.values()].map((i) => [i.clientSubmissionId, i]))
  return [...byId.values()].filter((i) => i.userId === userId).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}


const later = (attempts: number) =>
  new Date(Date.now() + Math.min(30 * 60_000, 15_000 * 2 ** attempts) * (0.7 + Math.random() * 0.6)).toISOString()

async function sendOne(item: OutboxItem): Promise<void> {
  let current = item
  if (!current.transcript) {
    try {
      const res = await transcribe(current.blob, current.clientSubmissionId, () => { }, current.transcriptionState ?? null)
      current = { ...current, transcript: res.text, transcriptionMeta: res.meta, transcriptionState: undefined }
      await put(current)
    } catch (e) {
      const err = e instanceof TranscriptionError ? e : new TranscriptionError('Transcription failed.', true, null)
      if (!err.retryable) {
        await remove(current.clientSubmissionId)
        notify({ kind: 'dropped', message: err.message })
        return
      }
      await put({ ...current, transcriptionState: err.partial ?? current.transcriptionState,
        attempts: current.attempts + 1, nextTryAt: err.retryAt ?? later(current.attempts) })
      return
    }
  }

  try {
    const result = await submitRecording({
      userId: current.userId,
      clientSubmissionId: current.clientSubmissionId,
      blob: current.blob,
      mimeType: current.mimeType,
      durationSec: current.durationSec,
      reviewedTranscript: current.transcript!,
      rawTranscript: current.transcript!,
      transcriptionMeta: current.transcriptionMeta,
    })
    await remove(current.clientSubmissionId)
    notify({ kind: 'sent', result })
  } catch (e) {
    if (e instanceof DuplicateError) {
      await remove(current.clientSubmissionId)
      notify({ kind: 'duplicate' })
      return
    }
    await put({ ...current, attempts: current.attempts + 1, nextTryAt: later(current.attempts) })
  }
}

let running = false
let again = false
let timer: ReturnType<typeof setTimeout> | undefined

export async function runOutbox(userId: string): Promise<void> {
  if (running) { again = true; return }
  running = true
  clearTimeout(timer)
  try {
    do {
      again = false
      if (typeof navigator !== 'undefined' && !navigator.onLine) break
      for (const item of await list(userId)) {
        if (item.nextTryAt && new Date(item.nextTryAt).getTime() > Date.now()) continue
        await sendOne(item)
      }
    } while (again)
  } finally {
    running = false
  }
  const waiting = (await list(userId)).map((i) => (i.nextTryAt ? new Date(i.nextTryAt).getTime() : Date.now()))
  if (waiting.length) {
    const ms = Math.max(2000, Math.min(...waiting) - Date.now() + 500)
    timer = setTimeout(() => void runOutbox(userId), Math.min(ms, 2 ** 31 - 1))
  }
}

export async function addToOutbox(item: Omit<OutboxItem, 'attempts'>): Promise<void> {
  await put({ ...item, attempts: 0 })
  void runOutbox(item.userId)
}
