/**
 * Persists raw files — a context item (photo, voice note) or the user's
 * resume — so they can be read back later: regeneration re-reads context,
 * and the resume is both viewed and attached to emails from here.
 *
 * These bytes live in Firestore, not Cloud Storage. Storage was the obvious
 * home for them, but provisioning a bucket requires the Blaze plan, and this
 * project runs on Spark — so there is no bucket to write to and never was.
 * Firestore is already up, already free, and already carries every other
 * record in the app under the same /users/{uid} boundary its rules enforce.
 *
 * The one thing it is not built for is large values: a single document is
 * capped at ~1 MiB. So a file goes in base64-encoded and split across a
 * `parts` subcollection, with a head document holding the metadata:
 *
 *   users/{uid}/blobs/{key}            { mime, size, chunks, token }
 *   users/{uid}/blobs/{key}/parts/{n}  { b64 }
 *
 * Reading the bytes back into the browser is a plain Firestore read. Serving
 * them to something that wants a URL — pdf.js, an <img>, the mail sender —
 * goes through the server's /api/blob route, which is what the `url` handed
 * back from an upload points at.
 *
 * With no Firebase project configured (or in demo mode, which swaps the
 * whole data layer for an in-memory store), there is nothing real to upload
 * to — bytes are kept in an in-memory map instead, keyed by the item id, so
 * capture and regeneration still work end to end for the length of the tab.
 */

import { collection, doc, getDoc, getDocs, writeBatch, type DocumentReference } from 'firebase/firestore'
import { db, firebaseReady } from './firebase'
import { isDemo } from './demo'
import { blobToBase64 } from './media'

const hasRealStorage = () => firebaseReady && !isDemo()

const memory = new Map<string, string>() // item id -> base64, used when hasRealStorage() is false

const contextPath = (uid: string, eventId: string, contactId: string, itemId: string) =>
  `users/${uid}/events/${eventId}/contacts/${contactId}/context/${itemId}`

/* ── chunking ────────────────────────────────────────────── */

// A Firestore document is capped at ~1 MiB including field names and
// overhead, so base64 goes in at half that — clear of the ceiling with room
// to spare even for the largest file the upload UI accepts.
const CHUNK = 512 * 1024

// A batched write is capped at 10 MiB in total, which a big file's chunks
// would blow straight through in one commit. Eight at a time keeps every
// commit around 4 MiB while still being far fewer round trips than writing
// each chunk on its own — which matters on venue Wi-Fi.
const CHUNKS_PER_COMMIT = 8

/** Both callers build paths as `users/{uid}/...`, so the uid is recoverable
 *  from the path itself rather than threaded through every function. */
const uidOf = (storagePath: string) => storagePath.split('/')[1] || ''

/** `users/{uid}/events/E/contacts/C/context/I` -> `events~E~contacts~C~context~I`.
 *  A document id may not contain a slash, so the path below the user
 *  collapses into one — the blobs collection stays flat and the rules that
 *  guard it stay a single match block. */
const blobKey = (storagePath: string) => storagePath.replace(/^users\/[^/]+\//, '').replace(/\//g, '~')

const headRef = (storagePath: string): DocumentReference =>
  doc(db, 'users', uidOf(storagePath), 'blobs', blobKey(storagePath))

/** crypto.randomUUID() is only defined in a secure context, and this app is
 *  meant to be opened from a phone at `http://<laptop-ip>:5173` on venue
 *  Wi-Fi — which is not one. getRandomValues has no such restriction. */
function randomToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** What the browser and the mail sender fetch to get the bytes as a file. */
const blobUrl = (storagePath: string, token: string) =>
  `/api/blob?path=${encodeURIComponent(storagePath)}&token=${token}`

/** A re-upload writes fewer chunks than last time whenever the new file is
 *  smaller, so the old tail has to go or reads would splice the two files
 *  together. */
async function clearParts(head: DocumentReference): Promise<void> {
  const existing = await getDocs(collection(head, 'parts'))
  for (let i = 0; i < existing.docs.length; i += 400) {
    const batch = writeBatch(db)
    existing.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref))
    await batch.commit()
  }
}

async function uploadRaw(storagePath: string, blob: Blob, mimeType: string): Promise<{ storagePath: string; url: string }> {
  if (!hasRealStorage()) {
    memory.set(storagePath, await blobToBase64(blob))
    return { storagePath, url: URL.createObjectURL(blob) }
  }

  const b64 = await blobToBase64(blob)
  const head = headRef(storagePath)
  const parts = collection(head, 'parts')
  await clearParts(head)

  const slices: string[] = []
  for (let i = 0; i < b64.length; i += CHUNK) slices.push(b64.slice(i, i + CHUNK))

  for (let i = 0; i < slices.length; i += CHUNKS_PER_COMMIT) {
    const batch = writeBatch(db)
    slices.slice(i, i + CHUNKS_PER_COMMIT).forEach((b, n) => batch.set(doc(parts, String(i + n)), { b64: b }))
    await batch.commit()
  }

  // The head lands last, so a write that dies partway through leaves no
  // document claiming a chunk count it cannot back up.
  const token = randomToken()
  const batch = writeBatch(db)
  batch.set(head, {
    mime: mimeType || 'application/octet-stream',
    size: blob.size,
    chunks: slices.length,
    token,
    updatedAt: new Date().toISOString(),
  })
  await batch.commit()

  return { storagePath, url: blobUrl(storagePath, token) }
}

export function uploadContextFile(
  uid: string,
  eventId: string,
  contactId: string,
  itemId: string,
  blob: Blob,
  mimeType: string,
): Promise<{ storagePath: string; url: string }> {
  return uploadRaw(contextPath(uid, eventId, contactId, itemId), blob, mimeType)
}

/** One resume per user, at a fixed path — a re-upload overwrites the
 *  previous file rather than piling up old versions. */
export function uploadResumeFile(uid: string, blob: Blob, mimeType: string): Promise<{ storagePath: string; url: string }> {
  return uploadRaw(`users/${uid}/resume`, blob, mimeType)
}

/** Base64, ready to drop straight into a context item sent to the server. */
export async function fetchContextBase64(storagePath: string): Promise<string> {
  const cached = memory.get(storagePath)
  if (cached !== undefined) return cached

  const head = await getDoc(headRef(storagePath))
  if (!head.exists()) throw new Error('That file is no longer stored — re-capture it.')
  const chunks = Number(head.data().chunks) || 0

  // Fetched in parallel and joined in index order; a chunk that came back
  // empty would silently corrupt the file, so treat it as a hard failure.
  const parts = await Promise.all(
    Array.from({ length: chunks }, (_, i) => getDoc(doc(collection(headRef(storagePath), 'parts'), String(i)))),
  )
  return parts
    .map((p, i) => {
      const b64 = p.exists() ? String(p.data().b64 || '') : ''
      if (!b64) throw new Error(`That file is incomplete (chunk ${i} is missing) — re-capture it.`)
      return b64
    })
    .join('')
}

export async function deleteContextFile(storagePath: string): Promise<void> {
  if (memory.delete(storagePath)) return
  try {
    const head = headRef(storagePath)
    await clearParts(head)
    const batch = writeBatch(db)
    batch.delete(head)
    await batch.commit()
  } catch {
    // Already gone, or never finished uploading — either way there is
    // nothing left to clean up.
  }
}
