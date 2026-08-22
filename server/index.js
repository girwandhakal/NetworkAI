import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import compression from 'compression'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import { generate, isConfigured, modelName } from './gemini.js'
import {
  TONE_KEYS,
  resumeSchema,
  resumeSystem,
  ocrSchema,
  ocrSystem,
  notesSchema,
  notesSystem,
  followupSchema,
  followupSystem,
  memoryBlock,
} from './prompts.js'
import { sendBatch, mailStatus, findResumeFile } from './mailer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const app = express()

app.use(cors())
app.use(compression())
// Voice notes and photos arrive base64-encoded in the JSON body.
app.use(express.json({ limit: '30mb' }))

/* ── helpers ─────────────────────────────────────────────── */

const ok = (v) => typeof v === 'string' && v.trim().length > 0

function inlineData(data, mimeType, fallback) {
  const raw = String(data || '')
  // Accept both bare base64 and full data: URLs.
  const m = raw.match(/^data:([^;]+);base64,(.*)$/)
  return {
    inlineData: {
      mimeType: m ? m[1] : mimeType || fallback,
      data: m ? m[2] : raw,
    },
  }
}

function clean(v) {
  const s = typeof v === 'string' ? v.trim() : ''
  // The model is told to return "" for unknowns, but guard the usual stand-ins too.
  if (!s || /^(n\/?a|none|null|undefined|unknown|not (specified|provided|available))$/i.test(s)) return ''
  return s
}

function capLinkedin(note) {
  const s = clean(note)
  if (s.length <= 300) return s
  const cut = s.slice(0, 297)
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  return lastStop > 180 ? cut.slice(0, lastStop + 1) : `${cut.trimEnd()}...`
}

// Wraps an async route so a throw becomes a clean JSON error instead of a hang.
const route = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch((e) => {
    const status = e?.status || 500
    // 503 means "you have not configured a key yet" — a one-line hint beats a stack trace.
    if (status === 503) console.warn(`[${req.path}] ${e.message}`)
    else if (status >= 500) console.error(`[${req.method} ${req.path}]`, e)
    res.status(status).json({ error: e?.message || 'Something went wrong on the server.' })
  })
}

function bad(message) {
  const e = new Error(message)
  e.status = 400
  return e
}

/* ── GET /api/health ─────────────────────────────────────── */

app.get('/api/health', (_req, res) => {
  res.json({
    ok: isConfigured(),
    gemini: { configured: isConfigured(), model: modelName() },
    mail: mailStatus(),
    tones: TONE_KEYS,
  })
})

/* ── POST /api/parse-resume ──────────────────────────────── */

app.post(
  '/api/parse-resume',
  route(async (req, res) => {
    const { data, mimeType, fileName, text } = req.body || {}
    if (!ok(data) && !ok(text)) throw bad('Send either a resume file or resume text.')

    const parts = []
    if (ok(data)) {
      parts.push({ text: `Transcribe and structure this resume${ok(fileName) ? ` (file: ${fileName})` : ''}.` })
      parts.push(inlineData(data, mimeType, 'application/pdf'))
    } else {
      parts.push({ text: `Structure this resume text:\n\n"""\n${text.slice(0, 40000)}\n"""` })
    }

    const out = await generate({
      system: resumeSystem,
      parts,
      schema: resumeSchema,
      thinking: 0,
      temperature: 0.2,
    })

    res.json({
      name: clean(out.name),
      school: clean(out.school),
      major: clean(out.major),
      gradYear: clean(out.gradYear),
      targetRoles: clean(out.targetRoles),
      experiences: clean(out.experiences),
      resumeText: clean(out.resumeText) || clean(text),
      resumeFileName: clean(fileName),
    })
  }),
)

/* ── POST /api/ocr-card ──────────────────────────────────── */

app.post(
  '/api/ocr-card',
  route(async (req, res) => {
    const { image, mimeType } = req.body || {}
    if (!ok(image)) throw bad('Send an image to extract.')

    const out = await generate({
      system: ocrSystem,
      parts: [
        { text: 'Identify this item and extract everything useful from it.' },
        inlineData(image, mimeType, 'image/jpeg'),
      ],
      schema: ocrSchema,
      thinking: 0,
      temperature: 0.1,
    })

    const confidence = typeof out.confidence === 'number' ? Math.min(1, Math.max(0, out.confidence)) : 0.5
    res.json({
      docType: clean(out.docType) || 'Other',
      name: clean(out.name),
      company: clean(out.company),
      title: clean(out.title),
      email: clean(out.email),
      phone: clean(out.phone),
      website: clean(out.website),
      linkedin: clean(out.linkedin),
      notes: clean(out.notes),
      priority: ['High', 'Medium', 'Low'].includes(out.priority) ? out.priority : 'Medium',
      confidence,
      unclear: Array.isArray(out.unclear) ? out.unclear.filter(ok) : [],
    })
  }),
)

/* ── POST /api/summarize-notes ───────────────────────────── */

