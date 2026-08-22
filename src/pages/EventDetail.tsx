import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { Confirm, Empty, Field, Sheet, SkeletonList } from '../components/Ui'
import { ContactRow } from '../components/ContactRow'
import { CaptureSheet } from '../components/CaptureSheet'
import { useAuth } from '../state/Auth'
import { useData } from '../state/Data'
import { useToast } from '../state/Toast'
import { deleteEvent, recountEvent, updateEvent } from '../lib/db'
import { feedSort, formatDate, pluralize } from '../lib/util'
import { hasDraft, type Contact } from '../lib/types'

type Filter = 'All' | 'To send' | 'Drafted' | 'High' | 'Needs a look'

const FILTERS: Filter[] = ['All', 'To send', 'Drafted', 'High', 'Needs a look']

export function EventDetail() {
  const { eventId = '' } = useParams()
  const { user } = useAuth()
  const { events, byEvent, loading } = useData()
  const toast = useToast()
  const nav = useNavigate()

  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('All')
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [capturing, setCapturing] = useState(false)

  const event = events.find((e) => e.id === eventId)
  const contacts = byEvent[eventId]

  const shown = useMemo(() => {
    const list = (contacts || []).filter((c) => match(c, q) && passes(c, filter))
    return list.sort(feedSort)
  }, [contacts, q, filter])

  if (loading && !event) return <div className="page"><SkeletonList rows={4} /></div>

  if (!event) {
    return (
      <div className="page">
        <header className="topbar">
          <button className="back" onClick={() => nav('/')}>
            <Icon name="left" size={13} strokeWidth={2} />
            Back
          </button>
        </header>
        <Empty icon="events" title="Event not found" body="It may have been deleted from another device." action={<Link className="btn btn-ghost" to="/">All events</Link>} />
      </div>
    )
  }

  const list = contacts || []
  const ready = list.filter(hasDraft).length
  const todo = list.filter((c) => c.status === 'Needs follow-up').length

  return (
    <div className="page">
      <header className="topbar">
        <button className="back" onClick={() => nav('/')}>
          <Icon name="left" size={13} strokeWidth={2} />
          All events
        </button>
        <div className="between mt2">
          <div className="grow" style={{ minWidth: 0 }}>
            <h1 className="t-display break">{event.name}</h1>
          </div>
          <button className="btn-icon" onClick={() => setEditing(true)} aria-label="Edit event">
            <Icon name="pencil" size={15} />
          </button>
        </div>
        <p className="t-sm faint mt2">
          {formatDate(event.date)}
          {event.location && ` · ${event.location}`} · {pluralize(list.length, 'contact')}
        </p>
      </header>

      {list.length > 0 && (
        <div className="row gap2" style={{ marginBottom: 'var(--s4)' }}>
          <Link to={`/followups?event=${eventId}`} className="card card-tap grow row gap3" style={{ padding: 'var(--s3) var(--s4)' }}>
            <span className="mauve"><Icon name="mail" size={17} /></span>
            <span className="grow col">
              <span className="t-section">Follow-ups</span>
              <span className="t-sm faint" style={{ marginTop: 1 }}>
                {ready} drafted · {todo} to send
              </span>
            </span>
            <Icon name="right" size={14} className="faint" />
          </Link>
        </div>
      )}

      {list.length > 3 && (
        <div className="mt2" style={{ marginBottom: 'var(--s3)' }}>
          <div className="row gap2 card" style={{ padding: '0 var(--s4)' }}>
            <Icon name="search" size={15} className="faint" />
            <input
              className="input"
              style={{ background: 'none', border: 'none', padding: '10px 0' }}
              placeholder="Search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {q && (
              <button className="btn-bare" onClick={() => setQ('')} aria-label="Clear search">
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      {list.length > 0 && (
        <div className="segbar" style={{ marginBottom: 'var(--s4)' }}>
          {FILTERS.map((f) => {
            const n = list.filter((c) => passes(c, f)).length
            if (f !== 'All' && n === 0) return null
            return (
              <button key={f} className={`seg${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>
                {f}
                {f !== 'All' && ` ${n}`}
              </button>
            )
          })}
        </div>
      )}

      {list.length === 0 ? (
        <Empty
          icon="people"
          title="Nobody captured yet"
          body="Tap capture when you step away from a booth."
          action={
            <button className="btn btn-primary" onClick={() => setCapturing(true)}>
              <Icon name="mic" size={16} />
              Capture
            </button>
          }
        />
      ) : shown.length === 0 ? (
        <Empty icon="search" title="Nothing matches" body={q ? `Nothing mentions "${q}".` : 'Try another filter.'} />
      ) : (
        <div className="col gap3">
          {shown.map((c) => (
            <ContactRow key={c.id} c={c} eventId={eventId} />
          ))}
        </div>
      )}

      <EditEvent
        open={editing}
        onClose={() => setEditing(false)}
        event={event}
        onDelete={() => {
          setEditing(false)
          setConfirming(true)
        }}
        onRecount={async () => {
          if (!user) return
          const n = await recountEvent(user.uid, eventId)
          toast.ok(`${pluralize(n, 'contact')}.`)
        }}
      />

      <Confirm
        open={confirming}
        title={`Delete "${event.name}"?`}
        body={`Deletes ${pluralize(list.length, 'contact')} too. Cannot be undone.`}
        confirmLabel="Delete event"
        onClose={() => setConfirming(false)}
        onConfirm={async () => {
          if (!user) return
          try {
            await deleteEvent(user.uid, eventId)
            setConfirming(false)
            nav('/')
            toast.ok('Event deleted.')
          } catch (e) {
            toast.err(e)
          }
        }}
      />

      <CaptureSheet open={capturing} onClose={() => setCapturing(false)} events={events} eventId={eventId} />
    </div>
  )
}

function EditEvent({
  open,
  onClose,
  event,
  onDelete,
  onRecount,
}: {
  open: boolean
  onClose(): void
  event: { id: string; name: string; date: string; location?: string; contactCount: number }
  onDelete(): void
  onRecount(): Promise<void>
}) {
  const { user } = useAuth()
  const toast = useToast()
  const [name, setName] = useState(event.name)
  const [date, setDate] = useState(event.date)
  const [location, setLocation] = useState(event.location || '')
  const [busy, setBusy] = useState(false)

  return (
    <Sheet open={open} onClose={onClose} title="Edit event">
      <div className="col gap4">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
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
        <button
          className="btn btn-primary grow"
          disabled={busy}
          onClick={async () => {
            if (!user || !name.trim()) return
            setBusy(true)
            try {
              await updateEvent(user.uid, event.id, { name: name.trim(), date, location: location.trim() })
              onClose()
              toast.ok('Event updated.')
            } catch (e) {
              toast.err(e)
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? <span className="spin spin-dark" /> : <Icon name="check" size={16} />}
          Save
        </button>
      </div>

      <hr className="hr" style={{ marginTop: 'var(--s6)' }} />

      <button className="btn btn-bare btn-full t-sm" onClick={() => void onRecount()}>
        <Icon name="refresh" size={13} />
        Rebuild contact counter
      </button>
      <button className="btn btn-bare btn-full t-sm" style={{ color: 'var(--danger)' }} onClick={onDelete}>
        <Icon name="trash" size={13} />
        Delete this event
      </button>
    </Sheet>
  )
}

function match(c: Contact, q: string): boolean {
  const s = q.trim().toLowerCase()
  if (!s) return true
  return [c.name, c.company, c.title, c.email, c.notes, c.summary?.topic, c.summary?.details, c.summary?.connection]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(s)
}

function passes(c: Contact, f: Filter): boolean {
  switch (f) {
    case 'To send':
      return c.status === 'Needs follow-up' || c.status === 'Draft ready'
    case 'Drafted':
      return hasDraft(c)
    case 'High':
      return c.priority === 'High'
    case 'Needs a look':
      return Boolean(c.aiError) || (typeof c.confidence === 'number' && c.confidence < 0.6)
    default:
      return true
  }
}
