import { useState } from 'react'
import { Icon } from '../components/Icon'
import { Field } from '../components/Ui'
import { ResumeUpload } from '../components/ResumeUpload'
import { useAuth } from '../state/Auth'
import { useToast } from '../state/Toast'
import { DEFAULT_TONE, mergeResume, TONE_BLURB, TONES, type Tone, type UserProfile } from '../lib/types'

const STEPS = ['Resume', 'Voice'] as const

export function Onboarding() {
  const { profile, patchProfile, user } = useAuth()
  const toast = useToast()

  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  // Nothing here is typed in by hand — a resume upload is the only way any
  // of it gets set. See mergeResume.
  const [form, setForm] = useState<UserProfile>({
    name: profile?.name || user?.displayName || '',
    school: profile?.school || '',
    major: profile?.major || '',
    gradYear: profile?.gradYear || '',
    targetRoles: profile?.targetRoles || '',
    experiences: profile?.experiences || '',
    emailPreference: profile?.emailPreference || '',
    resumeText: profile?.resumeText || '',
    resumeFileName: profile?.resumeFileName || '',
    resumeUrl: profile?.resumeUrl,
    resumeStoragePath: profile?.resumeStoragePath,
    resumeMimeType: profile?.resumeMimeType,
    defaultTone: profile?.defaultTone || DEFAULT_TONE,
  })

  const set = (patch: Partial<UserProfile>) => setForm((f) => ({ ...f, ...patch }))
  const hasResume = Boolean(form.resumeText?.trim())

  async function next() {
    if (step < STEPS.length - 1) {
      setStep(step + 1)
      return
    }
    setBusy(true)
    try {
      await patchProfile({ ...form, onboarded: true, email: user?.email || '' })
      toast.ok('All set.')
    } catch (e) {
      toast.err(e)
    } finally {
      setBusy(false)
    }
  }

  async function skipAll() {
    setBusy(true)
    try {
      await patchProfile({ ...form, onboarded: true, email: user?.email || '' })
    } catch (e) {
      toast.err(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page no-nav">
      <header className="topbar">
        <div className="row gap2" style={{ marginBottom: 'var(--s5)' }}>
          {STEPS.map((s, i) => (
            <div
              key={s}
              className="grow"
              style={{
                height: 2,
                borderRadius: 99,
                background: i <= step ? 'var(--mauve)' : 'var(--line)',
                transition: 'background .25s',
              }}
            />
          ))}
        </div>
        <h1 className="t-display">
          {step === 0 && 'Add your resume'}
          {step === 1 && 'How should you sound?'}
        </h1>
        {step === 0 && <p className="t-sm faint mt2">Everything below is read straight off it — no forms to fill in. Upload a newer one any time to update it.</p>}
      </header>

      {step === 0 && (
        <div className="mt5">
          {hasResume ? (
            <div className="card">
              <div className="row gap3">
                <span className="celadon">
                  <Icon name="check" size={18} />
                </span>
                <div className="grow">
                  <div className="t-section clamp-1">{form.resumeFileName || 'Resume saved'}</div>
                  <div className="t-sm faint" style={{ marginTop: 2 }}>
                    {form.resumeText?.trim().split(/\s+/).length.toLocaleString()} words
                  </div>
                </div>
                <ResumeUpload compact label="Replace" onParsed={(r) => set(mergeResume(form, r))} />
              </div>
              {(form.name || form.school || form.targetRoles) && (
                <>
                  <hr className="hr" />
                  <div className="t-label">Read off it</div>
                  <div className="col gap1 mt2">
                    {form.name && <p className="t-sm">{form.name}</p>}
                    {(form.school || form.major) && <p className="t-sm faint">{[form.major, form.school].filter(Boolean).join(' · ')}</p>}
                    {form.targetRoles && <p className="t-sm faint">{form.targetRoles}</p>}
                  </div>
                </>
              )}
            </div>
          ) : (
            <ResumeUpload onParsed={(r) => set(mergeResume(form, r))} />
          )}
        </div>
      )}

      {step === 1 && (
        <div className="mt5">
          <div className="col gap3">
            {TONES.map((t) => (
              <button
                key={t}
                className="card card-tap row gap3"
                style={{
                  borderColor: form.defaultTone === t ? 'var(--mauve)' : undefined,
                  background: form.defaultTone === t ? 'var(--mauve-dim)' : undefined,
                }}
                onClick={() => set({ defaultTone: t as Tone })}
              >
                <span className={`checkbox${form.defaultTone === t ? ' on' : ''}`} style={{ borderRadius: '50%' }}>
                  <Icon name="check" size={12} strokeWidth={2.6} />
                </span>
                <span className="grow col">
                  <span className="t-section">{t}</span>
                  <span className="t-sm faint" style={{ marginTop: 1 }}>
                    {TONE_BLURB[t]}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <div className="mt6">
            <Field label="Writing notes">
              <textarea
                className="textarea"
                style={{ minHeight: 70 }}
                value={form.emailPreference || ''}
                onChange={(e) => set({ emailPreference: e.target.value })}
                placeholder="Never say 'I hope this email finds you well'. Sign off with 'Thanks,'."
              />
            </Field>
          </div>
        </div>
      )}

      <div className="row gap3 mt6">
        {step > 0 && (
          <button className="btn btn-ghost" onClick={() => setStep(step - 1)} disabled={busy}>
            <Icon name="left" size={14} />
            Back
          </button>
        )}
        <button className="btn btn-primary grow" onClick={next} disabled={busy}>
          {busy ? <span className="spin spin-dark" /> : <Icon name={step === STEPS.length - 1 ? 'check' : 'right'} size={16} />}
          {step === STEPS.length - 1 ? 'Start capturing' : 'Continue'}
        </button>
      </div>

      {step < STEPS.length - 1 && (
        <button className="btn btn-bare btn-full mt3 t-sm faint" onClick={skipAll} disabled={busy}>
          Skip
        </button>
      )}
    </div>
  )
}
