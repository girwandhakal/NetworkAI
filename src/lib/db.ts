import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  increment,
  setDoc,
  updateDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from './firebase'
import { demoDb, isDemo } from './demo'
import type { Contact, EventRec, UserProfile } from './types'

/* ── paths (everything scoped under /users/{uid}) ────────── */

const userDoc = (uid: string) => doc(db, 'users', uid)
const eventsCol = (uid: string) => collection(db, 'users', uid, 'events')
const eventDoc = (uid: string, eventId: string) => doc(db, 'users', uid, 'events', eventId)
const contactsCol = (uid: string, eventId: string) => collection(db, 'users', uid, 'events', eventId, 'contacts')
const contactDoc = (uid: string, eventId: string, contactId: string) =>
  doc(db, 'users', uid, 'events', eventId, 'contacts', contactId)

const now = () => new Date().toISOString()

/** Firestore rejects `undefined`; strip it rather than sprinkling guards at call sites. */
function prune<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = prune(v as Record<string, unknown>)
    } else {
      out[k] = v
    }
  }
  return out
}

/** Writes we cannot await without stalling offline. Surface failures in the console. */
function fireAndForget(p: Promise<unknown>, what: string): void {
  void p.catch((e) => console.error(`Firestore write failed (${what}):`, e))
}

/* ── profile ─────────────────────────────────────────────── */

async function real_getProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(userDoc(uid))
  return snap.exists() ? (snap.data() as UserProfile) : null
}

function real_watchProfile(uid: string, cb: (p: UserProfile | null) => void): Unsubscribe {
  return onSnapshot(
    userDoc(uid),
    (snap) => cb(snap.exists() ? (snap.data() as UserProfile) : null),
    () => cb(null),
  )
}

async function real_saveProfile(uid: string, patch: Partial<UserProfile>): Promise<void> {
  fireAndForget(setDoc(userDoc(uid), prune({ ...patch, updatedAt: now() }), { merge: true }), 'save profile')
}

/* ── events ──────────────────────────────────────────────── */

function real_watchEvents(uid: string, cb: (events: EventRec[]) => void, onError?: (e: Error) => void): Unsubscribe {
  const q = query(eventsCol(uid), orderBy('date', 'desc'))
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ ...(d.data() as EventRec), id: d.id }))),
    (e) => onError?.(e as Error),
  )
}

function real_watchEvent(uid: string, eventId: string, cb: (e: EventRec | null) => void): Unsubscribe {
  return onSnapshot(
    eventDoc(uid, eventId),
    (snap) => cb(snap.exists() ? ({ ...(snap.data() as EventRec), id: snap.id }) : null),
    () => cb(null),
  )
}

async function real_createEvent(uid: string, data: { name: string; date: string; location?: string }): Promise<string> {
  const ref = doc(eventsCol(uid))
  fireAndForget(setDoc(ref, prune({ ...data, id: ref.id, contactCount: 0, createdAt: now() })), 'create event')
  return ref.id
}

async function real_updateEvent(uid: string, eventId: string, patch: Partial<EventRec>): Promise<void> {
  fireAndForget(updateDoc(eventDoc(uid, eventId), prune(patch)), 'update event')
}

async function real_deleteEvent(uid: string, eventId: string): Promise<void> {
  // Firestore does not cascade; clear the subcollection first so contacts
  // never outlive their event as orphans.
  const snap = await getDocs(contactsCol(uid, eventId))
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = writeBatch(db)
    snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref))
    await batch.commit()
  }
  await deleteDoc(eventDoc(uid, eventId))
}

/**
 * contactCount is denormalized. It is kept honest by increment() on every
 * contact write; this rebuilds it from the real subcollection if it ever drifts.
 */
async function real_recountEvent(uid: string, eventId: string): Promise<number> {
  const snap = await getDocs(contactsCol(uid, eventId))
  await updateDoc(eventDoc(uid, eventId), { contactCount: snap.size })
  return snap.size
}

/* ── contacts ────────────────────────────────────────────── */

function real_watchContacts(
  uid: string,
  eventId: string,
  cb: (contacts: Contact[]) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  const q = query(contactsCol(uid, eventId), orderBy('createdAt', 'desc'))
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ ...(d.data() as Contact), id: d.id }))),
    (e) => onError?.(e as Error),
  )
}

function real_watchContact(
  uid: string,
  eventId: string,
  contactId: string,
  cb: (c: Contact | null) => void,
): Unsubscribe {
  return onSnapshot(
    contactDoc(uid, eventId, contactId),
    (snap) => cb(snap.exists() ? ({ ...(snap.data() as Contact), id: snap.id }) : null),
    () => cb(null),
  )
}

/**
 * One-shot read of the current record — as opposed to the enqueue-time
 * snapshot a queue job carries. When several captures are queued against the
 * same contact (multiple photos, a photo plus a voice note), each job must
 * merge against whatever the *previous* job just wrote, not against a stale
 * copy from before either ran, or the later job clobbers the earlier one.
 */
