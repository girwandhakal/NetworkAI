import { S } from './schema.js'

export const TONES = {
  Formal: 'Polished and businesslike. Full sentences, no contractions, no slang, no exclamation marks.',
  'Business casual': 'Professional but relaxed. Contractions are fine, still polished — the way you would write to a recruiter you got along with.',
}

const DEFAULT_TONE = 'Business casual'

export const TONE_KEYS = Object.keys(TONES)

/* ── shared context blocks ───────────────────────────────── */

export function profileBlock(input) {
  // Callers legitimately send null (no profile saved yet); a default parameter
  // only covers undefined, so normalize here.
  const profile = input || {}
  const rows = [
    ['Name', profile.name],
    ['School', profile.school],
    ['Major', profile.major],
    ['Graduation year', profile.gradYear],
    ['Target roles', profile.targetRoles],
    ['Key experiences & projects', profile.experiences],
    ['Email style preference', profile.emailPreference],
  ].filter(([, v]) => v && String(v).trim())

  const lines = rows.map(([k, v]) => `${k}: ${v}`)
  const resume = (profile.resumeText || '').trim()
  if (resume) lines.push(`\nFULL RESUME TRANSCRIPT:\n"""\n${resume.slice(0, 12000)}\n"""`)
  if (!lines.length) {
    return 'THE USER HAS NOT FILLED IN THEIR PROFILE YET. Keep personal claims generic and never invent credentials.'
  }
  return `ABOUT THE USER (the person sending the follow-up):\n${lines.join('\n')}`
}

