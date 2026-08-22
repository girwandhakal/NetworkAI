/**
 * Demo mode — the whole app, with no Firebase project.
 *
 * Firebase is the only hard dependency for *storage*, so this swaps it for an
 * in-memory store with the same surface as db.ts, seeded with a fair's worth of
 * realistic contacts. Gemini is untouched: if the server has a key, capture and
 * regeneration hit the real API, and only fall back to canned output when it
 * does not. Nothing here ever talks to a network for storage.
 */

import { DEFAULT_TONE, type Contact, type EventRec, type SendResult, type UserProfile } from './types'

const FLAG = 'networkai-demo'
const DATA = 'networkai-demo-data'

/* ── flag ────────────────────────────────────────────────── */

export function isDemo(): boolean {
  try {
    return localStorage.getItem(FLAG) === '1'
  } catch {
    return false
  }
}

export function enableDemo(): void {
  localStorage.setItem(FLAG, '1')
  // Reload so every module picks the demo branch at import time.
  window.location.href = '/'
}

export function exitDemo(): void {
  localStorage.removeItem(FLAG)
  localStorage.removeItem(DATA)
  window.location.href = '/'
}

export function resetDemo(): void {
  localStorage.removeItem(DATA)
  window.location.reload()
}

export const DEMO_UID = 'demo-user'
export const DEMO_EMAIL = 'you@example.edu'

/* ── store ───────────────────────────────────────────────── */

interface Shape {
  profile: UserProfile
  events: EventRec[]
  contacts: Record<string, Contact[]>
}

/* Declared before the module-level seed below: `load()` runs at import time,
   and a const referenced before its initializer is a temporal-dead-zone trap. */

const SAMPLE_EXPERIENCES = `Distributed rate limiter in Go, coordinating limits across replicas through Redis
Teaching assistant for Data Structures, 120 students across two sections
React dashboard for the campus makerspace, used by roughly 400 students
Summer internship building internal tooling on a Python and Postgres stack`

const SAMPLE_RESUME = `GIRWAN DHAKAL
Tuscaloosa, AL · girwan@example.edu

EDUCATION
University of Alabama — B.S. Computer Science, expected May 2027
Coursework: Distributed Systems, Databases, Operating Systems, Algorithms

EXPERIENCE
Software Engineering Intern, Ridgeline Software — Summer 2026
Built internal tooling on Python and Postgres used by the support team daily
Cut a nightly reconciliation job from 40 minutes to under 6 by batching writes
Wrote the first integration test suite for the billing service

Teaching Assistant, Data Structures — Spring 2026
Ran weekly lab sections for 120 students across two sections
Authored autograded assignments on trees and hashing

PROJECTS
Distributed Rate Limiter (Go, Redis)
Coordinates request limits across replicas with a sliding-window counter
Handles contention correctly under concurrent load; benchmarked to 12k req/s

Makerspace Dashboard (React, TypeScript, Firebase)
Equipment reservation and training tracker used by roughly 400 students

SKILLS
Go, TypeScript, Python, SQL, React, Postgres, Redis, Docker, Git`

let state: Shape = load()

function load(): Shape {
  try {
    const raw = localStorage.getItem(DATA)
    if (raw) return JSON.parse(raw) as Shape
  } catch {
    /* corrupt or unavailable — fall through to a fresh seed */
  }
  return seed()
}

function persist() {
  try {
    localStorage.setItem(DATA, JSON.stringify(state))
  } catch {
    /* private mode / quota — the session still works in memory */
  }
}

/* ── reactivity: mirrors onSnapshot ──────────────────────── */

type Fn = () => void
const listeners = new Set<Fn>()

function emit() {
  persist()
  // Copy first: a listener may unsubscribe while we iterate.
  ;[...listeners].forEach((fn) => fn())
}

/** Registers a listener, fires it once immediately, and returns an unsubscribe. */
function watch(fn: Fn): () => void {
  listeners.add(fn)
  // Async, so callers get the same "never synchronous" contract Firestore has.
  const id = setTimeout(fn, 0)
  return () => {
    clearTimeout(id)
    listeners.delete(fn)
  }
}

