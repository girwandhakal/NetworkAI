import { GoogleGenAI } from '@google/genai'

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'

let client = null
function ai() {
  const key = process.env.GEMINI_API_KEY
  if (!key) {
    const err = new Error('GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.')
    err.status = 503
    throw err
  }
  if (!client) client = new GoogleGenAI({ apiKey: key })
  return client
}

export function isConfigured() {
  return Boolean(process.env.GEMINI_API_KEY)
}

export function modelName() {
  return MODEL
}

/**
 * Single entry point for every LLM call.
 * `parts` is an array of Gemini content parts (text / inlineData).
 * `schema` is a Gemini responseSchema; when present we force JSON out and parse it.
 * `thinking` is the thinking token budget — 0 keeps latency-critical capture calls fast.
 */
export async function generate({ system, parts, schema, thinking = 0, temperature = 0.6 }) {
  const config = { temperature }
  if (system) config.systemInstruction = system
  if (schema) {
    config.responseMimeType = 'application/json'
    config.responseSchema = schema
  }
  if (typeof thinking === 'number') config.thinkingConfig = { thinkingBudget: thinking }

  let res
  try {
    res = await ai().models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts }],
      config,
    })
  } catch (e) {
    const err = new Error(geminiMessage(e))
    err.status = e?.status && e.status >= 400 && e.status < 600 ? e.status : 502
    throw err
  }

  const text = (res.text || '').trim()
  if (!schema) return text
  if (!text) {
    const err = new Error('The model returned an empty response. Try again.')
    err.status = 502
    throw err
  }
  try {
    return JSON.parse(text)
  } catch {
    // Very occasionally the model fences the JSON despite the mime type.
    const fenced = text.match(/\{[\s\S]*\}/)
    if (fenced) {
      try { return JSON.parse(fenced[0]) } catch { /* fall through */ }
    }
    const err = new Error('The model returned malformed JSON. Try again.')
    err.status = 502
    throw err
  }
}

function geminiMessage(e) {
  const raw = e?.message || String(e)
  if (/API key/i.test(raw)) return 'Gemini rejected the API key. Check GEMINI_API_KEY in your .env.'
  if (/quota|rate/i.test(raw)) return 'Gemini rate limit or quota reached. Wait a moment and try again.'
  if (/not found|NOT_FOUND/i.test(raw)) return `Gemini model "${MODEL}" is unavailable. Set GEMINI_MODEL in your .env.`
  return `Gemini request failed: ${raw}`
}

export const S = {
  str: (description) => ({ type: 'STRING', description }),
  num: (description) => ({ type: 'NUMBER', description }),
  enum: (values, description) => ({ type: 'STRING', enum: values, description }),
  obj: (properties, required) => ({ type: 'OBJECT', properties, required: required || Object.keys(properties) }),
  arr: (items, description) => ({ type: 'ARRAY', items, description }),
}
