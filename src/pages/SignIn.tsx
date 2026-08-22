import { useState } from 'react'
import { Icon } from '../components/Icon'
import { Field } from '../components/Ui'
import { useAuth } from '../state/Auth'
import { useToast } from '../state/Toast'

type Mode = 'in' | 'up' | 'reset'

export function SignIn() {
  const { signIn, signUp, signInGoogle, resetPassword } = useAuth()
  const toast = useToast()

  const [mode, setMode] = useState<Mode>('in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy('form')
    try {
      if (mode === 'reset') {
        await resetPassword(email)
        toast.ok('Reset link sent.')
        setMode('in')
      } else if (mode === 'up') {
        if (!name.trim()) throw new Error('Needs a name.')
        await signUp(name, email, password)
      } else {
        await signIn(email, password)
      }
    } catch (err) {
      toast.err(err)
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="page no-nav" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '100dvh' }}>
      <div style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <Mark />

        <h1 className="t-display mt6" style={{ fontSize: 34 }}>
          Never forget
          <br />
          <span className="mauve italic">who you met.</span>
        </h1>

        <form className="col gap4 mt6" onSubmit={submit}>
          {mode === 'up' && (
            <Field label="Your name">
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jordan Ellis"
                autoComplete="name"
              />
            </Field>
          )}

          <Field label="Email">
            <input
              className="input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@school.edu"
              autoComplete="email"
              inputMode="email"
            />
          </Field>

          {mode !== 'reset' && (
            <Field label="Password">
              <input
                className="input"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
              />
            </Field>
          )}

          <button className="btn btn-primary btn-full" disabled={Boolean(busy)} type="submit">
            {busy === 'form' ? (
              <span className="spin spin-dark" />
            ) : (
              <Icon name={mode === 'reset' ? 'mail' : 'right'} size={16} />
            )}
            {mode === 'up' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in'}
          </button>
        </form>

        {mode !== 'reset' && (
          <>
            <div className="row gap3 mt5">
              <span className="hr grow" style={{ margin: 0 }} />
              <span className="t-label">or</span>
              <span className="hr grow" style={{ margin: 0 }} />
            </div>

            <button
              className="btn btn-ghost btn-full mt5"
              disabled={Boolean(busy)}
              onClick={async () => {
                setBusy('google')
                try {
                  await signInGoogle()
                } catch (e) {
                  toast.err(e)
                } finally {
                  setBusy('')
                }
              }}
            >
              {busy === 'google' ? <span className="spin" /> : <GoogleGlyph />}
              Continue with Google
            </button>
          </>
        )}

        <div className="center mt6 col gap2">
          {mode === 'in' && (
            <>
              <button className="btn btn-bare" onClick={() => setMode('up')}>
                No account? <span className="mauve">&nbsp;Create one</span>
              </button>
              <button className="btn btn-bare t-sm faint" onClick={() => setMode('reset')}>
                Forgot password?
              </button>
            </>
          )}
          {mode === 'up' && (
            <button className="btn btn-bare" onClick={() => setMode('in')}>
              Have an account? <span className="mauve">&nbsp;Sign in</span>
            </button>
          )}
          {mode === 'reset' && (
            <button className="btn btn-bare" onClick={() => setMode('in')}>
              Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Mark() {
  return (
    <div className="row gap3">
      <svg width="38" height="38" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="20" cy="20" r="6" fill="#ca7df9" />
        <circle cx="45" cy="17" r="4.5" fill="#aef6c7" />
        <circle cx="43" cy="45" r="7" fill="#aef6c7" />
        <circle cx="17" cy="44" r="4" fill="#ca7df9" />
        <g stroke="#040403" strokeWidth="2" strokeLinecap="round" opacity=".45">
          <path d="M20 20 45 17" />
          <path d="M45 17 43 45" />
          <path d="M43 45 17 44" />
          <path d="M17 44 20 20" />
          <path d="M20 20 43 45" />
        </g>
      </svg>
      <span className="t-title">
        Network<span className="mauve">.Ai</span>
      </span>
    </div>
  )
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h11.8c-.5 2.7-2 5.1-4.4 6.7v5.5h7.1c4.1-3.8 6.6-9.4 6.6-16.4z" />
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.2 15.5 46 24 46z" />
      <path fill="#FBBC05" d="M11.8 28.3c-.4-1.3-.7-2.7-.7-4.3s.3-3 .7-4.3v-5.7H4.5A22 22 0 0 0 2 24c0 3.6.9 6.9 2.5 9.9l7.3-5.6z" />
      <path fill="#EA4335" d="M24 10.7c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.1 29.9 2 24 2 15.5 2 8.1 6.8 4.5 13.7l7.3 5.7c1.7-5.2 6.5-8.7 12.2-8.7z" />
    </svg>
  )
}
