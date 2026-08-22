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
  /** Source of the record, for the re-run affordance. */
  captureType?: 'image' | 'voice' | 'manual'
  /** Model self-reported extraction confidence, 0-1. Drives the "check this" flag. */
  confidence?: number
  unclear?: string[]
  docType?: string
  transcript?: string
  /** True while an offline-queued extraction is still waiting to run. */
  aiPending?: boolean
  aiError?: string
  sentAt?: string
  createdAt: string
  updatedAt?: string
}

export interface OcrResult {
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
}

export interface NotesResult {
  transcript: string
  name: string
  company: string
  title: string
  summary: Summary
  emailSubject: string
  emailDraft: string
  linkedinNote: string
  priority: Priority
  confidence: number
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
  gemini: { configured: boolean; model: string }
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
