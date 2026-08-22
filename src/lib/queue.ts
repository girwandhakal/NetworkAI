/**
 * Offline capture queue.
 *
 * Career fairs have terrible connectivity, and the <30s capture promise cannot
 * depend on a live Gemini round-trip. So capture always writes the contact
 * record first (Firestore's local cache absorbs that), and the AI extraction is
 * enqueued here. Jobs drain automatically when the connection returns.
 */

import { ocrCard, summarizeNotes } from './api'
import { getContact, updateContact } from './db'
import type { Contact, EventRec, Priority, Tone, UserProfile } from './types'

const DB_NAME = 'networkai-queue'
const STORE = 'jobs'
const MAX_ATTEMPTS = 5

export interface Job {
  id: string
  uid: string
  eventId: string
  contactId: string
  kind: 'ocr' | 'notes'
  /** base64 payload — image or WAV audio. Absent for a typed note. */
  data?: string
  mimeType?: string
  /** Set instead of `data` when the user typed the note rather than recording it. */
  transcript?: string
  tone: Tone
  profile: UserProfile | null
  event: Partial<EventRec> | null
  contact: Partial<Contact> | null
  createdAt: number
  attempts: number
  lastError?: string
}

/* ── IndexedDB plumbing ──────────────────────────────────── */

let dbp: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'id' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error || new Error('Could not open the offline queue.'))
    })
  }
  return dbp
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = fn(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error || new Error('Offline queue write failed.'))
      }),
  )
}

export const listJobs = () => tx<Job[]>('readonly', (s) => s.getAll() as IDBRequest<Job[]>)
const putJob = (job: Job) => tx('readwrite', (s) => s.put(job) as IDBRequest<IDBValidKey>)
const dropJob = (id: string) => tx('readwrite', (s) => s.delete(id) as unknown as IDBRequest<undefined>)

/* ── subscriptions so the UI can show queue depth ────────── */

type Listener = (state: { pending: number; running: boolean }) => void
const listeners = new Set<Listener>()
let running = false

export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  void notify()
  return () => listeners.delete(fn)
}

async function notify() {
  const jobs = await listJobs().catch(() => [] as Job[])
  const state = { pending: jobs.length, running }
  listeners.forEach((fn) => fn(state))
}

/* ── enqueue + drain ─────────────────────────────────────── */

export async function enqueue(job: Omit<Job, 'id' | 'createdAt' | 'attempts'>): Promise<void> {
  await putJob({
    ...job,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    attempts: 0,
  })
  await notify()
  void drain()
}

/** A failure worth retrying later rather than surfacing as a dead end. */
export function isNetworkError(e: unknown): boolean {
  const msg = (e as Error)?.message || ''
  return /reach the Network\.Ai server|Failed to fetch|NetworkError|network|offline|timed out|502|503|504|rate limit|quota/i.test(msg)
}

export async function drain(): Promise<void> {
  if (running || !navigator.onLine) return
  running = true
  await notify()
  try {
    for (;;) {
      const jobs = (await listJobs().catch(() => [] as Job[])).sort((a, b) => a.createdAt - b.createdAt)
      const job = jobs.find((j) => j.attempts < MAX_ATTEMPTS)
      if (!job || !navigator.onLine) break
      const done = await runJob(job)
      if (!done) break // network is down again; leave the rest queued
    }
  } finally {
    running = false
    await notify()
  }
}

/**
 * Whether another queued job still targets this same contact — a capture
 * session can leave two or three photos (or a photo plus a voice note)
 * queued against one record. "Writing it up" should stay lit until the last
 * of them finishes, not clear the moment the first one does.
 */
async function hasPendingSiblings(job: Job): Promise<boolean> {
  const jobs = await listJobs().catch(() => [] as Job[])
  return jobs.some((j) => j.id !== job.id && j.uid === job.uid && j.eventId === job.eventId && j.contactId === job.contactId)
}

/** Returns false when the job failed for a reason worth pausing the drain over. */
async function runJob(job: Job): Promise<boolean> {
  try {
    const patch = job.kind === 'ocr' ? await runOcr(job) : await runNotes(job)
    await dropJob(job.id)
    const aiPending = await hasPendingSiblings(job)
    await updateContact(job.uid, job.eventId, job.contactId, { ...patch, aiPending, aiError: '' })
    await notify()
    return true
  } catch (e) {
    const msg = (e as Error)?.message || 'Extraction failed.'
    const attempts = job.attempts + 1
    const retryable = isNetworkError(e) && attempts < MAX_ATTEMPTS
    await putJob({ ...job, attempts, lastError: msg })

    if (!retryable) {
      // Give up quietly on the record so the user sees why, and can re-run by hand.
      await dropJob(job.id)
      const aiPending = await hasPendingSiblings(job)
      await updateContact(job.uid, job.eventId, job.contactId, { aiPending, aiError: msg }).catch(() => {})
      await notify()
      return true
    }
    await notify()
    return false
  }
}

