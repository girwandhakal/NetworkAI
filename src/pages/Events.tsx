import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { Empty, Field, Sheet, SkeletonList } from '../components/Ui'
import { useAuth } from '../state/Auth'
import { useData } from '../state/Data'
import { useToast } from '../state/Toast'
import { createEvent } from '../lib/db'
import { formatDate, pluralize, relativeDay, todayISO } from '../lib/util'
import { hasDraft } from '../lib/types'

export function Events() {
  const { user, profile } = useAuth()
  const { events, all, byEvent, loading, error } = useData()
  const [creating, setCreating] = useState(false)

  const stats = useMemo(() => {
    const drafts = all.filter(hasDraft).length
    const todo = all.filter((c) => c.status === 'Needs follow-up').length
    return { contacts: all.length, drafts, todo }
  }, [all])

  const firstName = (profile?.name || user?.displayName || '').trim().split(/\s+/)[0]

  return (
    <div className="page">
      <header className="topbar">
        <div className="between">
          <div className="grow">
            <h1 className="t-display">{firstName ? `${firstName}.` : 'Network.Ai'}</h1>
          </div>
          <Link to="/me" className="btn-icon" aria-label="Your profile">
            <Icon name="user" size={17} />
          </Link>
        </div>
      </header>

      {all.length > 0 && (
        <div className="row gap2" style={{ marginBottom: 'var(--s5)' }}>
          <Stat n={stats.contacts} label="captured" />
          <Stat n={stats.drafts} label="drafted" tint="mauve" />
          <Stat n={stats.todo} label="to send" tint="celadon" />
        </div>
      )}

      {error && (
        <div className="card mt3" style={{ borderColor: 'var(--danger-line)' }}>
          <div className="row gap2" style={{ color: 'var(--danger)' }}>
            <Icon name="alert" size={15} />
            <span className="t-sm grow">{error}</span>
          </div>
        </div>
      )}

      <div className="between" style={{ marginBottom: 'var(--s3)' }}>
        <span className="t-label">Your events</span>
        {events.length > 0 && (
          <button className="btn btn-bare t-sm" onClick={() => setCreating(true)}>
            <Icon name="plus" size={13} strokeWidth={2.2} />
            New
          </button>
        )}
      </div>

      {loading ? (
        <SkeletonList rows={3} />
      ) : events.length === 0 ? (
        <Empty
          icon="events"
          title="No events yet"
          body="Everyone you meet lands under an event."
          action={
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Icon name="plus" size={16} strokeWidth={2.2} />
              New event
            </button>
          }
        />
      ) : (
        <div className="col gap3">
          {events.map((ev) => {
            const contacts = byEvent[ev.id] || []
            const todo = contacts.filter((c) => c.status === 'Needs follow-up').length
            const ready = contacts.filter(hasDraft).length
            const rel = relativeDay(ev.date)
            return (
              <Link key={ev.id} to={`/e/${ev.id}`} className="card card-tap">
                <div className="between">
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="t-title clamp-2">{ev.name}</div>
                    <div className="t-sm faint mt2">
                      {formatDate(ev.date)}
                      {rel && <span className="mauve"> · {rel}</span>}
                      {ev.location && ` · ${ev.location}`}
                    </div>
                  </div>
                  <Icon name="right" size={16} className="faint" />
                </div>

                <div className="row gap2 wrap mt4">
                  <span className="chip">{pluralize(contacts.length || ev.contactCount || 0, 'contact')}</span>
                  {ready > 0 && <span className="chip chip-mauve">{ready} drafted</span>}
                  {todo > 0 && <span className="chip chip-warn">{todo} to send</span>}
                </div>
              </Link>
            )
          })}
        </div>
      )}

      <NewEvent open={creating} onClose={() => setCreating(false)} uid={user?.uid || ''} />
    </div>
  )
}

function Stat({ n, label, tint }: { n: number; label: string; tint?: 'mauve' | 'celadon' }) {
  return (
    <div className="stat">
      <div className="t-num" style={{ fontSize: 22, color: tint ? `var(--${tint}-ink)` : 'var(--ink)' }}>
        {n}
      </div>
      <div className="t-sm faint" style={{ marginTop: -2 }}>
        {label}
      </div>
    </div>
  )
}

function NewEvent({ open, onClose, uid }: { open: boolean; onClose(): void; uid: string }) {
  const toast = useToast()
  const nav = useNavigate()
  const [name, setName] = useState('')
  const [date, setDate] = useState(todayISO())
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!name.trim()) {
      toast.err('Needs a name.')
      return
    }
    setBusy(true)
    try {
      const id = await createEvent(uid, { name: name.trim(), date, location: location.trim() })
      onClose()
      setName('')
      setLocation('')
      setDate(todayISO())
      nav(`/e/${id}`)
    } catch (e) {
      toast.err(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="New event">
      <div className="col gap4">
        <Field label="Name">
          <input
            className="input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Fall 2026 Tech Career Fair"
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </Field>
        <Field label="Date">
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Location">
          <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Optional" />
        </Field>
      </div>
      <div className="row gap3 mt6">
        <button className="btn btn-ghost grow" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-primary grow" onClick={save} disabled={busy}>
          {busy ? <span className="spin spin-dark" /> : <Icon name="check" size={16} />}
          Create
        </button>
      </div>
    </Sheet>
  )
}