const now = () => new Date().toISOString()
const id = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** Firestore ignores undefined; match that so demo and real behave alike. */
function merge<T extends object>(base: T, patch: Partial<T>): T {
  const out = { ...base } as Record<string, unknown>
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) out[k] = v
  }
  return out as T
}

/* ── db surface ──────────────────────────────────────────── */

export const demoDb = {
  async getProfile(): Promise<UserProfile | null> {
    return clone(state.profile)
  },

  watchProfile(_uid: string, cb: (p: UserProfile | null) => void) {
    return watch(() => cb(clone(state.profile)))
  },

  async saveProfile(_uid: string, patch: Partial<UserProfile>) {
    state.profile = merge(state.profile, patch)
    emit()
  },

  watchEvents(_uid: string, cb: (e: EventRec[]) => void) {
    return watch(() => cb(clone(state.events).sort((a, b) => b.date.localeCompare(a.date))))
  },

  watchEvent(_uid: string, eventId: string, cb: (e: EventRec | null) => void) {
    return watch(() => {
      const ev = state.events.find((e) => e.id === eventId)
      cb(ev ? clone(ev) : null)
    })
  },

  async createEvent(_uid: string, data: { name: string; date: string; location?: string }) {
    const eid = id()
    state.events.push({ ...data, id: eid, contactCount: 0, createdAt: now() })
    state.contacts[eid] = []
    emit()
    return eid
  },

  async updateEvent(_uid: string, eventId: string, patch: Partial<EventRec>) {
    const ev = state.events.find((e) => e.id === eventId)
    if (ev) Object.assign(ev, merge(ev, patch))
    emit()
  },

  async deleteEvent(_uid: string, eventId: string) {
    state.events = state.events.filter((e) => e.id !== eventId)
    delete state.contacts[eventId]
    emit()
  },

  async recountEvent(_uid: string, eventId: string) {
    const n = (state.contacts[eventId] || []).length
    const ev = state.events.find((e) => e.id === eventId)
    if (ev) ev.contactCount = n
    emit()
    return n
  },

  watchContacts(_uid: string, eventId: string, cb: (c: Contact[]) => void) {
    return watch(() =>
      cb(clone(state.contacts[eventId] || []).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))),
    )
  },

  watchContact(_uid: string, eventId: string, contactId: string, cb: (c: Contact | null) => void) {
    return watch(() => {
      const c = (state.contacts[eventId] || []).find((x) => x.id === contactId)
      cb(c ? clone(c) : null)
    })
  },

  async getContact(_uid: string, eventId: string, contactId: string): Promise<Contact | null> {
    const c = (state.contacts[eventId] || []).find((x) => x.id === contactId)
    return c ? clone(c) : null
  },

  async createContact(_uid: string, eventId: string, data: Partial<Contact>) {
    const cid = id()
    const contact: Contact = {
      name: '',
      company: '',
      priority: 'Medium',
      status: 'Needs follow-up',
      captureType: 'manual',
      ...data,
      id: cid,
      createdAt: data.createdAt || now(),
      updatedAt: now(),
    } as Contact
    state.contacts[eventId] = [contact, ...(state.contacts[eventId] || [])]
    const ev = state.events.find((e) => e.id === eventId)
    if (ev) ev.contactCount = (ev.contactCount || 0) + 1
    emit()
    return cid
  },

  async updateContact(_uid: string, eventId: string, contactId: string, patch: Partial<Contact>) {
    const list = state.contacts[eventId] || []
    const i = list.findIndex((c) => c.id === contactId)
    if (i >= 0) list[i] = merge(list[i], { ...patch, updatedAt: now() })
    emit()
  },

  async deleteContact(_uid: string, eventId: string, contactId: string) {
    state.contacts[eventId] = (state.contacts[eventId] || []).filter((c) => c.id !== contactId)
    const ev = state.events.find((e) => e.id === eventId)
    if (ev) ev.contactCount = Math.max(0, (ev.contactCount || 0) - 1)
    emit()
  },

  async bulkUpdateContacts(_uid: string, eventId: string, updates: { id: string; patch: Partial<Contact> }[]) {
    const list = state.contacts[eventId] || []
    for (const u of updates) {
      const i = list.findIndex((c) => c.id === u.id)
      if (i >= 0) list[i] = merge(list[i], { ...u.patch, updatedAt: now() })
    }
    emit()
  },

  async getAllContacts(_uid: string, eventId: string) {
    return clone(state.contacts[eventId] || [])
  },
}

