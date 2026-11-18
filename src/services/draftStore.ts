// =============================================================================
// WHAT THIS FILE IS
//   Saves the current unsent recording (and later its transcript) on the
//   device, in IndexedDB.
// WHY IT EXISTS
//   "Do not lose audio due to temporary network issues." The recording is saved
//   the moment it stops, so a page refresh, a closed tab, a dead battery or a
//   failed upload never loses it. When the Record page opens it offers to
//   restore it. The draft is deleted only after a successful submit, or when
//   the user chooses "Record again" / "Discard".
//   Each draft has a client_submission_id, created once on the device. The
//   server uses it to make re-submitting the same draft safe (no duplicates).
//   One draft per user, keyed by user id, so two people sharing a phone never
//   see each other's recording.
//   IndexedDB (not localStorage) because it can store audio Blobs directly.
// USED BY
//   pages/Recording/RecordPage.tsx (Phase 4/6 will add the transcript + submit state)
// =============================================================================

const DB_NAME = 'issue-desk'
const STORE = 'drafts'

export interface Draft {
  userId: string
  clientSubmissionId: string
  blob: Blob
  mimeType: string
  durationSec: number
  createdAt: string
  rawTranscript?: string       // Sarvam output, never changed afterwards
  editedTranscript?: string    // what the user typed over it
  // Per-chunk results of an unfinished transcription, so a retry only redoes missing chunks.
  transcriptionState?: { total: number; results: ({ text: string; language: string | null; requestId: string | null } | null)[] }
  transcriptionMeta?: Record<string, unknown>
  // Which Calendar booking the transcript is about (worked out on the server).
  eventMatch?: import('../types/events').EventMatch
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB not available')); return }
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'userId' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = run(t.objectStore(STORE))
    t.oncomplete = () => { db.close(); resolve(req.result as T) }
    t.onerror = () => { db.close(); reject(t.error) }
    t.onabort = () => { db.close(); reject(t.error) }
  })
}

/** Returns false if the device refused to save (private mode, storage full). */
export async function saveDraft(d: Draft): Promise<boolean> {
  try { await tx('readwrite', (s) => s.put(d)); return true } catch (e) { console.warn('Draft not saved', e); return false }
}

export async function loadDraft(userId: string): Promise<Draft | null> {
  try { return (await tx<Draft | undefined>('readonly', (s) => s.get(userId))) ?? null } catch { return null }
}

export async function updateDraft(userId: string, patch: Partial<Draft>): Promise<void> {
  const d = await loadDraft(userId)
  if (d) await saveDraft({ ...d, ...patch, userId })
}

export async function deleteDraft(userId: string): Promise<void> {
  try { await tx('readwrite', (s) => s.delete(userId)) } catch { /* nothing to delete */ }
}
