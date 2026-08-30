import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { CopyButton, Empty, Sheet, SkeletonList } from '../components/Ui'
import { useAuth } from '../state/Auth'
import { useData, type ContactWithEvent } from '../state/Data'
import { useToast } from '../state/Toast'
import { bulkUpdateContacts } from '../lib/db'
import { health, sendEmails } from '../lib/api'
import { initials, isEmail, linkedinSearchUrl, pluralize, timeAgo } from '../lib/util'
import { displayName, hasDraft, type HealthInfo, type SendResult } from '../lib/types'

type Tab = 'email' | 'linkedin'

export function Followups() {
  const [params, setParams] = useSearchParams()
  const { events, all, loading } = useData()

  const tab = (params.get('tab') === 'linkedin' ? 'linkedin' : 'email') as Tab
  const eventFilter = params.get('event') || ''

  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params)
    next.set('tab', t)
    setParams(next, { replace: true })
  }
  const setEvent = (id: string) => {
    const next = new URLSearchParams(params)
    if (id) next.set('event', id)
    else next.delete('event')
    setParams(next, { replace: true })
  }

  const scoped = useMemo(
    () => (eventFilter ? all.filter((c) => c.eventId === eventFilter) : all),
    [all, eventFilter],
  )

  return (
    <div className="page">
      <header className="topbar">
        <h1 className="t-display">Follow-ups</h1>

        <div className="row gap2 mt4">
          <button className={`seg grow${tab === 'email' ? ' on' : ''}`} onClick={() => setTab('email')}>
            Email queue
          </button>
          <button className={`seg grow${tab === 'linkedin' ? ' on' : ''}`} onClick={() => setTab('linkedin')}>
            LinkedIn list
          </button>
        </div>
      </header>

      {events.length > 1 && (
        <div className="segbar" style={{ marginBottom: 'var(--s4)' }}>
          <button className={`seg${!eventFilter ? ' on' : ''}`} onClick={() => setEvent('')}>
            All events
          </button>
          {events.map((e) => (
            <button key={e.id} className={`seg${eventFilter === e.id ? ' on' : ''}`} onClick={() => setEvent(e.id)}>
              {e.name}
            </button>
          ))}
        </div>
      )}

      {loading ? <SkeletonList rows={4} /> : tab === 'email' ? <EmailQueue contacts={scoped} /> : <LinkedInList contacts={scoped} />}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════
   EMAIL QUEUE — select several, send in one batch
   ══════════════════════════════════════════════════════════ */

function EmailQueue({ contacts }: { contacts: ContactWithEvent[] }) {
  const { user, profile } = useAuth()
  const toast = useToast()

  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState(false)
  const [report, setReport] = useState<SendResult[] | null>(null)
  const [info, setInfo] = useState<HealthInfo | null>(null)
  const [preview, setPreview] = useState<ContactWithEvent | null>(null)

  useEffect(() => {
    void health().then(setInfo)
  }, [])

  const queue = useMemo(
    () =>
      contacts
        .filter(hasDraft)
        .sort((a, b) => {
          const rank = (c: ContactWithEvent) => (c.sentAt ? 2 : c.priority === 'High' ? 0 : 1)
          return rank(a) - rank(b) || (b.createdAt || '').localeCompare(a.createdAt || '')
        }),
    [contacts],
  )

  const sendable = queue.filter((c) => isEmail(c.email) && !c.sentAt)
  const chosen = queue.filter((c) => picked.has(c.id))
  const mailReady = info?.mail.ready

  // Drop selections that no longer exist or have already gone out.
  useEffect(() => {
    setPicked((prev) => {
      const valid = new Set(sendable.map((c) => c.id))
      const next = new Set([...prev].filter((id) => valid.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [sendable])

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function sendSelected() {
    if (!user || !chosen.length) return
    setSending(true)
    try {
      const { results } = await sendEmails(
        chosen.map((c) => ({
          id: c.id,
          to: c.email!.trim(),
          subject: c.emailSubject || `Following up from ${c.eventName}`,
          body: c.emailDraft || '',
          replyTo: profile?.email || user.email || '',
          attachResume: Boolean(c.attachResume && profile?.resumeUrl),
          resumeUrl: profile?.resumeUrl,
          resumeFileName: profile?.resumeFileName,
        })),
      )
      setReport(results)

      // Stamp only the ones that actually landed, grouped per event.
      const stamp = new Date().toISOString()
      const byEvent = new Map<string, { id: string; patch: Record<string, unknown> }[]>()
      for (const r of results) {
        if (!r.ok) continue
        const c = chosen.find((x) => x.id === r.id)
        if (!c) continue
        const arr = byEvent.get(c.eventId) || []
        arr.push({ id: c.id, patch: { status: 'Waiting for response', sentAt: stamp } })
        byEvent.set(c.eventId, arr)
      }
      for (const [eventId, updates] of byEvent) {
        await bulkUpdateContacts(user.uid, eventId, updates)
      }
      setPicked(new Set())
    } catch (e) {
      toast.err(e)
    } finally {
      setSending(false)
    }
  }

  if (!queue.length) {
    return (
      <Empty
        icon="mail"
        title="No drafts yet"
        body="Capture someone and the draft lands here."
        action={
          <Link className="btn btn-ghost" to="/">
            Your events
          </Link>
        }
      />
    )
  }

  return (
    <>
      {info && !mailReady && (
        <div className="card row-t gap3" style={{ marginBottom: 'var(--s4)', borderColor: 'var(--mauve-line)', background: 'var(--mauve-dim)' }}>
          <span className="mauve" style={{ paddingTop: 2 }}><Icon name="alert" size={15} /></span>
          <div className="grow">
            <div className="t-section mauve">Sending not set up</div>
            <p className="t-sm muted mt2">
              Add <span className="mauve">RESEND_API_KEY</span> and <span className="mauve">MAIL_FROM</span> to <span className="mauve">.env</span>, then restart.
            </p>
          </div>
        </div>
      )}

      {sendable.length > 0 && mailReady && (
        <div className="between card" style={{ marginBottom: 'var(--s4)', padding: 'var(--s3) var(--s4)' }}>
          <button
            className="row gap3 grow"
            onClick={() => setPicked(picked.size === sendable.length ? new Set() : new Set(sendable.map((c) => c.id)))}
          >
            <span className={`checkbox${picked.size === sendable.length && picked.size > 0 ? ' on' : ''}`}>
              <Icon name="check" size={12} strokeWidth={2.8} />
            </span>
            <span className="t-sm muted">
              {picked.size ? `${picked.size} selected` : `Select all ${sendable.length}`}
            </span>
          </button>
          <button className="btn btn-go btn-sm" disabled={!chosen.length || sending} onClick={sendSelected}>
            {sending ? <span className="spin spin-dark" /> : <Icon name="send" size={13} />}
            Send {chosen.length || ''}
          </button>
        </div>
      )}

      <div className="col gap3">
        {queue.map((c) => {
          const on = picked.has(c.id)
          const canPick = isEmail(c.email) && !c.sentAt && mailReady
          return (
            <div key={`${c.eventId}-${c.id}`} className="card" style={{ borderColor: on ? 'var(--celadon-line)' : undefined }}>
              <div className="row-t gap3">
                {canPick ? (
                  <button onClick={() => toggle(c.id)} aria-label={`Select ${displayName(c)}`} style={{ paddingTop: 2 }}>
                    <span className={`checkbox${on ? ' on' : ''}`}>
                      <Icon name="check" size={12} strokeWidth={2.8} />
                    </span>
                  </button>
                ) : (
                  <span
                    className="t-num"
                    style={{
                      width: 21,
                      height: 21,
                      borderRadius: 6,
                      background: 'var(--surface-2)',
                      border: '1px solid var(--line)',
                      color: 'var(--ink-4)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 9,
                      flex: 'none',
                      marginTop: 2,
                    }}
                  >
                    {initials(displayName(c))}
                  </span>
                )}

                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="between gap2">
                    <Link to={`/e/${c.eventId}/c/${c.id}`} className="t-section clamp-1" style={{ color: 'var(--ink)' }}>
                      {displayName(c)}
                    </Link>
                    {c.priority === 'High' && <span className="chip chip-mauve" style={{ flex: 'none' }}>High</span>}
                  </div>

                  <div className="t-sm faint clamp-1" style={{ marginTop: 1 }}>
                    {c.email || 'No email address'}
                    {c.company && ` · ${c.company}`}
                  </div>

                  <button className="t-sm mt3 clamp-2" style={{ textAlign: 'left', color: 'var(--ink-2)' }} onClick={() => setPreview(c)}>
                    <span className="mauve">{c.emailSubject || 'No subject'}</span> — {c.emailDraft?.replace(/\s+/g, ' ').slice(0, 130)}
                  </button>

                  <div className="row gap2 wrap mt3">
                    <span className="chip">{c.eventName}</span>
                    {c.emailTone && <span className="chip">{c.emailTone}</span>}
                    {c.sentAt && <span className="chip chip-celadon">Sent {timeAgo(c.sentAt)}</span>}
                    {!isEmail(c.email) && <span className="chip chip-warn">Needs an address</span>}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <Sheet
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview ? displayName(preview) : ''}
        subtitle={preview?.email || 'No email address'}
      >
        {preview && (
          <>
            <div className="panel-ai">
              <div className="t-label">Subject</div>
              <p className="t-body mt2">{preview.emailSubject || '—'}</p>
              <hr className="hr" style={{ background: 'var(--mauve-line)', opacity: 0.4 }} />
              <p className="t-body pre-wrap">{preview.emailDraft}</p>
            </div>
            <div className="row gap2 mt5">
              <CopyButton
                className="btn btn-ghost grow"
                text={`${preview.emailSubject ? `${preview.emailSubject}\n\n` : ''}${preview.emailDraft || ''}`}
              />
              <Link className="btn btn-primary grow" to={`/e/${preview.eventId}/c/${preview.id}`} onClick={() => setPreview(null)}>
                <Icon name="pencil" size={14} />
                Open
              </Link>
            </div>
          </>
        )}
      </Sheet>

      <Sheet
        open={Boolean(report)}
        onClose={() => setReport(null)}
        title={report ? `${report.filter((r) => r.ok).length} of ${report.length} sent` : ''}
        subtitle={report?.some((r) => !r.ok) ? undefined : 'All went out.'}
      >
        <div className="col gap2">
          {report?.map((r) => (
            <div key={r.id} className="row-t gap3 card" style={{ padding: 'var(--s3) var(--s4)' }}>
              <span style={{ color: r.ok ? 'var(--celadon)' : 'var(--danger)', paddingTop: 2 }}>
                <Icon name={r.ok ? 'check' : 'alert'} size={14} />
              </span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="t-sm break">{r.to || 'No address'}</div>
                {!r.ok && <div className="t-sm faint mt2">{r.error}</div>}
              </div>
            </div>
          ))}
        </div>
        <button className="btn btn-ghost btn-full mt5" onClick={() => setReport(null)}>
          Done
        </button>
      </Sheet>
    </>
  )
}

/* ══════════════════════════════════════════════════════════
   LINKEDIN LIST — a manual worklist, never an automated send
   ══════════════════════════════════════════════════════════ */

function LinkedInList({ contacts }: { contacts: ContactWithEvent[] }) {
  const { user } = useAuth()
  const toast = useToast()
  const [hideDone, setHideDone] = useState(true)

  const list = useMemo(
    () =>
      contacts
        .filter((c) => c.linkedinNote?.trim())
        .filter((c) => !hideDone || !c.linkedinAdded)
        .sort((a, b) => {
          const rank = (c: ContactWithEvent) => (c.linkedinAdded ? 2 : c.priority === 'High' ? 0 : 1)
          return rank(a) - rank(b) || (b.createdAt || '').localeCompare(a.createdAt || '')
        }),
    [contacts, hideDone],
  )

  const done = contacts.filter((c) => c.linkedinNote?.trim() && c.linkedinAdded).length
  const total = contacts.filter((c) => c.linkedinNote?.trim()).length

  async function mark(c: ContactWithEvent, added: boolean) {
    if (!user) return
    try {
      await bulkUpdateContacts(user.uid, c.eventId, [{ id: c.id, patch: { linkedinAdded: added } }])
    } catch (e) {
      toast.err(e)
    }
  }

  if (!total) {
    return (
      <Empty
        icon="link"
        title="No connection notes yet"
        body="Captured conversations come with a note to paste in."
      />
    )
  }

  return (
    <>
      <div className="between card" style={{ marginBottom: 'var(--s4)', padding: 'var(--s3) var(--s4)' }}>
        <div className="grow">
          <div className="t-sm muted">
            {done} of {pluralize(total, 'note')} added
          </div>
          <div style={{ height: 3, borderRadius: 99, background: 'var(--line)', marginTop: 6, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${total ? (done / total) * 100 : 0}%`,
                background: 'var(--celadon-ink)',
                transition: 'width .3s var(--ease)',
              }}
            />
          </div>
        </div>
        <button className="btn btn-bare btn-sm" onClick={() => setHideDone(!hideDone)}>
          {hideDone ? 'Show added' : 'Hide added'}
        </button>
      </div>

      {list.length === 0 ? (
        <Empty icon="check" title="All caught up" body="Every note has been added." />
      ) : (
        <div className="col gap3">
          {list.map((c) => (
            <div key={`${c.eventId}-${c.id}`} className="card" style={{ opacity: c.linkedinAdded ? 0.55 : 1 }}>
              <div className="between gap2">
                <Link to={`/e/${c.eventId}/c/${c.id}`} className="t-section clamp-1 grow" style={{ color: 'var(--ink)' }}>
                  {displayName(c)}
                </Link>
                <span className="t-sm faint" style={{ flex: 'none' }}>
                  {c.linkedinNote!.length}/300
                </span>
              </div>

              {(c.title || c.company) && (
                <div className="t-sm faint clamp-1" style={{ marginTop: 1 }}>
                  {[c.title, c.company].filter(Boolean).join(' · ')}
                </div>
              )}

              <p className="t-sm mt3" style={{ color: 'var(--ink-2)', fontStyle: 'italic' }}>
                “{c.linkedinNote}”
              </p>

              <div className="row gap2 mt4">
                <CopyButton className="btn btn-primary btn-sm grow" text={c.linkedinNote!} label="Copy note" />
                <a className="btn btn-ghost btn-sm grow" href={linkedinSearchUrl(c)} target="_blank" rel="noreferrer">
                  <Icon name="external" size={13} />
                  {c.linkedin ? 'Profile' : 'Find them'}
                </a>
                <button
                  className="btn-icon"
                  onClick={() => mark(c, !c.linkedinAdded)}
                  aria-label={c.linkedinAdded ? 'Mark as not added' : 'Mark as added'}
                  style={{
                    background: c.linkedinAdded ? 'var(--celadon)' : undefined,
                    color: c.linkedinAdded ? 'var(--black)' : undefined,
                    borderColor: c.linkedinAdded ? 'var(--celadon)' : undefined,
                  }}
                >
                  <Icon name="check" size={15} strokeWidth={2.4} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
