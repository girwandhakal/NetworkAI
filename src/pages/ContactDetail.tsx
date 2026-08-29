import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { CaptureChip, type CaptureItem } from '../components/CaptureSheet'
import { Confirm, CopyButton, SectionLabel, Sheet, SkeletonList } from '../components/Ui'
import { InlineField } from '../components/InlineField'
import { useAuth } from '../state/Auth'
import { useData } from '../state/Data'
import { useToast } from '../state/Toast'
import { deleteContact, updateContact, watchContact } from '../lib/db'
import { generateFollowup, sendEmails } from '../lib/api'
import { addContextItem, type AddContextInput } from '../lib/context'
import { enqueue } from '../lib/queue'
import { deleteContextFile } from '../lib/storage'
import { canRecord, compressImage, startRecording, type Recorder } from '../lib/media'
import { clock, isEmail, linkedinSearchUrl, STATUS_STYLE, timeAgo } from '../lib/util'
import {
  CONTEXT_KIND,
  DEFAULT_TONE,
  displayName,
  needsCheck,
  TONE_BLURB,
  TONES,
  type Contact,
  type ContextItem,
  type Tone,
} from '../lib/types'

export function ContactDetail() {
  const { eventId = '', contactId = '' } = useParams()
  const { user, profile } = useAuth()
  const { events } = useData()
  const toast = useToast()
  const nav = useNavigate()

  const [c, setC] = useState<Contact | null | undefined>(undefined)
  const [busy, setBusy] = useState('')
  const [tools, setTools] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [redo, setRedo] = useState(false)

  const event = events.find((e) => e.id === eventId)

  useEffect(() => {
    if (!user) return
    return watchContact(user.uid, eventId, contactId, setC)
  }, [user, eventId, contactId])

  async function patch(p: Partial<Contact>) {
    if (!user) return
    setC((prev) => (prev ? { ...prev, ...p } : prev))
    try {
      await updateContact(user.uid, eventId, contactId, p)
    } catch (e) {
      toast.err(e)
    }
  }

  if (c === undefined) return <div className="page"><SkeletonList rows={4} /></div>

  if (c === null) {
    return (
      <div className="page">
        <header className="topbar">
          <button className="back" onClick={() => nav(`/e/${eventId}`)}>
            <Icon name="left" size={13} strokeWidth={2} />
            Back
          </button>
        </header>
        <div className="empty">
          <div className="t-section">This contact is gone</div>
          <p className="t-sm faint mt2">It was deleted.</p>
        </div>
      </div>
    )
  }

  const name = displayName(c)
  const tone: Tone = c.emailTone || profile?.defaultTone || DEFAULT_TONE

  /* ── regenerate ────────────────────────────────────────── */

  async function regenerate(nextTone: Tone, instruction?: string) {
    if (!c) return
    setBusy('gen')
    try {
      const r = await generateFollowup({
        profile,
        contact: c,
        event: event ? { name: event.name, date: event.date, location: event.location } : null,
        tone: nextTone,
        instruction,
      })
      await patch({
        emailSubject: r.emailSubject,
        emailDraft: r.emailDraft,
        linkedinNote: r.linkedinNote,
        emailTone: nextTone,
        status: c.status === 'Needs follow-up' ? 'Draft ready' : c.status,
      })
      toast.ok('Rewritten.')
    } catch (e) {
      toast.err(e)
    } finally {
      setBusy('')
    }
  }

  /* ── send ──────────────────────────────────────────────── */

  async function send() {
    if (!c) return
    if (!isEmail(c.email)) {
      toast.err('Needs a valid email address.')
      return
    }
    setBusy('send')
    try {
      const { results } = await sendEmails([
        {
          id: c.id,
          to: c.email!.trim(),
          subject: c.emailSubject || `Following up from ${event?.name || 'the career fair'}`,
          body: c.emailDraft || '',
          replyTo: profile?.email || user?.email || '',
          attachResume: Boolean(c.attachResume && profile?.resumeUrl),
          resumeUrl: profile?.resumeUrl,
          resumeFileName: profile?.resumeFileName,
        },
      ])
      const r = results[0]
      if (r?.ok) {
        await patch({ status: 'Waiting for response', sentAt: new Date().toISOString() })
        toast.ok(`Sent to ${c.email}.`)
      } else {
        toast.err(r?.error || 'The send failed.')
      }
    } catch (e) {
      toast.err(e)
    } finally {
      setBusy('')
    }
  }

  const draftReady = Boolean(c.emailDraft?.trim())

  return (
    <div className="page">
      <header className="topbar">
        <div className="between">
          <button className="back" onClick={() => nav(`/e/${eventId}`)}>
            <Icon name="left" size={13} strokeWidth={2} />
            {event?.name || 'Back'}
          </button>
          <button className="btn-bare t-sm faint" onClick={() => setTools(true)}>
            More
          </button>
        </div>

        <div className="mt4">
          <InlineField big value={c.name || ''} placeholder="Add their name" onSave={(v) => patch({ name: v })} />
          <div className="mt2">
            <InlineField value={c.title || ''} placeholder="Their title" onSave={(v) => patch({ title: v })} />
            <InlineField value={c.company || ''} placeholder="Their company" onSave={(v) => patch({ company: v })} />
          </div>
        </div>

        <div className="row gap2 wrap mt3">
          <span className={STATUS_STYLE[c.status] || 'chip'}>{c.status}</span>
        </div>
      </header>

      {c.aiPending && (
        <div className="panel-ai row gap3" style={{ marginBottom: 'var(--s4)' }}>
          <span className="spin" />
          <span className="t-sm grow">
            {navigator.onLine ? 'Writing it up.' : 'Queued until you reconnect.'}
          </span>
        </div>
      )}

      {c.aiError && (
        <div className="card row-t gap3" style={{ marginBottom: 'var(--s4)', borderColor: 'var(--danger-line)' }}>
          <span style={{ color: 'var(--danger)', paddingTop: 2 }}><Icon name="alert" size={16} /></span>
          <div className="grow">
            <div className="t-section" style={{ color: 'var(--danger)' }}>Extraction failed</div>
            <p className="t-sm faint mt2">{c.aiError}</p>
            <button className="btn btn-ghost btn-sm mt3" onClick={() => setRedo(true)}>
              <Icon name="refresh" size={13} />
              Capture again
            </button>
          </div>
        </div>
      )}

      {needsCheck(c) && !c.aiPending && (
        <div className="card row-t gap3" style={{ marginBottom: 'var(--s4)', borderColor: 'var(--mauve-line)', background: 'var(--mauve-dim)' }}>
          <span className="mauve" style={{ paddingTop: 2 }}><Icon name="alert" size={16} /></span>
          <div className="grow">
            <div className="t-section mauve">Worth a second look</div>
            <p className="t-sm muted mt2">
              {Math.round((c.confidence || 0) * 100)}% confident
              {c.unclear?.length ? ` · unclear: ${c.unclear.join(', ')}` : ''}
            </p>
            <div className="row gap2 mt3">
              <button className="btn btn-ghost btn-sm" onClick={() => setRedo(true)}>
                <Icon name="refresh" size={13} />
                Redo
              </button>
              <button className="btn btn-bare btn-sm" onClick={() => patch({ confidence: 1, unclear: [] })}>
                Looks right
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── contact details ── */}
      <div className="card">
        <SectionLabel>How to reach them</SectionLabel>
        <div className="col gap1">
          <InlineField icon="mail" value={c.email || ''} placeholder="Email address" href="mailto" onSave={(v) => patch({ email: v })} />
          <InlineField icon="phone" value={c.phone || ''} placeholder="Phone number" href="tel" onSave={(v) => patch({ phone: v })} />
          <InlineField icon="link" value={c.linkedin || ''} placeholder="LinkedIn URL" href="url" onSave={(v) => patch({ linkedin: v })} />
          <InlineField icon="globe" value={c.website || ''} placeholder="Website" href="url" onSave={(v) => patch({ website: v })} />
        </div>
      </div>

      {/* ── notes ── */}
      <div className="card mt4">
        <SectionLabel>Notes</SectionLabel>
        <InlineField
          multiline
          value={c.notes?.trim() ? c.notes : c.transcript || ''}
          placeholder={c.aiPending ? 'Coming up.' : 'Nothing yet.'}
          onSave={(v) => patch({ notes: v })}
        />
      </div>

      <ContextSection contact={c} eventId={eventId} onAdd={() => setRedo(true)} />

      {/* ── email draft ── */}
      <div className="mt5">
        <SectionLabel right={<span className="chip chip-mauve">{tone}</span>}>Follow-up email</SectionLabel>

        {draftReady ? (
          <div className="panel-ai">
            <InlineField
              value={c.emailSubject || ''}
              placeholder="Subject line"
              onSave={(v) => patch({ emailSubject: v })}
            />
            <hr className="hr" style={{ background: 'var(--mauve-line)', opacity: 0.4 }} />
            <InlineField
              multiline
              value={c.emailDraft || ''}
              placeholder="Draft"
              onSave={(v) => patch({ emailDraft: v })}
            />
          </div>
        ) : (
          <div className="card center" style={{ borderStyle: 'dashed', padding: 'var(--s6) var(--s5)' }}>
            <p className="t-sm faint">{c.aiPending ? 'Writing it.' : 'No draft yet.'}</p>
            {!c.aiPending && (
              <button className="btn btn-primary btn-sm mt4" disabled={Boolean(busy)} onClick={() => regenerate(tone)}>
                {busy === 'gen' ? <span className="spin spin-dark" /> : <Icon name="spark" size={14} />}
                Write it
              </button>
            )}
          </div>
        )}

        <div className="segbar mt3">
          {TONES.map((t) => (
            <button
              key={t}
              className={`seg${tone === t ? ' on' : ''}`}
              disabled={Boolean(busy)}
              title={TONE_BLURB[t]}
              onClick={() => tone !== t && regenerate(t)}
            >
              {busy === 'gen' && tone === t ? '…' : t}
            </button>
          ))}
        </div>

        {draftReady && (
          <>
            <div className="row gap2 mt4">
              <CopyButton className="btn btn-ghost btn-sm grow" text={`${c.emailSubject ? `${c.emailSubject}\n\n` : ''}${c.emailDraft || ''}`} label="Copy" />
              <button className="btn btn-ghost btn-sm grow" disabled={Boolean(busy)} onClick={() => regenerate(tone)}>
                {busy === 'gen' ? <span className="spin" /> : <Icon name="refresh" size={13} />}
                Redo
              </button>
              <a
                className="btn btn-ghost btn-sm grow"
                href={`mailto:${c.email || ''}?subject=${encodeURIComponent(c.emailSubject || '')}&body=${encodeURIComponent(c.emailDraft || '')}`}
              >
                <Icon name="external" size={13} />
                Mail app
              </a>
            </div>

            <button
              className="row gap2 mt4"
              onClick={() => patch({ attachResume: !c.attachResume })}
              style={{ width: '100%' }}
              disabled={!profile?.resumeUrl}
            >
              <span className={`checkbox${c.attachResume && profile?.resumeUrl ? ' on' : ''}`}>
                <Icon name="check" size={12} strokeWidth={2.8} />
              </span>
              <span className="t-sm muted">
                {profile?.resumeUrl ? 'Append resume to email' : 'Append resume — upload one on the Me tab first'}
              </span>
            </button>

            <button className="btn btn-go btn-full mt3" disabled={Boolean(busy) || !isEmail(c.email)} onClick={send}>
              {busy === 'send' ? <span className="spin spin-dark" /> : <Icon name="send" size={15} />}
              {c.sentAt ? 'Send again' : 'Send now'}
            </button>
            {!isEmail(c.email) && <p className="t-sm faint center mt2">Add an email address to send.</p>}
            {c.sentAt && <p className="t-sm celadon center mt2">Sent {timeAgo(c.sentAt)}.</p>}

            <Tweak busy={Boolean(busy)} onSubmit={(text) => regenerate(tone, text)} />
          </>
        )}
      </div>

      {/* ── linkedin ── */}
      <div className="mt5">
        <SectionLabel>LinkedIn note</SectionLabel>
        <div className="card">
          {c.linkedinNote ? (
            <>
              <InlineField multiline value={c.linkedinNote} placeholder="Connection note" onSave={(v) => patch({ linkedinNote: v })} />
              <div className="between mt2">
                <span className={`t-sm ${(c.linkedinNote?.length || 0) > 300 ? 'chip-warn' : 'faint'}`}>
                  {c.linkedinNote.length} / 300 characters
                </span>
              </div>
              <div className="row gap2 mt4">
                <CopyButton className="btn btn-primary btn-sm grow" text={c.linkedinNote} label="Copy note" done="Copied" />
                <a className="btn btn-ghost btn-sm grow" href={linkedinSearchUrl(c)} target="_blank" rel="noreferrer">
                  <Icon name="external" size={13} />
                  Open LinkedIn
                </a>
              </div>
              <button
                className={`btn btn-sm btn-full mt3 ${c.linkedinAdded ? 'btn-ghost' : 'btn-bare'}`}
                onClick={() => patch({ linkedinAdded: !c.linkedinAdded })}
              >
                <span className={`checkbox${c.linkedinAdded ? ' on' : ''}`} style={{ width: 16, height: 16, borderRadius: 5 }}>
                  <Icon name="check" size={10} strokeWidth={2.8} />
                </span>
                {c.linkedinAdded ? 'Added on LinkedIn' : 'Mark as added'}
              </button>
            </>
          ) : (
            <p className="t-sm faint italic">{c.aiPending ? 'Coming up.' : 'No note yet.'}</p>
          )}
        </div>
      </div>

      <Sheet open={tools} onClose={() => setTools(false)} title={name}>
        <div className="col gap3">
          <button className="btn btn-ghost btn-full" onClick={() => { setTools(false); setRedo(true) }}>
            <Icon name="refresh" size={15} />
            Capture again
          </button>
          <CopyButton className="btn btn-ghost btn-full" text={asText(c)} label="Copy everything" done="Copied" />
          <button className="btn btn-danger btn-full" onClick={() => { setTools(false); setConfirming(true) }}>
            <Icon name="trash" size={15} />
            Delete contact
          </button>
        </div>
      </Sheet>

      <Confirm
        open={confirming}
        title={`Delete ${name}?`}
        body="This cannot be undone."
        onClose={() => setConfirming(false)}
        onConfirm={async () => {
          if (!user) return
          try {
            await deleteContact(user.uid, eventId, contactId)
            setConfirming(false)
            nav(`/e/${eventId}`)
            toast.ok('Contact deleted.')
          } catch (e) {
            toast.err(e)
          }
        }}
      />

      <Recapture open={redo} onClose={() => setRedo(false)} contact={c} eventId={eventId} />
    </div>
  )
}

/* ── freeform rewrite instruction ────────────────────────── */

function Tweak({ busy, onSubmit }: { busy: boolean; onSubmit(text: string): void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')

  if (!open) {
    return (
      <button className="btn btn-bare btn-full mt3 t-sm faint" onClick={() => setOpen(true)}>
        <Icon name="pencil" size={12} />
        Tweak it
      </button>
    )
  }

  return (
    <div className="card mt3">
      <textarea
        className="textarea"
        style={{ minHeight: 62 }}
        autoFocus
        placeholder="Shorter. Mention the Kafka project."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row gap2 mt3">
        <button className="btn btn-ghost btn-sm grow" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
        <button
          className="btn btn-primary btn-sm grow"
          disabled={busy || !text.trim()}
          onClick={() => {
            onSubmit(text.trim())
            setText('')
            setOpen(false)
          }}
        >
          {busy ? <span className="spin spin-dark" /> : <Icon name="spark" size={13} />}
          Rewrite
        </button>
      </div>
    </div>
  )
}

/* ── re-run a capture against an existing contact ────────── */

function Recapture({
  open,
  onClose,
  contact,
  eventId,
}: {
  open: boolean
  onClose(): void
  contact: Contact
  eventId: string
}) {
  const { user, profile } = useAuth()
  const { events } = useData()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const recRef = useRef<Recorder | null>(null)
  const [mode, setMode] = useState<'hub' | 'text'>('hub')
  const [recording, setRecording] = useState(false)
  const [secs, setSecs] = useState(0)
  const [busy, setBusy] = useState('')
  const [items, setItems] = useState<CaptureItem[]>([])
  const [text, setText] = useState('')

  const event = events.find((e) => e.id === eventId)
  const tone = contact.emailTone || profile?.defaultTone || DEFAULT_TONE
  const evContext = event ? { name: event.name, date: event.date, location: event.location } : null

  useEffect(() => {
    if (!recording) return
    const started = Date.now()
    const id = window.setInterval(() => setSecs((Date.now() - started) / 1000), 120)
    return () => window.clearInterval(id)
  }, [recording])

  useEffect(() => {
    if (!open && recRef.current) {
      recRef.current.cancel()
      recRef.current = null
      setRecording(false)
    }
  }, [open])

  useEffect(() => {
    if (open) {
      setMode('hub')
      setItems([])
      setText('')
    }
  }, [open])

  async function add(input: AddContextInput, preview?: string) {
    if (!user) return
    await addContextItem(user.uid, eventId, contact.id, input, tone, profile || null, evContext)
    setItems((prev) => [...prev, { kind: input.kind, preview }])
  }

  async function saveText() {
    const t = text.trim()
    if (t.length < 10) {
      toast.err('A bit more, please.')
      return
    }
    setBusy('save')
    try {
      await add({ kind: 'text', text: t })
      setText('')
      setMode('hub')
    } catch (err) {
      toast.err(err)
    } finally {
      setBusy('')
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add to this contact">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={async (e) => {
          const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith('image/'))
          e.target.value = ''
          if (!files.length) return
          setBusy('img')
          try {
            for (const file of files) {
              const { blob, mimeType, preview } = await compressImage(file)
              await add({ kind: 'photo', blob, mimeType }, preview)
            }
          } catch (err) {
            toast.err(err)
          } finally {
            setBusy('')
          }
        }}
      />

      {mode === 'text' ? (
        <>
          <textarea
            className="textarea"
            style={{ minHeight: 150 }}
            autoFocus
            placeholder="Talked more about the Kafka migration — she's the one to email first."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="row gap3 mt5">
            <button className="btn btn-ghost grow" onClick={() => setMode('hub')} disabled={Boolean(busy)}>
              Back
            </button>
            <button className="btn btn-primary grow" onClick={saveText} disabled={Boolean(busy) || text.trim().length < 10}>
              {busy === 'save' ? <span className="spin spin-dark" /> : <Icon name="spark" size={15} />}
              Save
            </button>
          </div>
        </>
      ) : (
        <>
          {items.length > 0 && (
            <div className="row gap2 wrap" style={{ marginBottom: 'var(--s4)' }}>
              {items.map((item, i) => (
                <CaptureChip key={i} item={item} />
              ))}
            </div>
          )}

          <div className="row gap2">
            <button className="btn btn-ghost grow" disabled={Boolean(busy) || recording} onClick={() => fileRef.current?.click()}>
              {busy === 'img' ? <span className="spin" /> : <Icon name="camera" size={15} />}
              Photo
            </button>
            <button
              className={`btn grow ${recording ? 'btn-go' : 'btn-ghost'}`}
              disabled={Boolean(busy) || !canRecord()}
              onClick={async () => {
                if (recording) {
                  const rec = recRef.current
                  recRef.current = null
                  setRecording(false)
                  if (!rec) return
                  setBusy('audio')
                  try {
                    const wav = await rec.stop()
                    await add({ kind: 'audio', blob: wav, mimeType: 'audio/wav' })
                  } catch (err) {
                    toast.err(err)
                  } finally {
                    setBusy('')
                  }
                } else {
                  try {
                    recRef.current = await startRecording()
                    setSecs(0)
                    setRecording(true)
                  } catch (err) {
                    toast.err(err)
                  }
                }
              }}
            >
              {busy === 'audio' ? <span className="spin" /> : <Icon name={recording ? 'stop' : 'mic'} size={15} />}
              {recording ? clock(secs) : 'Voice'}
            </button>
            <button className="btn btn-ghost grow" disabled={Boolean(busy) || recording} onClick={() => setMode('text')}>
              <Icon name="text" size={15} />
              Text
            </button>
          </div>

          {items.length > 0 && (
            <button className="btn btn-primary btn-full mt4" onClick={onClose}>
              <Icon name="check" size={15} />
              Done
            </button>
          )}
        </>
      )}
    </Sheet>
  )
}