/* ── canned AI, used only when the server has no Gemini key ─ */

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const demoApi = {
  async ocrCard() {
    await wait(900)
    return {
      docType: 'Business card',
      name: 'Alex Moreau',
      company: 'Cloudmere',
      title: 'Platform Engineering Manager',
      email: 'alex.moreau@cloudmere.io',
      phone: '(415) 555-0182',
      website: 'cloudmere.io',
      linkedin: 'linkedin.com/in/alexmoreau',
      notes: 'Hiring backend and platform interns for summer. Mentioned their req opens in early October.',
      priority: 'High' as const,
      confidence: 0.93,
      unclear: [],
    }
  },

  async summarizeNotes(input: { transcript?: string }) {
    await wait(1400)
    const transcript =
      input.transcript?.trim() ||
      'Talked to Alex Moreau at Cloudmere about their platform team. They are moving off a monolith and care a lot about deploy speed. He asked what I had built with Go. Said to apply to the platform intern req when it opens in October and email him the link.'
    return {
      transcript,
      name: 'Alex Moreau',
      company: 'Cloudmere',
      title: 'Platform Engineering Manager',
      summary: {
        topic: 'Their platform team and the migration off a monolith',
        details:
          'Deploy speed is their main pain point right now. He was specifically interested in backend work in Go and asked what I had shipped.',
        connection: 'We both worked on rate limiting problems — his at a much larger scale.',
        action: 'Apply to the platform intern req when it opens in early October, then email him the link.',
      },
      emailSubject: 'The Go rate limiter we talked about',
      emailDraft: `Hi Alex,

Thanks for the time at the fair today — the deploy-speed problem you described on the platform team stuck with me, especially the part about the monolith making every release an all-or-nothing bet.

You asked what I had built in Go. The closest thing is a distributed rate limiter I wrote for a class project that coordinates limits across replicas through Redis. Getting it correct under contention taught me more about distributed state than anything else I have worked on, and it sounds adjacent to what your team wrestles with daily.

I will keep an eye out for the platform intern req in October and send you the link once I have applied.

Thanks again,
Girwan`,
      linkedinNote:
        'Really enjoyed talking about your monolith migration and the deploy-speed work at the fair today. The Go rate limiter I mentioned is the closest thing I have built to that problem — would love to stay in touch.',
      priority: 'High' as const,
      confidence: 0.88,
    }
  },

  async generateFollowup(input: { tone?: string; contact?: { name?: string } }) {
    await wait(1200)
    const who = input.contact?.name?.split(/\s+/)[0] || 'there'
    const tone = input.tone || DEFAULT_TONE
    const bodies: Record<string, string> = {
      Formal: `Dear ${who},

Thank you for the conversation at the career fair today. I found your description of the platform team's migration away from the monolith particularly interesting.

You asked about my experience with Go. I built a distributed rate limiter that coordinates limits across replicas through Redis, which required careful handling of shared state under contention.

I intend to apply to the platform internship when the requisition opens in October and will follow up with the link at that time.

Sincerely,
Girwan`,
      'Business casual': `Hi ${who},

Thanks for the time at the fair today — the deploy-speed problem on the platform team stuck with me.

You asked what I had built in Go. The closest thing is a distributed rate limiter that coordinates limits across replicas through Redis. Getting it right under contention taught me more about distributed state than anything else I have worked on.

I will watch for the platform intern req in October and send you the link once I have applied.

Thanks again,
Girwan`,
    }
    return {
      emailSubject: tone === 'Formal' ? 'Following up — platform intern req' : 'The Go rate limiter we talked about',
      emailDraft: bodies[tone] || bodies[DEFAULT_TONE],
      linkedinNote: `Great talking about your platform migration at the fair. The Go rate limiter I mentioned is the closest thing I have built to that problem — would love to stay in touch.`,
    }
  },

  async parseResume() {
    await wait(1500)
    return {
      name: 'Girwan Dhakal',
      school: 'University of Alabama',
      major: 'B.S. Computer Science',
      gradYear: '2027',
      targetRoles: 'Backend, platform, or infrastructure software engineering internships for summer 2027',
      experiences: SAMPLE_EXPERIENCES,
      resumeText: SAMPLE_RESUME,
      resumeFileName: 'Sample resume (demo)',
    }
  },

  async sendEmails(
    messages: { id: string; to: string }[],
  ): Promise<{ results: SendResult[]; sent: number; failed: number }> {
    await wait(600 + messages.length * 300)
    const results: SendResult[] = messages.map((m) => ({
      id: m.id,
      to: m.to,
      ok: true,
      messageId: `demo-${id()}`,
    }))
    return { results, sent: results.length, failed: 0 }
  },
}

