/**
 * The one path every capture surface goes through to add to a contact's
 * standing context — a fresh capture sheet building a brand-new contact, or
 * "capture again" adding to one that already exists. Upload/record the
 * item, append it to the contact's context list, and queue a regeneration
 * pass over the whole thing.
 *
 * Queueing after every single item (rather than batching client-side) is
 * safe and cheap: the queue's own coalescing collapses several jobs queued
 * in a row for the same contact down to one before any of them actually
 * run, so picking three photos at once still costs one regeneration call.
 */

import { getContact, updateContact } from './db'
import { enqueue } from './queue'
import { uploadContextFile } from './storage'
import { captureTypeFor, type ContextItem, type EventRec, type Tone, type UserProfile } from './types'
import { newId } from './util'

export interface AddContextInput {
  kind: ContextItem['kind']
  blob?: Blob
  mimeType?: string
  text?: string
}

export async function addContextItem(
  uid: string,
  eventId: string,
  contactId: string,
  input: AddContextInput,
  tone: Tone,
  profile: UserProfile | null,
  event: Partial<EventRec> | null,
): Promise<ContextItem> {
  const id = newId()
  const item: ContextItem =
    input.kind === 'text'
      ? { id, kind: 'text', text: input.text, createdAt: new Date().toISOString() }
      : {
          id,
          kind: input.kind,
          mimeType: input.mimeType,
          createdAt: new Date().toISOString(),
          ...(await uploadContextFile(uid, eventId, contactId, id, input.blob!, input.mimeType || '')),
        }

  const current = await getContact(uid, eventId, contactId)
  const isFirstItem = !current?.context?.length
  await updateContact(uid, eventId, contactId, {
    context: [...(current?.context || []), item],
    // A provenance badge for the contact row — set once, from whatever kind
    // of item started this record, never touched again. Keyed off whether
    // there was already any context (not off the stored captureType field
    // itself, which a fresh contact defaults to 'manual' before its first
    // item ever lands).
    captureType: isFirstItem ? captureTypeFor(input.kind) : current?.captureType,
    aiPending: true,
    aiError: '',
  })
  await enqueue({ uid, eventId, contactId, kind: 'context', tone, profile, event })
  return item
}
