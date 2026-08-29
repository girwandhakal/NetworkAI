/**
 * Persists the raw bytes behind a context item (photo, video, voice note) so
 * regeneration can re-read it later — a different day, a different device.
 * Firestore only ever holds the resulting metadata + download URL; the
 * bytes live in Firebase Storage under the same /users/{uid} boundary the
 * Firestore rules already enforce.
 *
 * With no Firebase project configured (or in demo mode, which swaps the
 * whole data layer for an in-memory store), there is nothing real to upload
 * to — bytes are kept in an in-memory map instead, keyed by the item id, so
 * capture and regeneration still work end to end for the length of the tab.
 */

import { deleteObject, getBytes, getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { firebaseReady, storage } from './firebase'
import { isDemo } from './demo'
import { blobToBase64 } from './media'

const hasRealStorage = () => firebaseReady && !isDemo()

const memory = new Map<string, string>() // item id -> base64, used when hasRealStorage() is false

const contextPath = (uid: string, eventId: string, contactId: string, itemId: string) =>
  `users/${uid}/events/${eventId}/contacts/${contactId}/context/${itemId}`

export async function uploadContextFile(
  uid: string,
  eventId: string,
  contactId: string,
  itemId: string,
  blob: Blob,
  mimeType: string,
): Promise<{ storagePath: string; url: string }> {
  if (!hasRealStorage()) {
    memory.set(itemId, await blobToBase64(blob))
    return { storagePath: itemId, url: URL.createObjectURL(blob) }
  }
  const storagePath = contextPath(uid, eventId, contactId, itemId)
  const objectRef = ref(storage, storagePath)
  await uploadBytes(objectRef, blob, { contentType: mimeType })
  const url = await getDownloadURL(objectRef)
  return { storagePath, url }
}

/** Base64, ready to drop straight into a Gemini inlineData part. */
export async function fetchContextBase64(storagePath: string): Promise<string> {
  const cached = memory.get(storagePath)
  if (cached !== undefined) return cached
  const bytes = await getBytes(ref(storage, storagePath))
  let binary = ''
  const chunk = 0x8000 // avoid a stack-overflow from spreading a huge byte array at once
  const view = new Uint8Array(bytes)
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export async function deleteContextFile(storagePath: string): Promise<void> {
  if (memory.delete(storagePath)) return
  await deleteObject(ref(storage, storagePath)).catch(() => {
    // Already gone, or never finished uploading — either way there is
    // nothing left to clean up.
  })
}
