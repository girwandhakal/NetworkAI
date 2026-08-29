import { demoApi, isDemo } from './demo'
import type {
  Contact,
  ContextResult,
  EventRec,
  FollowupResult,
  HealthInfo,
  ParsedResume,
  SendResult,
  Tone,
  UserProfile,
} from './types'

const DEMO = isDemo()

/**
 * In demo mode the real endpoint still gets first refusal, so a configured
 * OpenAI key produces genuine output. Canned sample results only stand in when
 * the server has no key (or is not running), which is what makes the demo
 * viewable with no credentials at all.
 */
async function orSample<T>(real: () => Promise<T>, sample: () => Promise<T>): Promise<T> {
  if (!DEMO) return real()
  try {
    return await real()
  } catch {
    return sample()
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error("Can't reach the Network.Ai server. Is it running? (npm run dev)")
  }
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status}).`)
  return json as T
}

export async function health(): Promise<HealthInfo | null> {
  let live: HealthInfo | null = null
  try {
    const res = await fetch('/api/health')
    if (res.ok) live = (await res.json()) as HealthInfo
  } catch {
    live = null
  }
  if (!DEMO) return live

  // Report sending as ready so the batch-send UI is reachable; it resolves
  // against demoApi.sendEmails, which delivers nothing.
  return {
    ok: true,
    ai: live?.ai || { configured: false, model: 'sample responses' },
    mail: { mode: 'resend', from: 'demo — nothing is delivered', ready: true, throttleMs: 0 },
    tones: live?.tones || [],
  }
}

export function parseResume(input: { data?: string; mimeType?: string; fileName?: string; text?: string }) {
  return orSample(
    () => post<ParsedResume>('/api/parse-resume', input),
    () => demoApi.parseResume(),
  )
}

export interface ContextItemInput {
  kind: 'photo' | 'video' | 'audio' | 'text'
  mimeType?: string
  /** base64 — omitted for a typed note. */
  data?: string
  /** typed-note content — omitted for everything else. */
  text?: string
}

export function generateContext(input: {
  items: ContextItemInput[]
  profile?: UserProfile | null
  contact?: Partial<Contact> | null
  event?: Partial<EventRec> | null
  tone?: Tone
}) {
  return orSample(
    () => post<ContextResult>('/api/generate-context', input),
    () => demoApi.generateContext(input),
  )
}

export function generateFollowup(input: {
  profile?: UserProfile | null
  contact: Partial<Contact>
  event?: Partial<EventRec> | null
  tone?: Tone
  instruction?: string
}) {
  return orSample(
    () => post<FollowupResult>('/api/generate-followup', input),
    () => demoApi.generateFollowup(input),
  )
}

export function sendEmails(
  messages: { id: string; to: string; subject: string; body: string; replyTo?: string; attachResume?: boolean }[],
) {
  // Never falls through to the real endpoint: a demo must not put mail in a
  // stranger's inbox, even if sending happens to be configured.
  if (DEMO) return demoApi.sendEmails(messages)
  return post<{ results: SendResult[]; sent: number; failed: number }>('/api/send-email', { messages })
}
