/* Browser-side capture helpers: microphone -> WAV, camera/file -> compressed JPEG. */

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => {
      const s = String(fr.result || '')
      resolve(s.slice(s.indexOf(',') + 1))
    }
    fr.onerror = () => reject(new Error('Could not read the file.'))
    fr.readAsDataURL(blob)
  })
}

/* ── images ──────────────────────────────────────────────── */

const MAX_EDGE = 1600

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process the image.'))), type, quality)
  })
}

/**
 * Phone photos are 4-12MP; sending them raw wastes seconds of upload on bad
 * venue Wi-Fi for no OCR benefit. Downscale to 1600px on the long edge.
 *
 * Returns a Blob directly (not base64) — callers upload it as-is, and the
 * preview is an object URL rather than a data: URL, so nothing round-trips
 * through a text encoding it doesn't need.
 */
export async function compressImage(file: Blob): Promise<{ blob: Blob; mimeType: string; preview: string }> {
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) {
    // HEIC and other formats createImageBitmap may refuse — send the original.
    const mimeType = file.type || 'image/jpeg'
    return { blob: file, mimeType, preview: URL.createObjectURL(file) }
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not process the image.')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.85)
  return { blob, mimeType: 'image/jpeg', preview: URL.createObjectURL(blob) }
}

/* ── video ───────────────────────────────────────────────── */

// Video is stored and re-sent whole (no client-side compression), so it is
// capped well under what still fits comfortably in one Gemini request
// alongside a few photos.
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024

/* ── audio ───────────────────────────────────────────────── */

const TARGET_RATE = 16000

/**
 * MediaRecorder gives us webm/opus, which Gemini's audio support does not
 * document. Decoding to 16kHz mono PCM WAV is a format it definitely accepts,
 * and at 32KB/s a 30-second note is still a small upload.
 */
export async function toWav(blob: Blob): Promise<Blob> {
  const AC: typeof AudioContext =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new AC()
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
    const mono = downmix(buf)
    const pcm = buf.sampleRate === TARGET_RATE ? mono : resample(mono, buf.sampleRate, TARGET_RATE)
    return encodeWav(pcm, TARGET_RATE)
  } finally {
    void ctx.close()
  }
}

function downmix(buf: AudioBuffer): Float32Array {
  if (buf.numberOfChannels === 1) return buf.getChannelData(0)
  const out = new Float32Array(buf.length)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c)
    for (let i = 0; i < buf.length; i++) out[i] += ch[i]
  }
  for (let i = 0; i < out.length; i++) out[i] /= buf.numberOfChannels
  return out
}

/** Linear interpolation — done by hand because OfflineAudioContext refuses
 *  16kHz on some browsers, and speech does not need a better kernel. */
function resample(input: Float32Array, from: number, to: number): Float32Array {
  const ratio = from / to
  const len = Math.floor(input.length / ratio)
  const out = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    const pos = i * ratio
    const idx = Math.floor(pos)
    const frac = pos - idx
    const a = input[idx] ?? 0
    const b = input[idx + 1] ?? a
    out[i] = a + (b - a) * frac
  }
  return out
}

function encodeWav(samples: Float32Array, rate: number): Blob {
  const bytes = samples.length * 2
  const view = new DataView(new ArrayBuffer(44 + bytes))

  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }

  str(0, 'RIFF')
  view.setUint32(4, 36 + bytes, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM header size
  view.setUint16(20, 1, true) // format: PCM
  view.setUint16(22, 1, true) // channels: mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  str(36, 'data')
  view.setUint32(40, bytes, true)

  let off = 44
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([view], { type: 'audio/wav' })
}

/* ── recorder ────────────────────────────────────────────── */

export interface Recorder {
  stop(): Promise<Blob>
  cancel(): void
  /** 0-1 input level, for the live meter. */
  level(): number
}

export async function startRecording(): Promise<Recorder> {
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
  } catch (e) {
    const name = (e as { name?: string })?.name
    if (name === 'NotAllowedError') throw new Error('Microphone access was blocked. Allow it in your browser settings and try again.')
    if (name === 'NotFoundError') throw new Error('No microphone found on this device.')
    throw new Error('Could not start the microphone.')
  }

  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(
    (m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m),
  )
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data)
  }
  rec.start(250)

  // Analyser drives the on-screen level meter so the user can see it listening.
  const AC: typeof AudioContext =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const actx = new AC()
  const analyser = actx.createAnalyser()
  analyser.fftSize = 256
  actx.createMediaStreamSource(stream).connect(analyser)
  const bins = new Uint8Array(analyser.frequencyBinCount)

  const teardown = () => {
    stream.getTracks().forEach((t) => t.stop())
    void actx.close()
  }

  return {
    level() {
      analyser.getByteFrequencyData(bins)
      let sum = 0
      for (let i = 0; i < bins.length; i++) sum += bins[i]
      return Math.min(1, sum / bins.length / 96)
    },
    stop() {
      return new Promise<Blob>((resolve, reject) => {
        rec.onstop = async () => {
          teardown()
          const raw = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
          if (!raw.size) return reject(new Error('Nothing was recorded. Check your microphone and try again.'))
          try {
            resolve(await toWav(raw))
          } catch {
            reject(new Error('Could not process the recording. Try again.'))
          }
        }
        try {
          rec.stop()
        } catch {
          teardown()
          reject(new Error('Recording failed.'))
        }
      })
    },
    cancel() {
      try {
        if (rec.state !== 'inactive') rec.stop()
      } catch {
        /* already stopped */
      }
      teardown()
    },
  }
}

export function canRecord(): boolean {
  return Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined'
}
