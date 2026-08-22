import { Link } from 'react-router-dom'
import { Icon } from './Icon'
import { displayName, needsCheck, type Contact } from '../lib/types'
import { initials, STATUS_STYLE, timeAgo } from '../lib/util'

export function ContactRow({ c, eventId, showEvent }: { c: Contact; eventId: string; showEvent?: string }) {
  const name = displayName(c)
  const untitled = !c.name?.trim() && !c.company?.trim()
  const line = [c.title, c.company].filter(Boolean).join(' · ')
  const blurb = c.summary?.topic || c.notes || ''

  return (
    <Link to={`/e/${eventId}/c/${c.id}`} className="card card-tap row-t gap3">
      <span className={`rail rail-${c.priority}`} />

      <span
        className="t-num"
        style={{
          width: 34,
          height: 34,
          flex: 'none',
          borderRadius: 10,
          background: c.priority === 'High' ? 'var(--mauve-dim)' : 'var(--surface-2)',
          border: `1px solid ${c.priority === 'High' ? 'var(--mauve-line)' : 'var(--line)'}`,
          color: c.priority === 'High' ? 'var(--mauve)' : 'var(--ink-3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12.5,
          letterSpacing: '.02em',
        }}
      >
        {c.aiPending ? <span className="spin" style={{ width: 13, height: 13 }} /> : initials(name)}
      </span>

      <span className="grow col" style={{ minWidth: 0 }}>
        <span className="between gap2">
          <span className={`t-section clamp-1${untitled ? ' italic faint' : ''}`}>{name}</span>
          <span className="t-sm faint" style={{ flex: 'none', fontSize: 11.5 }}>
            {timeAgo(c.createdAt)}
          </span>
        </span>

        {line && <span className="t-sm muted clamp-1" style={{ marginTop: 1 }}>{line}</span>}

        {c.aiPending ? (
          <span className="t-sm mauve clamp-1 mt2">Working out what you said…</span>
        ) : (
          blurb && <span className="t-sm faint clamp-2 mt2">{blurb}</span>
        )}

        <span className="row gap2 wrap mt3">
          <span className={STATUS_STYLE[c.status] || 'chip'}>{c.status}</span>
          {showEvent && <span className="chip">{showEvent}</span>}
          {c.captureType === 'voice' && (
            <span className="chip" title="Captured by voice">
              <Icon name="mic" size={10} />
            </span>
          )}
          {c.captureType === 'image' && (
            <span className="chip" title={c.docType || 'Captured from an image'}>
              <Icon name="camera" size={10} />
              {c.docType && c.docType !== 'Other' ? c.docType : ''}
            </span>
          )}
          {needsCheck(c) && (
            <span className="chip chip-warn" title="The extraction was unsure — worth a glance">
              <Icon name="alert" size={10} />
              Check
            </span>
          )}
          {c.aiError && (
            <span className="chip chip-warn" title={c.aiError}>
              Extraction failed
            </span>
          )}
          {c.sentAt && (
            <span className="chip chip-celadon">
              <Icon name="check" size={10} strokeWidth={2.4} />
              Sent
            </span>
          )}
        </span>
      </span>
    </Link>
  )
}
