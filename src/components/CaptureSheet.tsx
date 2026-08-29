import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from './Icon'
import { Sheet } from './Ui'
import { useAuth } from '../state/Auth'
import { useToast } from '../state/Toast'
import { createContact, createEvent } from '../lib/db'
import { addContextItem, type AddContextInput } from '../lib/context'
import { canRecord, compressImage, MAX_VIDEO_BYTES, startRecording, type Recorder } from '../lib/media'
import { clock, todayISO } from '../lib/util'
import { CONTEXT_KIND, DEFAULT_TONE, type ContextItem, type EventRec, type Tone } from '../lib/types'

type Mode = 'pick' | 'voice' | 'type' | 'session'

const MAX_SECONDS = 120

/** One capture folded into the session's contact, for display only — the
 *  persisted record lives in the contact's `context` array. A photo
 *  previews itself; the rest just show their kind. */
export interface CaptureItem {
  kind: ContextItem['kind']
  preview?: string
}

/** The one contact this sheet session is building up — any mix of photos,
 *  videos, voice notes, and typed notes can pile onto it before "Done",
 *  each one triggering a fresh regeneration from the whole context. */
interface Session {
  eventId: string
  contactId: string
  eventName: string
  eventDate: string
  eventLocation?: string
  items: CaptureItem[]
}

