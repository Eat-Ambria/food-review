// Saves the unsent recording on the phone so it is not lost if the app closes.
const DB_NAME = 'issue-desk'
const STORE = 'drafts'

export interface Draft {
  userId: string
  clientSubmissionId: string
  blob: Blob
  mimeType: string
  durationSec: number
  createdAt: string
  rawTranscript?: string
  editedTranscript?: string

  transcriptionState?: { total: number; results: ({ text: string; language: string | null; requestId: string | null } | null)[] }
  transcriptionMeta?: Record<string, unknown>

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
  try { await tx('readwrite', (s) => s.delete(userId)) } catch { }
}
