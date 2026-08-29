import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { ContactRow } from '../components/ContactRow'
import { Empty, Field, Sheet, SkeletonList } from '../components/Ui'
import { useAuth } from '../state/Auth'
import { useData, type ContactWithEvent } from '../state/Data'
import { useToast } from '../state/Toast'
import { createEvent } from '../lib/db'
import { formatDate, pluralize, relativeDay, todayISO } from '../lib/util'
import { hasDraft } from '../lib/types'

export function Events() {
  const { user, profile } = useAuth()
  const { events, all, byEvent, loading, error } = useData()
  const [creating, setCreating] = useState(false)
  const [q, setQ] = useState('')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')

  const firstName = (profile?.name || user?.displayName || '').trim().split(/\s+/)[0]

  const query = q.trim().toLowerCase()

  const sortedEvents = useMemo(() => {
    const list = [...events].sort((a, b) => a.date.localeCompare(b.date))
    if (sortDir === 'desc') list.reverse()
    return list
  }, [events, sortDir])

  const matchingEvents = useMemo(
    () => (query ? sortedEvents.filter((ev) => ev.name.toLowerCase().includes(query)) : sortedEvents),
    [sortedEvents, query],
  )

  const matchingContacts = useMemo(
    () => (query ? all.filter((c) => matchContact(c, query)) : []),
    [all, query],
  )

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

      {error && (
        <div className="card mt3" style={{ borderColor: 'var(--danger-line)' }}>
          <div className="row gap2" style={{ color: 'var(--danger)' }}>
            <Icon name="alert" size={15} />
            <span className="t-sm grow">{error}</span>
          </div>
        </div>
      )}

      {events.length > 0 && (
        <div className="search-bar mt2" style={{ marginBottom: 'var(--s5)' }}>
          <Icon name="search" size={16} className="faint" />
          <input
            placeholder="Search events and contacts"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            inputMode="search"
          />
          {q && (
            <button className="btn-bare" style={{ padding: 0, minHeight: 0 }} onClick={() => setQ('')} aria-label="Clear search">
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
      )}

      {(!query || matchingEvents.length > 0 || events.length === 0) && (
        <div className="between" style={{ marginBottom: 'var(--s3)' }}>
          <span className="t-label">{query ? 'Events' : 'Your events'}</span>
          <div className="row gap2">
            {!query && events.length > 1 && (
              <button
                className={`sortbtn ${sortDir}`}
                onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
              >
                <Icon name="sort" size={13} strokeWidth={2} />
                {sortDir === 'desc' ? 'Newest' : 'Oldest'}
              </button>
            )}
            {!query && events.length > 0 && (
              <button className="btn btn-bare t-sm" onClick={() => setCreating(true)}>
                <Icon name="plus" size={13} strokeWidth={2.2} />
                New
              </button>
            )}
          </div>
        </div>
      )}

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
      ) : query && matchingEvents.length === 0 && matchingContacts.length === 0 ? (
        <Empty icon="search" title="Nothing matches" body={`Nothing mentions "${q}".`} />
      ) : matchingEvents.length > 0 ? (
        <div className="col gap3">
          {matchingEvents.map((ev) => {
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
      ) : null}

      {query && matchingContacts.length > 0 && (
        <>
          <div className="mt6" style={{ marginBottom: 'var(--s3)' }}>
            <span className="t-label">{pluralize(matchingContacts.length, 'contact')}</span>
          </div>
          <div className="col gap3">
            {matchingContacts.map((c) => (
              <ContactRow key={c.id} c={c} eventId={c.eventId} showEvent={c.eventName} />
            ))}
          </div>
        </>
      )}

      <NewEvent open={creating} onClose={() => setCreating(false)} uid={user?.uid || ''} />
    </div>
  )
}

function matchContact(c: ContactWithEvent, q: string): boolean {
  return [c.name, c.company, c.title, c.email, c.notes, c.eventName, c.summary?.topic, c.summary?.details, c.summary?.connection]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(q)
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

