import { useState } from 'react'
import { Icon } from '../components/Icon'
import { Field } from '../components/Ui'
import { ResumeUpload } from '../components/ResumeUpload'
import { useAuth } from '../state/Auth'
import { useToast } from '../state/Toast'
import { DEFAULT_TONE, TONE_BLURB, TONES, type Tone, type UserProfile } from '../lib/types'

const STEPS = ['You', 'Resume', 'Voice'] as const

export function Onboarding() {
  const { profile, patchProfile, user } = useAuth()
  const toast = useToast()

  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
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
    defaultTone: profile?.defaultTone || DEFAULT_TONE,
  })

  const set = (patch: Partial<UserProfile>) => setForm((f) => ({ ...f, ...patch }))
  const hasResume = Boolean(form.resumeText?.trim())

  async function next() {
    if (step === 0 && !form.name.trim()) {
      toast.err('Needs a name.')
      return
    }
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
          {step === 0 && 'Who are you?'}
          {step === 1 && 'Add your resume'}
          {step === 2 && 'How should you sound?'}
        </h1>
      </header>

      {step === 0 && (
        <div className="col gap4 mt5">
          <Field label="Full name">
            <input className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Jordan Ellis" autoComplete="name" />
          </Field>
          <Field label="School">
            <input className="input" value={form.school} onChange={(e) => set({ school: e.target.value })} placeholder="University of Alabama" />
          </Field>
          <div className="row gap3" style={{ alignItems: 'flex-start' }}>
            <div className="grow">
              <Field label="Major">
                <input className="input" value={form.major} onChange={(e) => set({ major: e.target.value })} placeholder="Computer Science" />
              </Field>
            </div>
            <div style={{ width: 104, flex: 'none' }}>
              <Field label="Grad year">
                <input className="input" value={form.gradYear} onChange={(e) => set({ gradYear: e.target.value })} placeholder="2027" inputMode="numeric" />
              </Field>
            </div>
          </div>
        </div>
      )}

      {step === 1 && (
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
                <ResumeUpload compact label="Replace" onParsed={(r) => set(mergeParsed(form, r))} />
              </div>
              {form.targetRoles && (
                <>
                  <hr className="hr" />
                  <div className="t-label">It read you as</div>
                  <p className="t-sm mt2">{form.targetRoles}</p>
                </>
              )}
            </div>
          ) : (
            <ResumeUpload onParsed={(r) => set(mergeParsed(form, r))} />
          )}

          <div className="col gap4 mt6">
            <Field label="Target roles">
              <input
                className="input"
                value={form.targetRoles || ''}
                onChange={(e) => set({ targetRoles: e.target.value })}
                placeholder="Backend or infra SWE internships, summer 2027"
              />
            </Field>
            <Field label="Experiences worth name-dropping">
              <textarea
                className="textarea"
                value={form.experiences || ''}
                onChange={(e) => set({ experiences: e.target.value })}
                placeholder={'Built a distributed rate limiter in Go\nTA for Data Structures, 120 students\nShipped a React dashboard used by 400 people'}
              />
            </Field>
          </div>
        </div>
      )}

      {step === 2 && (
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

function mergeParsed(current: UserProfile, r: { name: string; school: string; major: string; gradYear: string; targetRoles: string; experiences: string; resumeText: string; resumeFileName: string }): Partial<UserProfile> {
  // Anything the user already typed wins over what the parser guessed.
  const fill = (mine: string | undefined, theirs: string) => (mine && mine.trim() ? mine : theirs)
  return {
    name: fill(current.name, r.name),
    school: fill(current.school, r.school),
    major: fill(current.major, r.major),
    gradYear: fill(current.gradYear, r.gradYear),
    targetRoles: fill(current.targetRoles, r.targetRoles),
    experiences: fill(current.experiences, r.experiences),
    resumeText: r.resumeText,
    resumeFileName: r.resumeFileName,
  }
}
