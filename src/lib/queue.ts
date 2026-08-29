/**
 * Offline capture queue.
 *
 * Career fairs have terrible connectivity, and the <30s capture promise cannot
 * depend on a live Gemini round-trip. So capture always writes the contact
 * record — and its context item — first (Firestore's local cache absorbs
 * that), and the AI regeneration is enqueued here. Jobs drain automatically
 * when the connection returns.
 */

import { generateContext, type ContextItemInput } from './api'
import { fetchContextBase64 } from './storage'
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
  kind: 'context'
  tone: Tone
  profile: UserProfile | null
  event: Partial<EventRec> | null
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

/**
 * Every context job for the same contact regenerates from that contact's
 * *current* context list — it carries no payload of its own. So if three
 * are queued in a row (three photos picked at once, or a photo followed
 * moments later by a voice note), only the newest is worth actually
 * running; the rest would just repeat that same call. Drop the redundant
 * ones before picking what to run next.
 */
async function coalesce(): Promise<void> {
  const jobs = await listJobs().catch(() => [] as Job[])
  const byContact = new Map<string, Job[]>()
  for (const j of jobs) {
    const key = `${j.uid}/${j.eventId}/${j.contactId}`
    const list = byContact.get(key) || []
    list.push(j)
    byContact.set(key, list)
  }
  for (const list of byContact.values()) {
    if (list.length < 2) continue
    list.sort((a, b) => a.createdAt - b.createdAt)
    for (const stale of list.slice(0, -1)) await dropJob(stale.id)
  }
}

export async function drain(): Promise<void> {
  if (running || !navigator.onLine) return
  running = true
  await notify()
  try {
    for (;;) {
      await coalesce()
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
 * Whether another job for this same contact is already queued behind this
 * one — the coalesce pass only runs at the top of the drain loop, so an
 * item added while this job is mid-flight enqueues a fresh one that has not
 * been coalesced away yet. "Writing it up" should stay lit until that one
 * finishes too, not clear a beat early.
 */
async function hasPendingSiblings(job: Job): Promise<boolean> {
  const jobs = await listJobs().catch(() => [] as Job[])
  return jobs.some((j) => j.id !== job.id && j.uid === job.uid && j.eventId === job.eventId && j.contactId === job.contactId)
}

/** Returns false when the job failed for a reason worth pausing the drain over. */
async function runJob(job: Job): Promise<boolean> {
  try {
    const patch = await runContext(job)
    await dropJob(job.id)
    const aiPending = await hasPendingSiblings(job)
    await updateContact(job.uid, job.eventId, job.contactId, { ...patch, aiPending, aiError: '' })
    await notify()
    return true
  } catch (e) {
    const msg = (e as Error)?.message || 'Regeneration failed.'
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

async function runContext(job: Job): Promise<Partial<Contact>> {
  const contact = await getContact(job.uid, job.eventId, job.contactId)
  const contextList = contact?.context || []
  if (!contextList.length) return {}

  const items: ContextItemInput[] = []
  for (const item of contextList) {
    if (item.kind === 'text') {
      if (item.text?.trim()) items.push({ kind: 'text', text: item.text })
    } else if (item.storagePath) {
      const data = await fetchContextBase64(item.storagePath)
      items.push({ kind: item.kind, mimeType: item.mimeType, data })
    }
  }
  if (!items.length) return {}

  const r = await generateContext({
    items,
    profile: job.profile,
    contact,
    event: job.event,
    tone: job.tone,
  })
  return mergeContext(r, contact || {})
}

/* ── result merging ──────────────────────────────────────── */

const keep = (existing: string | undefined, incoming: string | undefined) =>
  existing && existing.trim() ? existing : incoming || ''

export function mergeContext(
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
    summary: Contact['summary']
    emailSubject: string
    emailDraft: string
    linkedinNote: string
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
    // Everything below reflects the *whole* context as of this pass, so it
    // is rewritten in full each time rather than merged — that is the point
    // of reading all the context together instead of one item at a time.
    notes: r.notes,
    summary: r.summary,
    emailSubject: r.emailSubject,
    emailDraft: r.emailDraft,
    linkedinNote: r.linkedinNote,
    priority: r.priority,
    docType: r.docType,
    confidence: r.confidence,
    unclear: r.unclear,
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
