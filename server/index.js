import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import compression from 'compression'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import { generate, isConfigured, modelName } from './openai.js'
import {
  TONE_KEYS,
  resumeSchema,
  resumeSystem,
  contextSchema,
  contextSystem,
  followupSchema,
  followupSystem,
  memoryBlock,
} from './prompts.js'
import { sendBatch, mailStatus } from './mailer.js'
import { isAdminConfigured, readBlob } from './firebaseAdmin.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const app = express()

app.use(cors())
app.use(compression())
// A contact's full context — several photos, a voice note — arrives
// base64-encoded in one JSON body.
app.use(express.json({ limit: '30mb' }))

/* ── helpers ─────────────────────────────────────────────── */

const ok = (v) => typeof v === 'string' && v.trim().length > 0

function inlineData(data, mimeType, fallback, fileName) {
  const raw = String(data || '')
  // Accept both bare base64 and full data: URLs.
  const m = raw.match(/^data:([^;]+);base64,(.*)$/)
  return {
    inlineData: {
      mimeType: m ? m[1] : mimeType || fallback,
      data: m ? m[2] : raw,
      // Word docs etc. go to OpenAI as a generic file part — it identifies
      // the format from the filename's extension, so the real name (not a
      // placeholder) needs to travel with the bytes or parsing silently
      // produces nothing useful.
      fileName: ok(fileName) ? fileName : undefined,
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
    ai: { configured: isConfigured(), model: modelName() },
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
      parts.push(inlineData(data, mimeType, 'application/pdf', fileName))
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

/* ── GET /api/blob ───────────────────────────────────────── */

// Photos, voice notes and the resume are stored in Firestore rather than
// Cloud Storage (see src/lib/storage.ts), which means there is no public
// download URL for them. This route is that URL: it reassembles a file from
// its chunk documents and serves it, so pdf.js, an <img>, and a mail
// attachment can all treat it like any other file on the web.
//
// Unauthenticated by design, exactly like a Cloud Storage download link —
// the per-file token minted at upload time is the credential, and readBlob
// refuses anything else.
app.get(
  '/api/blob',
  route(async (req, res) => {
    if (!isAdminConfigured()) {
      throw Object.assign(
        new Error('Stored files cannot be served: add FIREBASE_SERVICE_ACCOUNT_KEY to .env (see README).'),
        { status: 503 },
      )
    }
    const storagePath = String(req.query.path || '')
    const token = String(req.query.token || '')
    if (!ok(storagePath) || !ok(token)) throw bad('Missing path or token.')

    const { mime, bytes } = await readBlob(storagePath, token)
    res.type(mime)
    // Private: this is one user's own file, and the token is in the URL.
    res.set('Cache-Control', 'private, max-age=300')
    res.send(bytes)
  }),
)

/* ── POST /api/generate-context ──────────────────────────── */

// A contact's context is read as one record every time it changes: every
// photo, voice note, and typed note captured so far, in order.
app.post(
  '/api/generate-context',
  route(async (req, res) => {
    const { profile, contact, event, tone, items } = req.body || {}
    const list = Array.isArray(items) ? items : []
    if (!list.length) throw bad('Send at least one context item.')

    const parts = [
      { text: 'Everything below was captured about this contact, oldest first. Read it as one record.' },
    ]
    list.forEach((item, i) => {
      if (item?.kind === 'text') {
        if (!ok(item.text)) return
        parts.push({ text: `--- item ${i + 1}: typed note ---\n${item.text.slice(0, 20000)}` })
      } else if (ok(item?.data)) {
        parts.push({ text: `--- item ${i + 1}: ${item.kind || 'file'} ---` })
        parts.push(inlineData(item.data, item.mimeType, 'application/octet-stream'))
      }
    })
    if (parts.length < 2) throw bad('None of the context items had usable content.')

    const out = await generate({
      system: contextSystem({ profile, contact, event, tone }),
      parts,
      schema: contextSchema,
      // A little thinking budget here measurably improves the email; capture
      // stays responsive because this call runs after the record already saved.
      thinking: 512,
      temperature: 0.6,
    })

    const s = out.summary || {}
    const confidence = typeof out.confidence === 'number' ? Math.min(1, Math.max(0, out.confidence)) : 0.6
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
      confidence,
      unclear: Array.isArray(out.unclear) ? out.unclear.filter(ok) : [],
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
        resumeUrl: clean(m.resumeUrl),
        resumeFileName: clean(m.resumeFileName) || 'resume.pdf',
      })),
    )
    res.json({ results, sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length })
  }),
)

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
  console.log(`  OpenAI  ${isConfigured() ? `ready (${modelName()})` : 'NOT CONFIGURED — set OPENAI_API_KEY in .env'}`)
  console.log(`  Email   ${mail.ready ? `ready via ${mail.mode} (${mail.from})` : 'not configured — drafts still generate, sending is disabled'}`)
  if (!fs.existsSync(dist)) console.log(`  Web     run "npm run dev" for the app on http://localhost:5173\n`)
  else console.log('')
})