export function contactBlock(contactInput, eventInput) {
  const contact = contactInput || {}
  const event = eventInput || {}
  const rows = [
    ['Name', contact.name],
    ['Company', contact.company],
    ['Title', contact.title],
    ['Email', contact.email],
    ['LinkedIn', contact.linkedin],
  ].filter(([, v]) => v && String(v).trim())
  const ev = [event.name, event.date, event.location].filter(Boolean).join(' · ')
  return [
    ev ? `EVENT WHERE THEY MET: ${ev}` : '',
    rows.length
      ? `THE CONTACT:\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}`
      : 'THE CONTACT: nothing recorded yet — derive what you can from the notes below.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

const ANTI_HALLUCINATION = `

HARD RULES — these override everything else:
- Never invent a fact. If a detail was not in the source material, leave the field empty rather than guessing.
- Never fabricate a shared moment, a compliment they paid you, or a project they mentioned.
- Never invent the user's skills, GPA, job titles, or experience. Only use what the profile and resume state.
- Do not use placeholder text such as [Your Name], [Company], or TODO. If you truly do not know something, write around it.`

/* ── 1. resume parsing ───────────────────────────────────── */

export const resumeSchema = S.obj({
  name: S.str('Full name of the resume owner, or empty string.'),
  school: S.str('University or college name, or empty string.'),
  major: S.str('Degree and major, e.g. "B.S. Computer Science". Empty string if absent.'),
  gradYear: S.str('Graduation year as a 4-digit string, or empty string.'),
  targetRoles: S.str('One short line naming the roles this person is clearly aiming for, inferred from the resume.'),
  experiences: S.str(
    'Three to six short lines separated by newlines, covering the strongest and most specific projects, internships and skills — the kind of detail a follow-up email could name.',
  ),
  resumeText: S.str('The complete resume transcribed to clean plain text, preserving section order and bullets.'),
})

export const resumeSystem = `You transcribe and structure resumes for a career-fair networking assistant.
Transcribe the document faithfully into plain text, then pull out the structured fields.
Keep the transcript complete — it will later be used to write personalized emails, so specifics (project names, technologies, metrics, company names) matter far more than prose.${ANTI_HALLUCINATION}`

/* ── 2. context regeneration — the whole standing record ─── */

const summaryObj = S.obj({
  topic: S.str('One short line: what the conversation / material was actually about.'),
  details: S.str('The concrete specifics worth remembering — projects, teams, tech, advice, hiring timelines. One to three sentences.'),
  connection: S.str('The personal hook: a hobby, a shared school, a mutual interest, something they said about themselves. Empty string if none was mentioned.'),
  action: S.str('The next step that was agreed or implied, e.g. "Apply to the SWE intern req by Oct 15 and email her the link." Empty string if none.'),
})

export const contextSchema = S.obj({
  docType: S.enum(
    ['Business card', 'Pamphlet', 'Booth sheet', 'Banner', 'Badge', 'Screenshot', 'Handwritten note', 'Conversation', 'Other'],
    'What kind of material this mostly is. "Conversation" if the context is chiefly a voice note or typed note rather than a photographed item.',
  ),
  name: S.str("Person's full name, or empty string if nothing in the context names an individual."),
  company: S.str('Company or organization name, or empty string.'),
  title: S.str('Job title of the named person, or empty string.'),
  email: S.str('Email address, or empty string. Never guess an address from a name and a domain.'),
  phone: S.str('Phone number, or empty string.'),
  website: S.str('Website URL, or empty string.'),
  linkedin: S.str('LinkedIn profile or company URL, or empty string.'),
  notes: S.str(
    'One coherent write-up of everything worth keeping across ALL the context, in plain sentences — roles they are hiring for, programs, deadlines, taglines, handwritten scribbles, whatever was said. Not a list of separate captures; merge overlapping information instead of repeating it. Empty string if nothing.',
  ),
  summary: summaryObj,
  emailSubject: S.str('Subject line. Specific, under 60 characters, no colon-heavy jargon.'),
  emailDraft: S.str('The complete follow-up email body, greeting through sign-off. Plain text with blank lines between paragraphs.'),
  linkedinNote: S.str('LinkedIn connection note. HARD LIMIT 280 characters. First person, no greeting line, no sign-off.'),
  priority: S.enum(
    ['High', 'Medium', 'Low'],
    'How valuable this contact looks for a job seeker, judged from everything captured so far.',
  ),
  confidence: S.num('0 to 1. How legible/clear the material was overall and how sure you are of the extracted fields. Below 0.6 means the user should check it.'),
  unclear: S.arr(S.str('field name'), 'Names of fields you had to guess at or could not read/hear cleanly.'),
})

export function contextSystem({ profile, contact, event, tone }) {
  const toneKey = TONES[tone] ? tone : DEFAULT_TONE
  return `You are the memory engine of Network.Ai, used at career fairs. The user builds up a standing record for each contact over time — a photo of a business card, a pamphlet, a badge; a voice note dictated right after the conversation; a typed note added later. You receive EVERY piece of that captured so far, together, in the order it was added. Read all of it as one record, not as separate captures, and produce one coherent memory plus ready-to-send follow-ups.

Do four things:
1. READ everything given — transcribe/OCR photos, transcribe audio faithfully (career fairs are loud; reflect any difficulty in "confidence"), and take typed notes as-is.
2. EXTRACT the structured contact fields. If the same fact appears in two items, use the clearer source; if items conflict, prefer the most specific or most recent one.
3. WRITE one coherent "notes" write-up and the summary fields — merge overlapping information across items instead of repeating it, the way a person's own notes on someone would read after several encounters, not a log of separate uploads.
4. WRITE the follow-up email and the LinkedIn note, reflecting everything captured so far — not just the newest item.

THE EMAIL — this is the part that decides whether the user gets a reply:
- Open by naming the specific thing that was discussed or shown, not "It was great meeting you at the career fair."
- Reference at least one concrete detail from the user's own resume or experiences that genuinely connects to what the contact talked about. Name the project or the skill explicitly.
- Close with the agreed action if there was one, otherwise one clear, low-friction ask.
- No attachment language, no "Please find attached". Never mention that AI wrote it.
- Sign off with the user's real name from their profile.
- TONE: ${toneKey} — ${TONES[toneKey]}

THE LINKEDIN NOTE:
- Under 280 characters, hard limit. It is pasted into the LinkedIn connection-note box by hand.
- One specific reference to the conversation or material. Never "I would like to add you to my professional network."

${profileBlock(profile)}

${contactBlock(contact, event)}${ANTI_HALLUCINATION}`
}

/* ── 4. regenerate follow-ups (tone switch) ──────────────── */

export const followupSchema = S.obj({
  emailSubject: S.str('Subject line, specific, under 60 characters.'),
  emailDraft: S.str('Complete email body, greeting through sign-off, plain text.'),
  linkedinNote: S.str('LinkedIn connection note, HARD LIMIT 280 characters.'),
})

export function followupSystem({ profile, contact, event, tone, instruction }) {
  const toneKey = TONES[tone] ? tone : DEFAULT_TONE
  return `You write follow-up messages for Network.Ai after a career-fair conversation.

Rewrite the follow-up email and the LinkedIn note from the saved memory of the conversation below.

- Open on the specific thing discussed, never a generic "great meeting you".
- Work in at least one concrete detail from the user's resume that connects to the conversation.
- Close on the agreed next step, or one clear low-friction ask.
- Sign off with the user's real name.
- LinkedIn note: under 280 characters, no greeting, no sign-off.
- TONE: ${toneKey} — ${TONES[toneKey]}${instruction ? `\n\nEXTRA INSTRUCTION FROM THE USER — follow this closely: ${instruction}` : ''}

${profileBlock(profile)}

${contactBlock(contact, event)}${ANTI_HALLUCINATION}`
}

export function memoryBlock(contactInput) {
  const contact = contactInput || {}
  const s = contact.summary || {}
  const rows = [
    ['What we talked about', s.topic],
    ['Specifics', s.details],
    ['Personal connection', s.connection],
    ['Agreed next step', s.action],
    ['Raw notes / transcript', contact.notes],
  ].filter(([, v]) => v && String(v).trim())
  if (!rows.length) {
    return 'MEMORY OF THE CONVERSATION: nothing was recorded beyond the contact details above. Keep the email short and honest — do not invent a conversation that you have no record of.'
  }
  return `MEMORY OF THE CONVERSATION:\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}`
}