async function real_getContact(uid: string, eventId: string, contactId: string): Promise<Contact | null> {
  const snap = await getDoc(contactDoc(uid, eventId, contactId))
  return snap.exists() ? ({ ...(snap.data() as Contact), id: snap.id }) : null
}

/**
 * Creates the contact and bumps the event counter.
 *
 * Deliberately NOT a transaction: transactions need a live server round-trip,
 * and this runs at career fairs where the Wi-Fi routinely dies. `increment()`
 * is applied optimistically to the local cache and resolved atomically on the
 * server when the write flushes, so the counter stays correct either way.
 */
async function real_createContact(uid: string, eventId: string, data: Partial<Contact>): Promise<string> {
  const ref = doc(contactsCol(uid, eventId))
  const payload = prune({
    priority: 'Medium',
    status: 'Needs follow-up',
    captureType: 'manual',
    ...data,
    id: ref.id,
    createdAt: data.createdAt || now(),
    updatedAt: now(),
  })

  const batch = writeBatch(db)
  batch.set(ref, payload)
  batch.set(eventDoc(uid, eventId), { contactCount: increment(1) }, { merge: true })
  // Not awaited on purpose: commit() only settles on server acknowledgement, so
  // offline it would never resolve. The local cache updates synchronously, which
  // is what every listener reads from.
  fireAndForget(batch.commit(), 'create contact')
  return ref.id
}

async function real_updateContact(
  uid: string,
  eventId: string,
  contactId: string,
  patch: Partial<Contact>,
): Promise<void> {
  // Same reasoning as createContact — edits made offline must not hang the UI.
  fireAndForget(
    updateDoc(contactDoc(uid, eventId, contactId), prune({ ...patch, updatedAt: now() })),
    'update contact',
  )
}

async function real_deleteContact(uid: string, eventId: string, contactId: string): Promise<void> {
  const batch = writeBatch(db)
  batch.delete(contactDoc(uid, eventId, contactId))
  batch.set(eventDoc(uid, eventId), { contactCount: increment(-1) }, { merge: true })
  fireAndForget(batch.commit(), 'delete contact')
}

/** Used by the bulk-send flow to stamp several contacts at once. */
async function real_bulkUpdateContacts(
  uid: string,
  eventId: string,
  updates: { id: string; patch: Partial<Contact> }[],
): Promise<void> {
  for (let i = 0; i < updates.length; i += 400) {
    const batch = writeBatch(db)
    updates.slice(i, i + 400).forEach(({ id, patch }) => {
      batch.update(contactDoc(uid, eventId, id), prune({ ...patch, updatedAt: now() }))
    })
    await batch.commit()
  }
}

async function real_getAllContacts(uid: string, eventId: string): Promise<Contact[]> {
  const snap = await getDocs(query(contactsCol(uid, eventId), orderBy('createdAt', 'desc')))
  return snap.docs.map((d) => ({ ...(d.data() as Contact), id: d.id }))
}


/* ────────────────────────────────────────────────────────────
   Demo mode swaps the whole storage layer for an in-memory store
   with the same signatures. Resolved once at import: enabling or
   leaving demo mode reloads the page, so this never changes under
   a running component. The real functions keep the type contract.
   ──────────────────────────────────────────────────────────── */

const D = isDemo()

export const getProfile: typeof real_getProfile = D ? demoDb.getProfile : real_getProfile
export const watchProfile: typeof real_watchProfile = D ? demoDb.watchProfile : real_watchProfile
export const saveProfile: typeof real_saveProfile = D ? demoDb.saveProfile : real_saveProfile
export const watchEvents: typeof real_watchEvents = D ? demoDb.watchEvents : real_watchEvents
export const watchEvent: typeof real_watchEvent = D ? demoDb.watchEvent : real_watchEvent
export const createEvent: typeof real_createEvent = D ? demoDb.createEvent : real_createEvent
export const updateEvent: typeof real_updateEvent = D ? demoDb.updateEvent : real_updateEvent
export const deleteEvent: typeof real_deleteEvent = D ? demoDb.deleteEvent : real_deleteEvent
export const recountEvent: typeof real_recountEvent = D ? demoDb.recountEvent : real_recountEvent
export const watchContacts: typeof real_watchContacts = D ? demoDb.watchContacts : real_watchContacts
export const watchContact: typeof real_watchContact = D ? demoDb.watchContact : real_watchContact
export const getContact: typeof real_getContact = D ? demoDb.getContact : real_getContact
export const createContact: typeof real_createContact = D ? demoDb.createContact : real_createContact
export const updateContact: typeof real_updateContact = D ? demoDb.updateContact : real_updateContact
export const deleteContact: typeof real_deleteContact = D ? demoDb.deleteContact : real_deleteContact
export const bulkUpdateContacts: typeof real_bulkUpdateContacts = D ? demoDb.bulkUpdateContacts : real_bulkUpdateContacts
export const getAllContacts: typeof real_getAllContacts = D ? demoDb.getAllContacts : real_getAllContacts
