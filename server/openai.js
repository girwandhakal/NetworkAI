/**
 * OpenAI backend — swapped in for Gemini, which was hitting free-tier rate
 * limits too often. Talks to the Responses API directly over fetch (no SDK
 * dependency needed).
 *
 * Multimodal support differs from Gemini's, so inputs are adapted per kind:
 *  - image   -> sent natively as `input_image` (vision is native to the model)
 *  - pdf     -> sent natively as `input_file`
 *  - audio   -> transcribed first via /v1/audio/transcriptions, then folded
 *               in as plain text — the Responses API has no raw-audio input
 */

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o'
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1'

// Reasoning models (o-series, gpt-5.x) take a `reasoning.effort` instead of
// `temperature`, which they reject outright — everything else takes the
// reverse. Sniffed from the model name rather than hardcoded so switching
// OPENAI_MODEL doesn't need a matching code change.
const REASONING_MODEL = /^(o\d|gpt-5)/i.test(MODEL)

function key() {
  const k = process.env.OPENAI_API_KEY
  if (!k) {
    const err = new Error('OPENAI_API_KEY is not set. Copy .env.example to .env and add your key.')
    err.status = 503
    throw err
  }
  return k
}

export function isConfigured() {
  return Boolean(process.env.OPENAI_API_KEY)
}

export function modelName() {
  return MODEL
}

/* ── audio: transcribe first, there is no raw-audio input on this API ──── */

async function transcribeAudio(base64, mimeType) {
  const ext = /wav/i.test(mimeType) ? 'wav' : /mp3|mpeg/i.test(mimeType) ? 'mp3' : /webm/i.test(mimeType) ? 'webm' : 'wav'
  const bytes = Buffer.from(base64, 'base64')
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: mimeType || 'audio/wav' }), `audio.${ext}`)
  form.append('model', TRANSCRIBE_MODEL)

  let res
  try {
    res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key()}` },
      body: form,
    })
  } catch {
    const err = new Error('A network error reaching OpenAI for transcription.')
    err.status = 502
    throw err
  }
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(openaiMessage(json, res.status))
  return (json?.text || '').trim()
}

/* ── Gemini-shaped parts -> Responses API content ───────────────────────── */

async function toContent(parts) {
  const content = []
  for (const part of parts || []) {
    if (typeof part.text === 'string') {
      content.push({ type: 'input_text', text: part.text })
      continue
    }
    const inline = part.inlineData
    if (!inline?.data) continue
    const mime = inline.mimeType || ''
    if (mime.startsWith('image/')) {
      content.push({ type: 'input_image', image_url: `data:${mime};base64,${inline.data}` })
    } else if (mime === 'application/pdf') {
      content.push({ type: 'input_file', filename: 'document.pdf', file_data: `data:${mime};base64,${inline.data}` })
    } else if (mime.startsWith('audio/')) {
      const transcript = await transcribeAudio(inline.data, mime)
      content.push({
        type: 'input_text',
        text: transcript ? `[Transcribed audio]\n${transcript}` : '[An audio recording was captured here but nothing intelligible was transcribed.]',
      })
    } else {
      content.push({ type: 'input_file', filename: 'attachment', file_data: `data:${mime || 'application/octet-stream'};base64,${inline.data}` })
    }
  }
  return content
}

/* ── schema dialect: Gemini-shaped -> strict JSON Schema ─────────────────── */

function toJsonSchema(node) {
  switch (node?.type) {
    case 'OBJECT': {
      const properties = {}
      for (const [k, v] of Object.entries(node.properties)) properties[k] = toJsonSchema(v)
      const out = { type: 'object', properties, required: node.required || Object.keys(node.properties), additionalProperties: false }
      if (node.description) out.description = node.description
      return out
    }
    case 'ARRAY': {
      const out = { type: 'array', items: toJsonSchema(node.items) }
      if (node.description) out.description = node.description
      return out
    }
    case 'STRING': {
      const out = { type: 'string' }
      if (node.enum) out.enum = node.enum
      if (node.description) out.description = node.description
      return out
    }
    case 'NUMBER': {
      const out = { type: 'number' }
      if (node.description) out.description = node.description
      return out
    }
    default:
      return node
  }
}

function extractText(json) {
  const message = (json?.output || []).find((o) => o.type === 'message')
  const part = message?.content?.find((c) => c.type === 'output_text')
  return (part?.text || '').trim()
}

/**
 * Single entry point for every LLM call — same shape as the old gemini.js
 * one, so prompts.js and server/index.js needed no changes beyond the import.
 * `parts` is Gemini-shaped (text / inlineData); `schema` is Gemini-shaped too
 * and gets converted to strict JSON Schema for the Responses API.
 */
export async function generate({ system, parts, schema, thinking = 0, temperature = 0.6 }) {
  const content = await toContent(parts)
  const body = {
    model: MODEL,
    instructions: system,
    input: [{ role: 'user', content }],
  }
  if (REASONING_MODEL) body.reasoning = { effort: thinking >= 256 ? 'medium' : 'low' }
  else body.temperature = temperature
  if (schema) {
    body.text = { format: { type: 'json_schema', name: 'result', schema: toJsonSchema(schema), strict: true } }
  }

  let res
  try {
    res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    const err = new Error('A network error reaching OpenAI. Try again.')
    err.status = 502
    throw err
  }

  const json = await res.json().catch(() => null)
  if (!res.ok) {
    const err = new Error(openaiMessage(json, res.status))
    err.status = res.status >= 400 && res.status < 600 ? res.status : 502
    throw err
  }

  const text = extractText(json)
  if (!schema) return text
  if (!text) {
    const err = new Error('The model returned an empty response. Try again.')
    err.status = 502
    throw err
  }
  try {
    return JSON.parse(text)
  } catch {
    const fenced = text.match(/\{[\s\S]*\}/)
    if (fenced) {
      try { return JSON.parse(fenced[0]) } catch { /* fall through */ }
    }
    const err = new Error('The model returned malformed JSON. Try again.')
    err.status = 502
    throw err
  }
}

function openaiMessage(json, status) {
  const raw = json?.error?.message || `HTTP ${status}`
  if (/incorrect api key|invalid api key|unauthorized/i.test(raw)) return 'OpenAI rejected the API key. Check OPENAI_API_KEY in your .env.'
  if (/rate limit|quota|insufficient_quota/i.test(raw)) return 'OpenAI rate limit or quota reached. Wait a moment and try again.'
  if (/model.*(not found|does not exist)|unknown model/i.test(raw)) return `OpenAI model "${MODEL}" is unavailable. Set OPENAI_MODEL in your .env.`
  return `OpenAI request failed: ${raw}`
}
