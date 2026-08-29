import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { ResumeUpload } from '../components/ResumeUpload'
import { Confirm, SectionLabel } from '../components/Ui'
import { useAuth } from '../state/Auth'
import { useData } from '../state/Data'
import { useToast } from '../state/Toast'
import { health } from '../lib/api'
import { drain, listJobs } from '../lib/queue'
import { mergeResume, type HealthInfo } from '../lib/types'

import { isDemo } from '../lib/demo'

const DEMO = isDemo()

export function Me() {
  const { user, profile, patchProfile, logout } = useAuth()
  const { all, queued, online, processing } = useData()
  const toast = useToast()

  const [info, setInfo] = useState<HealthInfo | null | undefined>(undefined)
  const [signingOut, setSigningOut] = useState(false)
  const [jobErr, setJobErr] = useState('')

  useEffect(() => {
    void health().then(setInfo)
    void listJobs()
      .then((jobs) => setJobErr(jobs.find((j) => j.lastError)?.lastError || ''))
      .catch(() => {})
  }, [queued])

  const linked = all.filter((c) => c.linkedinAdded).length

  return (
    <div className="page">
      <header className="topbar">
        <h1 className="t-display break">{profile?.name || user?.displayName || 'You'}</h1>
        <p className="t-sm faint mt2 break">{user?.email}</p>
      </header>

      {/* resume — the only source for name/school/major/target roles/etc.;
          re-uploading is the only way any of it changes. */}
      <div className="card mt4">
        <SectionLabel>Resume</SectionLabel>
        {profile?.resumeText?.trim() ? (
          <div className="row gap3">
            <span className="celadon">
              <Icon name="resume" size={18} />
            </span>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="t-section clamp-1">{profile.resumeFileName || 'Resume saved'}</div>
              <div className="t-sm faint" style={{ marginTop: 2 }}>
                {profile.resumeText.trim().split(/\s+/).length.toLocaleString()} words
              </div>
            </div>
            {profile.resumeUrl && (
              <Link className="btn btn-ghost btn-sm" to="/resume">
                View
              </Link>
            )}
            <ResumeUpload
              compact
              label="Replace"
              onParsed={(r) => patchProfile(mergeResume(profile || {}, r)).then(() => toast.ok('Resume updated.')).catch((e) => toast.err(e))}
            />
          </div>
        ) : (
          <ResumeUpload onParsed={(r) => patchProfile(mergeResume(profile || {}, r)).then(() => toast.ok('Resume saved.')).catch((e) => toast.err(e))} />
        )}
      </div>

      {/* linkedin progress */}
      {all.some((c) => c.linkedinNote) && (
        <div className="card between">
          <div className="grow">
            <div className="t-section">LinkedIn</div>
            <div className="t-sm faint mt2">
              {linked} of {all.filter((c) => c.linkedinNote).length} added
            </div>
          </div>
          <Icon name="link" size={18} className="faint" />
        </div>
      )}

      {/* system */}
      <div className="card mt4">
        <SectionLabel>System</SectionLabel>
        <div className="col gap3">
          <Row
            label="Connection"
            value={online ? 'Online' : 'Offline'}
            good={online}
          />
          <Row
            label="OpenAI"
            value={info === undefined ? 'Checking' : info?.ai.configured ? info.ai.model : 'Not configured'}
            good={Boolean(info?.ai.configured)}
            help={info && !info.ai.configured ? 'Add OPENAI_API_KEY to .env.' : undefined}
          />
          <Row
            label="Email sending"
            value={
              info === undefined
                ? 'Checking'
                : info === null
                  ? 'Server unreachable'
                  : info.mail.ready
                    ? `${info.mail.mode === 'resend' ? 'Resend' : 'SMTP'} · ${info.mail.from}`
                    : 'Not configured'
            }
            good={Boolean(info?.mail.ready)}
            help={info && !info.mail.ready ? 'Add RESEND_API_KEY + MAIL_FROM to .env.' : undefined}
          />
          <Row
            label="Capture queue"
            value={queued === 0 ? 'Empty' : processing ? `Processing ${queued}` : `${queued} waiting`}
            good={queued === 0}
            help={jobErr || undefined}
          />
        </div>

        {queued > 0 && (
          <button className="btn btn-ghost btn-sm btn-full mt4" onClick={() => void drain().then(() => toast.ok('Done.'))}>
            <Icon name="refresh" size={13} />
            Process now
          </button>
        )}
      </div>

      <button className="btn btn-ghost btn-full mt5" onClick={() => setSigningOut(true)}>
        <Icon name="logout" size={15} />
        {DEMO ? 'Leave the demo' : 'Sign out'}
      </button>

      <Confirm
        open={signingOut}
        title={DEMO ? 'Leave the demo?' : 'Sign out?'}
        body={
          DEMO
            ? 'The sample data is discarded.'
            : 'Your data stays in your account.'
        }
        confirmLabel={DEMO ? 'Leave demo' : 'Sign out'}
        onClose={() => setSigningOut(false)}
        onConfirm={async () => {
          try {
            await logout()
          } catch (e) {
            toast.err(e)
          }
        }}
      />
    </div>
  )
}

function Row({ label, value, good, help }: { label: string; value: string; good?: boolean; help?: string }) {
  return (
    <div>
      <div className="between gap3">
        <span className="t-sm muted">{label}</span>
        <span className="row gap2" style={{ minWidth: 0 }}>
          <span className="dot" style={{ background: good ? 'var(--celadon-ink)' : 'var(--danger)' }} />
          <span className="t-sm clamp-1" style={{ color: good ? 'var(--ink)' : 'var(--danger)' }}>
            {value}
          </span>
        </span>
      </div>
      {help && <p className="t-sm faint mt2">{help}</p>}
    </div>
  )
}