export function CaptureSheet({
  open,
  onClose,
  events,
  eventId,
}: {
  open: boolean
  onClose(): void
  events: EventRec[]
  /** When launched from inside an event, capture goes straight there. */
  eventId?: string
}) {
  const { user, profile } = useAuth()
  const toast = useToast()
  const nav = useNavigate()

  const [mode, setMode] = useState<Mode>('pick')
  const [target, setTarget] = useState<string>('')
  const [busy, setBusy] = useState('')
  const [session, setSession] = useState<Session | null>(null)
  // ensureSession() needs the just-created session before the next render
  // commits it to state, so it also parks it here.
  const sessionRef = useRef<Session | null>(null)

  // voice
  const recRef = useRef<Recorder | null>(null)
  const startedRef = useRef(0)
  // The timer effect closes over the first finishVoice; keep a live pointer so
  // the auto-stop at MAX_SECONDS runs the current one, not a stale copy.
  const finishRef = useRef<() => Promise<void>>(async () => {})
  const [recording, setRecording] = useState(false)
  const [secs, setSecs] = useState(0)
  const [bars, setBars] = useState<number[]>(Array(11).fill(0.08))

  // photo / video — the inputs stay mounted for the whole sheet so both the
  // initial tiles and the session hub's buttons can open them.
  const fileRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)

  // typed note
  const [text, setText] = useState('')

  const tone: Tone = profile?.defaultTone || DEFAULT_TONE
  const chosen = target || eventId || events[0]?.id || ''
  const chosenEvent = events.find((e) => e.id === chosen) || null

  /* reset whenever the sheet opens */
  useEffect(() => {
    if (open) {
      setMode('pick')
      setTarget(eventId || '')
      setText('')
      setSecs(0)
      setBusy('')
      setSession(null)
      sessionRef.current = null
    }
  }, [open, eventId])

  /* recording timer + live level meter */
  useEffect(() => {
    if (!recording) return
    const id = window.setInterval(() => {
      const elapsed = (Date.now() - startedRef.current) / 1000
      setSecs(elapsed)
      const lvl = recRef.current?.level() ?? 0
      setBars((prev) => [...prev.slice(1), Math.max(0.08, lvl)])
      if (elapsed >= MAX_SECONDS) void finishRef.current()
    }, 90)
    return () => window.clearInterval(id)
  }, [recording])

  /* stop the mic if the sheet is dismissed mid-recording */
  useEffect(() => {
    if (!open && recRef.current) {
      recRef.current.cancel()
      recRef.current = null
      setRecording(false)
    }
  }, [open])

  /** First capture in this sheet creates the contact; every later one reuses it. */
  async function ensureSession(): Promise<Session> {
    if (sessionRef.current) return sessionRef.current
    if (!user) throw new Error('Not signed in.')

    let evId = chosen
    let evRec = chosenEvent
    if (!evId) {
      // No events yet — spin one up so capture is never blocked at a booth.
      evId = await createEvent(user.uid, { name: 'My first event', date: todayISO() })
      evRec = { id: evId, name: 'My first event', date: todayISO(), contactCount: 0 }
    }

    const contactId = await createContact(user.uid, evId, {
      name: '',
      company: '',
      priority: 'Medium',
      status: 'Needs follow-up',
      aiPending: true,
    })

    const next: Session = {
      eventId: evId,
      contactId,
      eventName: evRec?.name || '',
      eventDate: evRec?.date || todayISO(),
      eventLocation: evRec?.location,
      items: [],
    }
    sessionRef.current = next
    setSession(next)
    return next
  }

  function eventContext(s: Session) {
    return { name: s.eventName, date: s.eventDate, location: s.eventLocation }
  }

  /** Fold newly-captured items into the running session and land back on its hub. */
  function addToSession(base: Session, items: CaptureItem[]) {
    const next = { ...base, items: [...base.items, ...items] }
    sessionRef.current = next
    setSession(next)
    setMode('session')
  }

  /** Upload/append one item into the contact's standing context, queue a
   *  regeneration pass, and reflect it in the session hub. Every add goes
   *  through here — a photo, a video, a voice note, or a typed note. */
  async function addContext(
    s: Session,
    input: AddContextInput,
    preview?: string,
  ): Promise<void> {
    if (!user) throw new Error('Not signed in.')
    await addContextItem(user.uid, s.eventId, s.contactId, input, tone, profile || null, eventContext(s))
    addToSession(s, [{ kind: input.kind, preview }])
  }

  function afterSave(where: { eventId: string; contactId: string }) {
    onClose()
    toast.ok(navigator.onLine ? 'Saved.' : 'Saved offline.')
    nav(`/e/${where.eventId}/c/${where.contactId}`)
  }

  /* ── voice ─────────────────────────────────────────────── */

  async function beginVoice() {
    try {
      setBusy('mic')
      recRef.current = await startRecording()
      startedRef.current = Date.now()
      setSecs(0)
      setBars(Array(11).fill(0.08))
      setRecording(true)
    } catch (e) {
      toast.err(e)
    } finally {
      setBusy('')
    }
  }

  async function finishVoice() {
    const rec = recRef.current
    if (!rec) return
    recRef.current = null
    setRecording(false)
    try {
      setBusy('save')
      const elapsed = (Date.now() - startedRef.current) / 1000
      const wav = await rec.stop()
      if (elapsed < 1.2) {
        toast.err('Too short.')
        return
      }
      if (!user) throw new Error('Not signed in.')
      const s = await ensureSession()
      await addContext(s, { kind: 'audio', blob: wav, mimeType: 'audio/wav' })
    } catch (e) {
      toast.err(e)
    } finally {
      setBusy('')
    }
  }

  finishRef.current = finishVoice

  function discardVoice() {
    recRef.current?.cancel()
    recRef.current = null
    setRecording(false)
    setSecs(0)
    setMode(session ? 'session' : 'pick')
  }

  /* ── photo — one tap can add several at once ─────────────── */

  async function onFiles(list: FileList | null) {
    const files = Array.from(list || []).filter((f) => f.type.startsWith('image/'))
    if (!files.length) {
      if (list && list.length) toast.err('No images in that selection.')
      return
    }
    setBusy('img')
    try {
      if (!user) throw new Error('Not signed in.')
      const s = await ensureSession()
      for (const file of files) {
        const { blob, mimeType, preview } = await compressImage(file)
        await addContext(sessionRef.current || s, { kind: 'photo', blob, mimeType }, preview)
      }
    } catch (e) {
      toast.err(e)
    } finally {
      setBusy('')
    }
  }

  /* ── video — a single file, no in-app recording ──────────── */

  async function onVideo(list: FileList | null) {
    // The `accept="video/*"` picker already restricts the choice; some
    // mobile camera integrations hand back a freshly-recorded file with no
    // `type` at all, so an empty type is trusted rather than rejected.
    const file = Array.from(list || []).find((f) => !f.type || f.type.startsWith('video/'))
    if (!file) {
      if (list && list.length) toast.err('That is not a video file.')
      return
    }
    if (file.size > MAX_VIDEO_BYTES) {
      toast.err(`That video is too large (max ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)}MB).`)
      return
    }
    setBusy('video')
    try {
      if (!user) throw new Error('Not signed in.')
      const s = await ensureSession()
      await addContext(s, { kind: 'video', blob: file, mimeType: file.type || 'video/mp4' })
    } catch (e) {
      toast.err(e)
    } finally {
      setBusy('')
    }
  }

  /* ── typed ─────────────────────────────────────────────── */

  async function saveTyped() {
    const t = text.trim()
    if (t.length < 10) {
      toast.err('A bit more, please.')
      return
    }
    try {
      setBusy('save')
      if (!user) throw new Error('Not signed in.')
      const s = await ensureSession()
      await addContext(s, { kind: 'text', text: t })
      setText('')
    } catch (e) {
      toast.err(e)
    } finally {
      setBusy('')
    }
  }

  /* ── render ────────────────────────────────────────────── */

  const eventPicker = events.length > 1 && !eventId && !session && (
    <div className="field mt5">
      <label>Save to</label>
      <select className="select" value={chosen} onChange={(e) => setTarget(e.target.value)}>
        {events.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
    </div>
  )

  const closeSheet = () => {
    if (recording) return discardVoice()
    // A contact already exists once a session has started — leaving should
    // land the user on it rather than silently vanishing back to the list.
    if (session) return afterSave(session)
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={closeSheet}
      title={
        mode === 'voice'
          ? 'Voice note'
          : mode === 'type'
            ? 'Type a note'
            : mode === 'session' && session
              ? session.eventName
              : 'Capture'
      }
    >
      {/* Mounted for the whole sheet so both the pick screen and the session
          hub can open them. `multiple` lets the OS gallery picker multi-select. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void onFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={videoRef}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          void onVideo(e.target.files)
          e.target.value = ''
        }}
      />

      {mode === 'pick' && (
        <>
          <div className="col gap3">
            <CaptureOption icon="mic" title="Voice note" accent="mauve" disabled={!canRecord()} onClick={() => setMode('voice')} />
            <CaptureOption icon="camera" title="Image" accent="celadon" onClick={() => fileRef.current?.click()} />
            <CaptureOption icon="video" title="Video" onClick={() => videoRef.current?.click()} />
            <CaptureOption icon="text" title="Type it" onClick={() => setMode('type')} />
          </div>
          {eventPicker}
        </>
      )}

      {mode === 'voice' && (
        <div className="center">
          <div className="meter" style={{ marginBottom: 'var(--s5)' }}>
            {bars.map((b, i) => (
              <i key={i} style={{ height: `${Math.round(4 + b * 30)}px`, opacity: recording ? 1 : 0.22 }} />
            ))}
          </div>

          <button
            className={`mic${recording ? ' rec' : ''}`}
            onClick={recording ? finishVoice : beginVoice}
            disabled={Boolean(busy)}
            aria-label={recording ? 'Stop recording' : 'Start recording'}
          >
            {busy === 'save' ? (
              <span className="spin spin-dark" style={{ width: 26, height: 26 }} />
            ) : (
              <Icon name={recording ? 'stop' : 'mic'} size={recording ? 32 : 38} strokeWidth={1.6} />
            )}
          </button>

          <div className="timer mt5">{clock(secs)}</div>
          <p className="t-sm faint" style={{ marginTop: 2 }}>
            {busy === 'save'
              ? 'Saving'
              : recording
                ? 'Tap to stop'
                : busy === 'mic'
                  ? 'Starting'
                  : 'Tap to start'}
          </p>

          {!recording && !busy && (
            <button className="btn btn-bare mt5" onClick={() => setMode(session ? 'session' : 'pick')}>
              Back
            </button>
          )}
          {recording && (
            <button className="btn btn-bare mt5" onClick={discardVoice}>
              Discard
            </button>
          )}
        </div>
      )}

      {mode === 'type' && (
        <>
          <textarea
            className="textarea"
            style={{ minHeight: 150 }}
            autoFocus
            placeholder="Met Priya Raman, ML infra lead at Vertiq. Talked about their feature store. She rows crew. Apply to the infra req and email her the link."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {eventPicker}
          <div className="row gap3 mt5">
            <button className="btn btn-ghost grow" onClick={() => setMode(session ? 'session' : 'pick')} disabled={Boolean(busy)}>
              Back
            </button>
            <button className="btn btn-primary grow" onClick={saveTyped} disabled={Boolean(busy) || text.trim().length < 10}>
              {busy === 'save' ? <span className="spin spin-dark" /> : <Icon name="spark" size={15} />}
              Save
            </button>
          </div>
        </>
      )}

      {mode === 'session' && session && (
        <div className="col gap4">
          <div className="row gap2 wrap">
            {session.items.map((item, i) => (
              <CaptureChip key={i} item={item} />
            ))}
            {(busy === 'img' || busy === 'video') && (
              <span className="capture-chip capture-chip-pending">
                <span className="spin" />
              </span>
            )}
          </div>

          <div className="col gap2">
            <div className="row gap2">
              <button className="btn btn-ghost grow" onClick={() => fileRef.current?.click()} disabled={Boolean(busy)}>
                {busy === 'img' ? <span className="spin" /> : <Icon name="camera" size={15} />}
                Photo
              </button>
              <button className="btn btn-ghost grow" onClick={() => videoRef.current?.click()} disabled={Boolean(busy)}>
                {busy === 'video' ? <span className="spin" /> : <Icon name="video" size={15} />}
                Video
              </button>
            </div>
            <div className="row gap2">
              <button
                className="btn btn-ghost grow"
                onClick={() => setMode('voice')}
                disabled={Boolean(busy) || !canRecord()}
              >
                <Icon name="mic" size={15} />
                Voice
              </button>
              <button className="btn btn-ghost grow" onClick={() => setMode('type')} disabled={Boolean(busy)}>
                <Icon name="text" size={15} />
                Text
              </button>
            </div>
          </div>

          <button className="btn btn-go btn-full" onClick={() => afterSave(session)} disabled={Boolean(busy)}>
            <Icon name="check" size={16} />
            Done
          </button>
        </div>
      )}
    </Sheet>
  )
}

/** One captured item in a session hub — a photo shows itself, everything
 *  else just shows its kind since there's nothing to preview. */
export function CaptureChip({ item }: { item: CaptureItem }) {
  if (item.kind === 'photo' && item.preview) {
    return <img src={item.preview} alt="" className="capture-chip" />
  }
  return (
    <span className={`capture-chip capture-chip-${item.kind}`}>
      <Icon name={CONTEXT_KIND[item.kind].icon} size={18} />
    </span>
  )
}

function CaptureOption({
  icon,
  title,
  accent,
  onClick,
  disabled,
}: {
  icon: 'mic' | 'camera' | 'text' | 'video'
  title: string
  accent?: 'mauve' | 'celadon'
  onClick(): void
  disabled?: boolean
}) {
  const bg =
    accent === 'mauve' ? 'var(--mauve)' : accent === 'celadon' ? 'var(--celadon)' : 'var(--surface-3)'
  const fg = accent ? 'var(--black)' : 'var(--ink-2)'
  return (
    <button className="card card-tap row gap4" onClick={onClick} disabled={disabled} style={{ opacity: disabled ? 0.5 : 1 }}>
      <span
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          background: bg,
          color: fg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 'none',
        }}
      >
        <Icon name={icon} size={19} />
      </span>
      <span className="grow t-section">{title}</span>
      <Icon name="right" size={15} className="faint" />
    </button>
  )
}