/* ── seed ────────────────────────────────────────────────── */


function seed(): Shape {
  const day = (offset: number) => {
    const d = new Date()
    d.setDate(d.getDate() - offset)
    return d.toISOString().slice(0, 10)
  }
  const stamp = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600_000).toISOString()

  const e1 = 'demo-event-fair'
  const e2 = 'demo-event-expo'

  const events: EventRec[] = [
    { id: e1, name: 'Fall 2026 Tech Career Fair', date: day(1), location: 'Coleman Coliseum', contactCount: 6, createdAt: stamp(30) },
    { id: e2, name: 'Alabama Startup Expo', date: day(23), location: 'Bryant Conference Center', contactCount: 2, createdAt: stamp(560) },
  ]

  const fair: Contact[] = [
    {
      id: 'demo-c1',
      name: 'Priya Raman',
      company: 'Vertiq',
      title: 'ML Infrastructure Lead',
      email: 'priya.raman@vertiq.com',
      linkedin: 'linkedin.com/in/priyaraman',
      priority: 'High',
      status: 'Draft ready',
      captureType: 'voice',
      confidence: 0.91,
      createdAt: stamp(26),
      transcript:
        'Just met Priya Raman, she leads ML infrastructure at Vertiq. We talked about their feature store and how they cut training time roughly in half by fixing how features were materialized. She rows crew on the weekends. She said to apply to the infra intern req by October 15th and email her the link directly.',
      summary: {
        topic: 'Their feature store and how they halved model training time',
        details:
          'The win came from changing how features were materialized rather than from bigger hardware. She cares about the data plumbing more than the models themselves.',
        connection: 'She rows crew on weekends and mentioned early practices on the river.',
        action: 'Apply to the infra intern req by October 15 and email her the link.',
      },
      emailSubject: 'The feature store materialization problem',
      emailTone: 'Business casual',
      emailDraft: `Hi Priya,

Thanks for the time at the fair yesterday — I keep thinking about what you said about halving training time by changing how features were materialized rather than by throwing hardware at it. That the win came from the data plumbing is the part that stuck.

That is close to the only thing I have built that I would call real infrastructure: a distributed rate limiter in Go that coordinates a sliding window across replicas through Redis. Getting the shared state right under contention was almost entirely a materialization problem in disguise.

I will get my application in for the infra intern req before October 15 and send you the link once it is submitted.

Thanks again,
Girwan`,
      linkedinNote:
        'Enjoyed talking about your feature store at the fair — the point about halving training time through materialization rather than hardware stuck with me. Would love to stay in touch as I apply to the infra req.',
      notes: '',
    },
    {
      id: 'demo-c2',
      name: 'Marcus Odell',
      company: 'Halcyon Robotics',
      title: 'University Recruiter',
      email: 'm.odell@halcyonrobotics.com',
      phone: '(205) 555-0143',
      priority: 'High',
      status: 'Draft ready',
      captureType: 'image',
      docType: 'Business card',
      confidence: 0.95,
      createdAt: stamp(27),
      notes: 'Hiring for embedded and backend interns. Applications open through October 31. Asked me to mention the fair in my application.',
      summary: {
        topic: 'Their intern pipeline for embedded and backend roles',
        details: 'Applications stay open through October 31. He handles the whole university funnel himself.',
        connection: '',
        action: 'Apply and mention meeting him at the Alabama fair.',
      },
      emailSubject: 'Following up from the Alabama fair',
      emailTone: 'Business casual',
      emailDraft: `Hi Marcus,

Thanks for walking me through the intern pipeline at the fair yesterday — knowing applications stay open through October 31 takes some of the pressure off.

I am aiming at the backend side. Most of what I have built lives there: a distributed rate limiter in Go, and a summer internship where I cut a nightly reconciliation job from 40 minutes to under 6 by batching writes.

I will get my application in this week and mention that we met at the Alabama fair.

Thanks again,
Girwan`,
      linkedinNote:
        'Thanks for the time at the Alabama fair — good to understand how the Halcyon intern pipeline works. Applying on the backend side this week.',
    },
    {
      id: 'demo-c3',
      name: 'Sofia Nakamura',
      company: 'Kestrel Labs',
      title: 'Founding Engineer',
      email: 'sofia@kestrellabs.dev',
      linkedin: 'linkedin.com/in/sofianakamura',
      priority: 'High',
      status: 'Draft ready',
      captureType: 'voice',
      confidence: 0.84,
      linkedinAdded: true,
      createdAt: stamp(28),
      summary: {
        topic: 'What the first two years at a six-person company actually look like',
        details:
          'She was blunt that you own things you are not ready for, and that this is the point. They hire interns rarely but do hire them.',
        connection: 'She also went to Alabama and took the same distributed systems course.',
        action: 'Send her a note if I want an intro when they open their next intern slot.',
      },
      emailSubject: 'From one Alabama distributed systems survivor',
      emailTone: 'Business casual',
      emailDraft: `Hi Sofia,

Great to meet you yesterday — finding out you took the same distributed systems course a few years ahead of me made the whole conversation better.

What you said about owning things you are not ready for stuck. The closest I have come is a Go rate limiter where I badly underestimated how hard coordinating a sliding window across replicas would be, and learned more from that than from anything that went smoothly.

If a slot opens up on your side, I would love to hear about it. No rush at all.

Thanks,
Girwan`,
      linkedinNote:
        'Great meeting a fellow Alabama CS grad at the fair — your point about owning things you are not ready for is going to stick with me. Would love to stay in touch.',
    },
    {
      id: 'demo-c4',
      name: 'Ben Ortiz',
      company: 'Talia Health',
      title: 'Engineering Manager',
      email: 'bortiz@taliahealth.com',
      priority: 'Medium',
      status: 'Waiting for response',
      captureType: 'voice',
      confidence: 0.79,
      sentAt: stamp(20),
      createdAt: stamp(29),
      summary: {
        topic: 'How they handle patient data boundaries in their services',
        details: 'Most of their engineering effort goes into audit trails and access boundaries rather than features.',
        connection: '',
        action: 'Follow up in two weeks if I do not hear back.',
      },
      emailSubject: 'Audit trails and access boundaries',
      emailTone: 'Business casual',
      emailDraft: `Hi Ben,

Thanks for the conversation at the fair. I had not thought much about how much engineering effort goes into audit trails and access boundaries before you described it, and it reframed what "backend work" means in a regulated setting.

The closest thing I have built is the billing service integration test suite at my internship last summer — the first one that team had, and a lot of it was proving that the right things were and were not reachable.

Would you be open to a short call if there is an intern slot on your team this cycle?

Thanks,
Girwan`,
      linkedinNote:
        'Thanks for explaining how Talia handles access boundaries at the fair — it genuinely reframed how I think about backend work in regulated settings.',
    },
    {
      id: 'demo-c5',
      name: '',
      company: 'Cloudmere',
      title: '',
      priority: 'Low',
      status: 'Needs follow-up',
      captureType: 'image',
      docType: 'Pamphlet',
      confidence: 0.42,
      unclear: ['name', 'email', 'title'],
      createdAt: stamp(29),
      notes:
        'Recruiting pamphlet. Platform and backend internships, summer 2027. Applications open early October. QR code pointed at cloudmere.io/university. Could not read the recruiter name at the bottom.',
    },
    {
      id: 'demo-c6',
      name: 'Dana Whitfield',
      company: 'Northgate Systems',
      title: 'Senior Software Engineer',
      email: 'dana.whitfield@northgate.io',
      priority: 'Medium',
      status: 'Replied',
      captureType: 'voice',
      confidence: 0.87,
      sentAt: stamp(24),
      createdAt: stamp(30),
      summary: {
        topic: 'Advice on what actually gets a resume past their screen',
        details:
          'She said depth on one project beats a list of six. Wants to see something you can talk about for twenty minutes.',
        connection: 'We both grew up near Huntsville.',
        action: 'Send her the rate limiter writeup.',
      },
      emailSubject: 'The writeup you asked about',
      emailTone: 'Business casual',
      emailDraft: `Hi Dana,

Thanks for the straight advice at the fair — "depth on one beats a list of six" is going to change how I write my resume.

You asked to see the rate limiter writeup. It is the project I can talk about for twenty minutes without running out: a sliding window coordinated across replicas through Redis, and a long tail of correctness bugs under contention that taught me most of what I know about shared state.

Happy to hear any reaction, and thanks again for the Huntsville detour in the conversation.

Thanks,
Girwan`,
      linkedinNote:
        'Thanks for the honest resume advice at the fair — depth on one project over a list of six. Sending along the rate limiter writeup you asked about.',
    },
  ]

  const expo: Contact[] = [
    {
      id: 'demo-c7',
      name: 'Ravi Patel',
      company: 'Orbit Freight',
      title: 'Co-founder & CTO',
      email: 'ravi@orbitfreight.com',
      linkedin: 'linkedin.com/in/ravipatelorbit',
      priority: 'Medium',
      status: 'Draft ready',
      captureType: 'voice',
      confidence: 0.9,
      createdAt: stamp(552),
      summary: {
        topic: 'Routing optimization and why they wrote their own solver',
        details: 'Off-the-shelf solvers did not handle their constraints, so they built one. Team of nine.',
        connection: 'He is also a distance runner.',
        action: 'Email him if I want to talk about a part-time role during the semester.',
      },
      emailSubject: 'The routing solver you built',
      emailTone: 'Business casual',
      emailDraft: `Hi Ravi,

I have been thinking about Orbit Freight since the expo — the decision to write your own routing solver because nothing off the shelf handled your constraints is exactly the kind of problem I want to be near.

My background is backend and infrastructure: a distributed rate limiter in Go, and a summer internship where most of my work was making slow batch jobs fast. Not solver work, but the same appetite for the messy middle.

You mentioned a part-time role during the semester might be possible. I would love to talk about it if that is still open.

Thanks,
Girwan`,
      linkedinNote:
        'Still thinking about the routing solver you described at the Startup Expo — building your own because nothing off the shelf fit your constraints is a great problem. Would love to stay in touch.',
    },
    {
      id: 'demo-c8',
      name: 'Elena Cruz',
      company: 'Brightwell Capital',
      title: 'Talent Partner',
      email: 'ecruz@brightwell.vc',
      priority: 'Low',
      status: 'No action needed',
      captureType: 'image',
      docType: 'Business card',
      confidence: 0.96,
      createdAt: stamp(556),
      notes: 'Talent partner across their portfolio companies. Said to reach out closer to graduation rather than now.',
    },
  ]

  return {
    profile: {
      name: 'Girwan Dhakal',
      school: 'University of Alabama',
      major: 'B.S. Computer Science',
      gradYear: '2027',
      targetRoles: 'Backend, platform, or infrastructure software engineering internships for summer 2027',
      experiences: SAMPLE_EXPERIENCES,
      emailPreference: 'Never say "I hope this email finds you well". Sign off with "Thanks,".',
      resumeText: SAMPLE_RESUME,
      resumeFileName: 'Sample resume (demo)',
      defaultTone: DEFAULT_TONE,
      onboarded: true,
      email: DEMO_EMAIL,
    },
    events,
    contacts: { [e1]: fair, [e2]: expo },
  }
}
