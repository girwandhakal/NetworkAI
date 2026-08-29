import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Icon, type IconName } from './Icon'
import { CaptureSheet } from './CaptureSheet'
import { useData } from '../state/Data'
import { exitDemo, isDemo, resetDemo } from '../lib/demo'

const DEMO = isDemo()

const TABS: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Events', icon: 'events' },
  { to: '/followups', label: 'Follow-up', icon: 'mail' },
  { to: '/resume', label: 'Resume', icon: 'resume' },
  { to: '/me', label: 'Me', icon: 'user' },
]

export function AppShell() {
  const [capture, setCapture] = useState(false)
  const { events, online, queued, processing } = useData()
  const { pathname } = useLocation()
  // A layout route cannot read its children's params, so read the event off the path.
  const eventId = /^\/e\/([^/]+)/.exec(pathname)?.[1]

  return (
    <div className="shell">
      {DEMO && (
        <div style={{ padding: '10px var(--s5) 0' }}>
          <div
            className="row gap2"
            style={{
              background: 'var(--celadon-dim)',
              border: '1px solid var(--celadon-line)',
              borderRadius: 'var(--r2)',
              padding: 'var(--s2) var(--s4)',
              fontFamily: 'var(--f-small)',
              fontSize: 12.5,
              color: 'var(--celadon-ink)',
            }}
          >
            <span className="dot" style={{ background: 'var(--celadon-ink)' }} />
            <span className="grow">Demo data</span>
            <button className="btn-bare" style={{ padding: 0, minHeight: 0, color: 'inherit', fontSize: 12 }} onClick={resetDemo}>
              Reset
            </button>
            <span style={{ opacity: 0.4 }}>·</span>
            <button className="btn-bare" style={{ padding: 0, minHeight: 0, color: 'inherit', fontSize: 12 }} onClick={exitDemo}>
              Exit
            </button>
          </div>
        </div>
      )}

      {(!online || queued > 0) && (
        <div style={{ padding: '10px var(--s5) 0' }}>
          <div className="offline-bar row gap2">
            <span className={processing ? 'dot dot-work' : 'dot'} />
            <span className="grow">
              {!online
                ? queued > 0
                  ? `Offline · ${queued} waiting`
                  : 'Offline'
                : processing
                  ? `Processing ${queued}`
                  : `${queued} waiting`}
            </span>
          </div>
        </div>
      )}

      <Outlet />

      {/* Capture only belongs to a specific event, so it only appears once
          you are inside one — the top-level bar is just the four tabs. */}
      <nav className="navwrap">
        <div className={`nav${eventId ? ' nav-solo' : ' nav-tabs'}`}>
          {eventId ? (
            <button className="capbtn" onClick={() => setCapture(true)} aria-label="Capture a contact">
              <span>
                <Icon name="plus" size={24} strokeWidth={2.2} />
              </span>
            </button>
          ) : (
            TABS.map((t) => <Tab key={t.to} {...t} />)
          )}
        </div>
      </nav>

      <CaptureSheet
        open={capture}
        onClose={() => setCapture(false)}
        events={events}
        eventId={eventId}
      />
    </div>
  )
}

function Tab({ to, label, icon }: { to: string; label: string; icon: IconName }) {
  return (
    <NavLink to={to} end={to === '/'} className={({ isActive }) => `navbtn${isActive ? ' on' : ''}`}>
      <Icon name={icon} size={19} className="navicon" />
      {label}
    </NavLink>
  )
}