/* ── the contact's standing context — every photo, voice note, and
   typed note captured so far ─────────────────────────────────────── */

function ContextSection({
  contact,
  eventId,
  onAdd,
}: {
  contact: Contact
  eventId: string
  onAdd(): void
}) {
  const { user, profile } = useAuth()
  const { events } = useData()
  const toast = useToast()
  const [open, setOpen] = useState<ContextItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const items = contact.context || []

  if (!items.length) return null

  async function remove(item: ContextItem) {
    if (!user) return
    setDeleting(true)
    try {
      const remaining = items.filter((i) => i.id !== item.id)
      await updateContact(user.uid, eventId, contact.id, { context: remaining })
      if (item.storagePath) await deleteContextFile(item.storagePath)
      // The record was written from context including this item — with it
      // gone, regenerate so the fields/draft/notes drop it too, the same as
      // adding an item does in the other direction.
      if (remaining.length) {
        const event = events.find((e) => e.id === eventId)
        await updateContact(user.uid, eventId, contact.id, { aiPending: true, aiError: '' })
        await enqueue({
          uid: user.uid,
          eventId,
          contactId: contact.id,
          kind: 'context',
          tone: contact.emailTone || profile?.defaultTone || DEFAULT_TONE,
          profile: profile || null,
          event: event ? { name: event.name, date: event.date, location: event.location } : null,
        })
      }
      setOpen(null)
      toast.ok('Removed.')
    } catch (err) {
      toast.err(err)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="mt4">
      <SectionLabel right={<button className="btn-bare t-sm faint" onClick={onAdd}><Icon name="plus" size={12} />Add</button>}>
        Context · {items.length}
      </SectionLabel>
      <div className="row gap2 wrap">
        {items.map((item) => (
          <button key={item.id} className="card-tap" style={{ padding: 0, border: 0, background: 'none' }} onClick={() => setOpen(item)}>
            <CaptureChip item={{ kind: item.kind, preview: item.kind === 'photo' ? item.url : undefined }} />
          </button>
        ))}
      </div>

      <Sheet open={Boolean(open)} onClose={() => setOpen(null)} title={open ? CONTEXT_KIND[open.kind].label : ''}>
        {open?.kind === 'photo' && open.url && <img src={open.url} alt="" style={{ width: '100%', borderRadius: 12 }} />}
        {open?.kind === 'audio' && open.url && <audio src={open.url} controls style={{ width: '100%' }} />}
        {open?.kind === 'text' && <p className="t-sm" style={{ whiteSpace: 'pre-wrap' }}>{open.text}</p>}

        <button className="btn btn-danger btn-full mt5" disabled={deleting} onClick={() => open && remove(open)}>
          {deleting ? <span className="spin spin-dark" /> : <Icon name="trash" size={15} />}
          Remove from context
        </button>
      </Sheet>
    </div>
  )
}


/* ── plain-text export of one record ─────────────────────── */

function asText(c: Contact): string {
  const lines = [
    displayName(c),
    [c.title, c.company].filter(Boolean).join(' · '),
    '',
    c.email && `Email: ${c.email}`,
    c.phone && `Phone: ${c.phone}`,
    c.linkedin && `LinkedIn: ${c.linkedin}`,
    c.website && `Website: ${c.website}`,
    (c.notes || c.transcript) && `\nNotes:\n${c.notes || c.transcript}`,
    c.emailDraft && `\n--- Email draft ---\nSubject: ${c.emailSubject || ''}\n\n${c.emailDraft}`,
    c.linkedinNote && `\n--- LinkedIn note ---\n${c.linkedinNote}`,
  ]
  return lines.filter((l): l is string => typeof l === 'string' && l.length > 0).join('\n')
}
