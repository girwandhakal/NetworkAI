import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { CopyButton } from '../components/Ui'
import { missingFirebaseKeys } from '../lib/firebase'
import { enableDemo } from '../lib/demo'
import { health } from '../lib/api'
import type { HealthInfo } from '../lib/types'

const ENV_TEMPLATE = `VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
OPENAI_API_KEY=`

/** Shown instead of the app when .env has not been filled in yet. */
export function Setup() {
  const [info, setInfo] = useState<HealthInfo | null | undefined>(undefined)
  useEffect(() => {
    void health().then(setInfo)
  }, [])

  return (
    <div className="page no-nav" style={{ maxWidth: 560, margin: '0 auto' }}>
      <header className="topbar">
        <h1 className="t-display">
          Two keys and
          <br />
          <span className="mauve italic">you are running.</span>
        </h1>
        <p className="t-body muted mt3">Your own Firebase project, your own OpenAI key.</p>
      </header>

      <Step n={1} title="Create a Firebase project" done={missingFirebaseKeys.length === 0}>
        <ul className="col gap2">
          <Bullet>
            <a href="https://console.firebase.google.com" target="_blank" rel="noreferrer">console.firebase.google.com</a> → new project
          </Bullet>
          <Bullet>Authentication → enable Email/Password</Bullet>
          <Bullet>Firestore Database → create</Bullet>
          <Bullet>
            Firestore → Rules → paste <span className="mauve">firestore.rules</span> → Publish
          </Bullet>
          <Bullet>Project settings → Your apps → Web app → copy the config</Bullet>
        </ul>
      </Step>

      <Step n={2} title="Get an OpenAI API key" done={Boolean(info?.ai.configured)}>
        <p className="t-sm muted">
          Create one at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com/api-keys</a>. Needs billing set up on the account — there is no free tier.
        </p>
      </Step>

      <Step n={3} title="Fill in .env" done={missingFirebaseKeys.length === 0 && Boolean(info?.ai.configured)}>
        <p className="t-sm muted">
          Copy <span className="mauve">.env.example</span> to <span className="mauve">.env</span> and fill in:
        </p>
        <div className="card mt3" style={{ background: 'var(--surface-2)' }}>
          <p className="t-sm pre-wrap break" style={{ color: 'var(--ink-2)' }}>
            {ENV_TEMPLATE}
          </p>
        </div>
        <div className="mt3">
          <CopyButton text={ENV_TEMPLATE} label="Copy" />
        </div>
        <p className="t-sm faint mt3">Then restart the dev server — .env is only read at startup.</p>
      </Step>

      <div className="card mt5">
        <div className="t-label" style={{ marginBottom: 'var(--s3)' }}>Current status</div>
        <div className="col gap3">
          <Check
            ok={missingFirebaseKeys.length === 0}
            label="Firebase config"
            detail={missingFirebaseKeys.length ? `Missing: ${missingFirebaseKeys.join(', ')}` : 'All keys present'}
          />
          <Check
            ok={info === undefined ? null : Boolean(info)}
            label="API server"
            detail={info === undefined ? 'Checking' : info ? 'Reachable' : 'Not running'}
          />
          <Check
            ok={info === undefined ? null : Boolean(info?.ai.configured)}
            label="OpenAI key"
            detail={info?.ai.configured ? info.ai.model : 'Not set'}
          />
        </div>
        <button className="btn btn-primary btn-full mt5" onClick={() => window.location.reload()}>
          <Icon name="refresh" size={15} />
          Recheck
        </button>
      </div>

      <div className="card mt5" style={{ borderColor: 'var(--celadon-line)', background: 'var(--celadon-dim)' }}>
        <div className="row gap3">
          <span className="celadon" style={{ flex: 'none' }}>
            <Icon name="spark" size={17} />
          </span>
          <div className="grow">
            <div className="t-section celadon">Just looking?</div>
            <p className="t-sm muted mt2">
              Open the app with sample data. No Firebase, nothing saved off this browser.
            </p>
          </div>
        </div>
        <button className="btn btn-go btn-full mt4" onClick={enableDemo}>
          <Icon name="right" size={15} />
          Try it with sample data
        </button>
      </div>

    </div>
  )
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <div className="card mt4">
      <div className="row gap3" style={{ marginBottom: 'var(--s3)' }}>
        <span
          className="t-num"
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            background: done ? 'var(--celadon)' : 'var(--surface-3)',
            color: done ? 'var(--black)' : 'var(--ink-3)',
          }}
        >
          {done ? <Icon name="check" size={13} strokeWidth={2.6} /> : n}
        </span>
        <span className="t-section grow">{title}</span>
      </div>
      {children}
    </div>
  )
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="row-t gap2 t-sm" style={{ color: 'var(--ink-2)' }}>
      <span className="mauve" style={{ lineHeight: 1.5 }}>·</span>
      <span className="grow">{children}</span>
    </li>
  )
}

function Check({ ok, label, detail }: { ok: boolean | null; label: string; detail: string }) {
  return (
    <div className="between gap3">
      <span className="t-sm muted" style={{ flex: 'none' }}>{label}</span>
      <span className="row gap2" style={{ minWidth: 0 }}>
        <span className="dot" style={{ background: ok === null ? 'var(--ink-4)' : ok ? 'var(--celadon-ink)' : 'var(--danger)' }} />
        <span className="t-sm clamp-1" style={{ color: ok ? 'var(--ink)' : 'var(--ink-3)' }}>{detail}</span>
      </span>
    </div>
  )
}
