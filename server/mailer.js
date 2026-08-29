import nodemailer from 'nodemailer'

/**
 * Two supported transports, in priority order:
 *   1. Resend — a transactional API, which is what the PRD calls for on bulk sends.
 *   2. SMTP  — the user's own mailbox (Gmail needs an App Password).
 * Bulk sends are throttled and reported per-recipient so one bad address
 * never silently kills the rest of the batch.
 */

export function mailMode() {
  if (process.env.RESEND_API_KEY) return 'resend'
  if (process.env.SMTP_HOST && process.env.SMTP_USER) return 'smtp'
  return 'none'
}

export function mailFrom() {
  return process.env.MAIL_FROM || process.env.SMTP_USER || ''
}

export function mailStatus() {
  const mode = mailMode()
  return {
    mode,
    from: mailFrom(),
    ready: mode !== 'none' && Boolean(mailFrom()),
    throttleMs: throttleMs(),
  }
}

function throttleMs() {
  const n = Number(process.env.MAIL_THROTTLE_MS)
  return Number.isFinite(n) && n >= 0 ? n : 1200
}

// Only ever fetch the resume from Firebase Storage — resumeUrl is
// client-supplied, so this keeps a compromised or buggy client from turning
// this into an open fetch-anything proxy.
const RESUME_HOSTS = new Set(['firebasestorage.googleapis.com'])

/** The uploaded resume's bytes, straight from Firebase Storage — the same
 *  file the user sees in the Resume tab, fetched fresh at send time rather
 *  than cached anywhere server-side. */
async function fetchResume(resumeUrl) {
  let target
  try {
    target = new URL(resumeUrl)
  } catch {
    throw new Error('The saved resume link is invalid. Re-upload it from the Me tab.')
  }
  if (!RESUME_HOSTS.has(target.hostname)) {
    throw new Error('The saved resume link is not a Firebase Storage file.')
  }
  const res = await fetch(target.toString())
  if (!res.ok) throw new Error('Could not fetch the resume — try re-uploading it from the Me tab.')
  return Buffer.from(await res.arrayBuffer())
}

let transporter = null
function smtp() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  }
  return transporter
}

function textToHtml(text) {
  const esc = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const paras = esc
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, '<br>')}</p>`)
    .join('')
  return `<div style="font-family:Sitka Text,Sitka,Georgia,serif;font-size:15px;line-height:1.55;color:#040403">${paras}</div>`
}

async function sendOne({ to, subject, body, replyTo, attachResume, resumeUrl, resumeFileName }) {
  const from = mailFrom()
  if (!from) throw new Error('MAIL_FROM is not set.')
  const mode = mailMode()

  let resumeBytes = null
  if (attachResume) {
    if (!resumeUrl) throw new Error('Checked "append resume" but no resume is uploaded. Add one on the Me tab.')
    resumeBytes = await fetchResume(resumeUrl)
  }
  const filename = resumeFileName || 'resume.pdf'

  if (mode === 'resend') {
    const attachments = resumeBytes ? [{ filename, content: resumeBytes.toString('base64') }] : undefined
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text: body,
        html: textToHtml(body),
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(attachments ? { attachments } : {}),
      }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json?.message || `Resend returned ${res.status}`)
    return json?.id || 'sent'
  }

  if (mode === 'smtp') {
    const attachments = resumeBytes ? [{ filename, content: resumeBytes }] : undefined
    const info = await smtp().sendMail({
      from,
      to,
      subject,
      text: body,
      html: textToHtml(body),
      ...(replyTo ? { replyTo } : {}),
      ...(attachments ? { attachments } : {}),
    })
    return info.messageId
  }

  throw new Error('No email transport configured. Set RESEND_API_KEY, or SMTP_HOST + SMTP_USER + SMTP_PASS, in your .env.')
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * messages: [{ id, to, subject, body, replyTo, attachResume, resumeUrl, resumeFileName }]
 * Always resolves; per-message outcomes come back in the results array.
 */
export async function sendBatch(messages) {
  const gap = throttleMs()
  const results = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (i > 0 && gap > 0) await wait(gap)
    if (!m.to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m.to)) {
      results.push({ id: m.id, to: m.to || '', ok: false, error: 'No valid email address on this contact.' })
      continue
    }
    try {
      const messageId = await sendOne(m)
      results.push({ id: m.id, to: m.to, ok: true, messageId })
    } catch (e) {
      results.push({ id: m.id, to: m.to, ok: false, error: e?.message || 'Send failed.' })
    }
  }
  return results
}