/**
 * The record as it stands right now, not as it stood when this job was
 * enqueued. Several jobs can be queued against the same contact in a row
 * (multiple photos, a photo then a voice note) and drain one after another —
 * merging against a stale snapshot would let the second job's write erase
 * whatever the first one just filled in.
 */
async function liveContact(job: Job): Promise<Partial<Contact>> {
  const live = await getContact(job.uid, job.eventId, job.contactId).catch(() => null)
  return live || job.contact || {}
}

async function runOcr(job: Job): Promise<Partial<Contact>> {
  if (!job.data) throw new Error('The captured image is missing.')
  const r = await ocrCard({ image: job.data, mimeType: job.mimeType || 'image/jpeg' })
  return mergeOcr(r, await liveContact(job))
}

async function runNotes(job: Job): Promise<Partial<Contact>> {
  const r = await summarizeNotes({
    audio: job.data,
    mimeType: job.mimeType,
    transcript: job.transcript,
    profile: job.profile,
    // Prompt context only needs to be roughly current, so the enqueue-time
    // snapshot is fine here — it is the merge below that must not be stale.
    contact: job.contact,
    event: job.event,
    tone: job.tone,
  })
  return mergeNotes(r, await liveContact(job), job.tone)
}

/* ── result merging (shared with the online path) ────────── */

const keep = (existing: string | undefined, incoming: string | undefined) =>
  existing && existing.trim() ? existing : incoming || ''

export function mergeOcr(
  r: {
    docType: string
    name: string
    company: string
    title: string
    email: string
    phone: string
    website: string
    linkedin: string
    notes: string
    priority: Priority
    confidence: number
    unclear: string[]
  },
  existing: Partial<Contact>,
): Partial<Contact> {
  return {
    // Never clobber something the user already typed; only fill blanks.
    name: keep(existing.name, r.name),
    company: keep(existing.company, r.company),
    title: keep(existing.title, r.title),
    email: keep(existing.email, r.email),
    phone: keep(existing.phone, r.phone),
    website: keep(existing.website, r.website),
    linkedin: keep(existing.linkedin, r.linkedin),
    notes: [existing.notes, r.notes].filter((s) => s && s.trim()).join('\n\n'),
    priority: existing.priority || r.priority,
    // First image sets the document type; later ones (a flyer after the
    // business card, say) do not overwrite it.
    docType: existing.docType || r.docType,
    // The more cautious reading wins across multiple images, so the
    // "worth a check" flag stays up if any single capture was unclear —
    // one crisp follow-up photo should not silently erase that flag.
    confidence: Math.min(existing.confidence ?? 1, r.confidence),
    unclear: Array.from(new Set([...(existing.unclear || []), ...r.unclear])),
    captureType: 'image',
  }
}

export function mergeNotes(
  r: {
    transcript: string
    name: string
    company: string
    title: string
    summary: Contact['summary']
    emailSubject: string
    emailDraft: string
    linkedinNote: string
    priority: Priority
    confidence: number
  },
  existing: Partial<Contact>,
  tone: Tone,
): Partial<Contact> {
  return {
    name: keep(existing.name, r.name),
    company: keep(existing.company, r.company),
    title: keep(existing.title, r.title),
    summary: r.summary,
    transcript: r.transcript,
    emailSubject: r.emailSubject,
    emailDraft: r.emailDraft,
    emailTone: tone,
    linkedinNote: r.linkedinNote,
    priority: existing.priority || r.priority,
    confidence: r.confidence,
    captureType: 'voice',
    // Only advance an untouched record. Re-capturing someone already marked
    // "Replied" must not drag them back into the queue.
    status:
      !existing.status || existing.status === 'Needs follow-up'
        ? r.emailDraft
          ? 'Draft ready'
          : 'Needs follow-up'
        : existing.status,
  }
}

/* ── auto-drain triggers ─────────────────────────────────── */

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void drain())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void drain()
  })
}
