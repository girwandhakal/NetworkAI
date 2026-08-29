export type Priority = 'High' | 'Medium' | 'Low'

export const PRIORITIES: Priority[] = ['High', 'Medium', 'Low']

export type Status =
  | 'Needs follow-up'
  | 'Draft ready'
  | 'Waiting for response'
  | 'Replied'
  | 'No action needed'

export const STATUSES: Status[] = [
  'Needs follow-up',
  'Draft ready',
  'Waiting for response',
  'Replied',
  'No action needed',
]

export type Tone = 'Formal' | 'Business casual'

export const TONES: Tone[] = ['Formal', 'Business casual']

export const TONE_BLURB: Record<Tone, string> = {
  Formal: 'Polished and businesslike',
  'Business casual': 'Professional but relaxed',
}

export const DEFAULT_TONE: Tone = 'Business casual'

export interface UserProfile {
  name: string
  school: string
  major: string
  gradYear: string
  targetRoles?: string
  experiences?: string
  emailPreference?: string
  resumeText?: string
  resumeFileName?: string
  defaultTone?: Tone
  onboarded?: boolean
  email?: string
}

export interface EventRec {
  id: string
  name: string
  date: string
  location?: string
  contactCount: number
  createdAt?: string
}

export interface Summary {
  topic: string
  details: string
  connection: string
  action: string
}

/** One piece of standing context on a contact — a photo, a video, a voice
 *  note, or a typed note. The whole list is re-read together every time
 *  another item is added, so this is what regeneration reads from, not a
 *  transient capture payload. */
export interface ContextItem {
  id: string
  kind: 'photo' | 'video' | 'audio' | 'text'
  /** Storage object path — set for photo/video/audio, used to delete it. */
  storagePath?: string
  /** Download URL — set for photo/video/audio, used to re-fetch bytes. */
  url?: string
  mimeType?: string
  /** Typed-note content, stored inline instead of in Storage. */
  text?: string
  createdAt: string
}

export interface Contact {
  id: string
  name: string
  company: string
  title?: string
  email?: string
  phone?: string
  website?: string
  linkedin?: string
  notes?: string
  priority: Priority
  status: Status
  emailSubject?: string
  emailDraft?: string
  emailTone?: Tone
  linkedinNote?: string
  linkedinAdded?: boolean
  /** When true, the resume PDF is attached the next time this email is sent. */
  attachResume?: boolean
  summary?: Summary
  /** Source of the record, for the re-run affordance. Set once, from the
   *  first context item — a provenance badge, not the regeneration source. */
  captureType?: 'image' | 'voice' | 'manual'
  /** Model self-reported extraction confidence, 0-1. Drives the "check this" flag. */
  confidence?: number
  unclear?: string[]
  docType?: string
  transcript?: string
  /** Every photo, video, voice note, and typed note captured for this
   *  contact — the standing context a regeneration pass reads in full. */
  context?: ContextItem[]
  /** True while an offline-queued extraction is still waiting to run. */
  aiPending?: boolean
  aiError?: string
  sentAt?: string
  createdAt: string
  updatedAt?: string
}

/** What a full context-regeneration pass returns — read every context item
 *  together and rewrite the whole record in one shot. */
export interface ContextResult {
  docType: string
  name: string
  company: string
  title: string
  email: string
  phone: string
  website: string
  linkedin: string
  notes: string
  summary: Summary
  emailSubject: string
  emailDraft: string
  linkedinNote: string
  priority: Priority
  confidence: number
  unclear: string[]
}

export interface FollowupResult {
  emailSubject: string
  emailDraft: string
  linkedinNote: string
}

export interface ParsedResume {
  name: string
  school: string
  major: string
  gradYear: string
  targetRoles: string
  experiences: string
  resumeText: string
  resumeFileName: string
}

export interface SendResult {
  id: string
  to: string
  ok: boolean
  messageId?: string
  error?: string
}

export interface HealthInfo {
  ok: boolean
  ai: { configured: boolean; model: string }
  mail: { mode: 'resend' | 'smtp' | 'none'; from: string; ready: boolean; throttleMs: number }
  tones: string[]
}

export const LOW_CONFIDENCE = 0.6

export function needsCheck(c: Contact): boolean {
  return typeof c.confidence === 'number' && c.confidence < LOW_CONFIDENCE
}

export function hasDraft(c: Contact): boolean {
  return Boolean(c.emailDraft && c.emailDraft.trim())
}

export function displayName(c: Contact): string {
  return c.name?.trim() || c.company?.trim() || 'Untitled contact'
}

/** The row chip's provenance badge only knows the old three-way split —
 *  map whichever kind of context item started a record onto it. */
export function captureTypeFor(kind: ContextItem['kind']): Contact['captureType'] {
  if (kind === 'audio') return 'voice'
  if (kind === 'text') return 'manual'
  return 'image'
}

/** The one place that names/iconifies a context item's kind — everywhere
 *  that shows a chip or a label for one should read from here rather than
 *  re-deriving its own mapping. */
export const CONTEXT_KIND: Record<ContextItem['kind'], { label: string; icon: 'camera' | 'video' | 'mic' | 'text' }> = {
  photo: { label: 'Photo', icon: 'camera' },
  video: { label: 'Video', icon: 'video' },
  audio: { label: 'Voice note', icon: 'mic' },
  text: { label: 'Typed note', icon: 'text' },
}