app.post(
  '/api/summarize-notes',
  route(async (req, res) => {
    const { transcript, audio, mimeType, profile, contact, event, tone } = req.body || {}
    if (!ok(transcript) && !ok(audio)) throw bad('Send a voice recording or a typed note.')

    const parts = []
    if (ok(audio)) {
      parts.push({ text: 'Transcribe this voice note, structure it, and write the follow-ups.' })
      parts.push(inlineData(audio, mimeType, 'audio/wav'))
    } else {
      parts.push({ text: `Structure this note and write the follow-ups.\n\nNOTE:\n"""\n${transcript.slice(0, 20000)}\n"""` })
    }

    const out = await generate({
      system: notesSystem({ profile, contact, event, tone }),
      parts,
      schema: notesSchema,
      // A little thinking budget here measurably improves the email; capture
      // stays under the 30s goal because this call runs after the record saves.
      thinking: 512,
      temperature: 0.7,
    })

    const s = out.summary || {}
    res.json({
      transcript: clean(out.transcript) || clean(transcript),
      name: clean(out.name),
      company: clean(out.company),
      title: clean(out.title),
      summary: {
        topic: clean(s.topic),
        details: clean(s.details),
        connection: clean(s.connection),
        action: clean(s.action),
      },
      emailSubject: clean(out.emailSubject),
      emailDraft: clean(out.emailDraft),
      linkedinNote: capLinkedin(out.linkedinNote),
      priority: ['High', 'Medium', 'Low'].includes(out.priority) ? out.priority : 'Medium',
      confidence: typeof out.confidence === 'number' ? Math.min(1, Math.max(0, out.confidence)) : 0.6,
    })
  }),
)

/* ── POST /api/generate-followup (tone switch / regenerate) ─ */

app.post(
  '/api/generate-followup',
  route(async (req, res) => {
    const { profile, contact, event, tone, instruction } = req.body || {}
    if (!contact) throw bad('Send the contact to write a follow-up for.')

    const out = await generate({
      system: followupSystem({ profile, contact, event, tone, instruction }),
      parts: [{ text: memoryBlock(contact) }],
      schema: followupSchema,
      thinking: 512,
      temperature: 0.75,
    })

    res.json({
      emailSubject: clean(out.emailSubject),
      emailDraft: clean(out.emailDraft),
      linkedinNote: capLinkedin(out.linkedinNote),
    })
  }),
)

/* ── POST /api/send-email (single or bulk) ───────────────── */

app.post(
  '/api/send-email',
  route(async (req, res) => {
    const { messages } = req.body || {}
    const list = Array.isArray(messages) ? messages : []
    if (!list.length) throw bad('No messages to send.')
    if (mailStatus().mode === 'none') {
      throw Object.assign(
        new Error('Email sending is not configured. Add RESEND_API_KEY (or SMTP settings) to your .env, then restart the server.'),
        { status: 503 },
      )
    }

    const results = await sendBatch(
      list.slice(0, 50).map((m) => ({
        id: String(m.id || ''),
        to: clean(m.to),
        subject: clean(m.subject) || 'Following up',
        body: clean(m.body),
        replyTo: clean(m.replyTo),
        attachResume: Boolean(m.attachResume),
      })),
    )
    res.json({ results, sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length })
  }),
)

/* ── GET /resume.pdf ─────────────────────────────────────── */

// Served straight out of docs/ so that folder stays the single source of
// truth — drop a new PDF in and it is live, no copying or rebuild.
app.get('/resume.pdf', (_req, res) => {
  const file = findResumeFile()
  if (!file) return res.status(404).json({ error: 'No PDF found in docs/.' })
  res.type('application/pdf')
  res.setHeader('Content-Disposition', 'inline; filename="resume.pdf"')
  res.sendFile(file)
})

/* ── PDF.js support assets ───────────────────────────────── */

// Character maps and the 14 standard font files, streamed straight from the
// package. Without these, a PDF that does not embed its fonts renders with
// missing glyphs. Serving them beats copying 185 files into the build.
const pdfjsDir = path.join(root, 'node_modules', 'pdfjs-dist')
app.use('/pdfjs/cmaps', express.static(path.join(pdfjsDir, 'cmaps'), { maxAge: '1y', immutable: true }))
app.use('/pdfjs/standard_fonts', express.static(path.join(pdfjsDir, 'standard_fonts'), { maxAge: '1y', immutable: true }))

/* ── static build (production) ───────────────────────────── */

const dist = path.join(root, 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next()
    res.sendFile(path.join(dist, 'index.html'))
  })
}

app.use('/api', (_req, res) => res.status(404).json({ error: 'No such endpoint.' }))

const port = Number(process.env.PORT) || 8787
app.listen(port, () => {
  const mail = mailStatus()
  console.log(`\n  Network.Ai server  ->  http://localhost:${port}`)
  console.log(`  Gemini  ${isConfigured() ? `ready (${modelName()})` : 'NOT CONFIGURED — set GEMINI_API_KEY in .env'}`)
  console.log(`  Email   ${mail.ready ? `ready via ${mail.mode} (${mail.from})` : 'not configured — drafts still generate, sending is disabled'}`)
  if (!fs.existsSync(dist)) console.log(`  Web     run "npm run dev" for the app on http://localhost:5173\n`)
  else console.log('')
})
