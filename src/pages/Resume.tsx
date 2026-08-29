import { lazy, Suspense } from 'react'
import { Icon } from '../components/Icon'
import { ResumeUpload } from '../components/ResumeUpload'
import { useAuth } from '../state/Auth'
import { useToast } from '../state/Toast'
import { mergeResume } from '../lib/types'

// PDF.js is ~1.5MB with its worker — only fetched when this tab is opened.
const PdfView = lazy(() => import('../components/PdfView'))

/** Same-origin proxy for pdf.js's range-request fetches, which Firebase
 *  Storage's CORS policy would otherwise block from the browser. */
const proxied = (url: string) => `/api/resume-file?url=${encodeURIComponent(url)}`

/**
 * Just the resume — whatever the user last uploaded. There is no separate
 * "add a resume" flow elsewhere; this tab, onboarding, and Me -> Resume all
 * point at the same upload component and the same profile fields.
 */
export function Resume() {
  const { profile, patchProfile } = useAuth()
  const toast = useToast()

  if (!profile?.resumeUrl) {
    return (
      <div className="page">
        <header className="topbar">
          <h1 className="t-display">Resume</h1>
          <p className="t-sm faint mt2">
            {profile?.resumeText?.trim()
              ? "You pasted text instead of a file, so there's nothing to preview here — upload the actual document to see it and attach it to emails."
              : 'Upload it once — your profile and email drafts are read straight off it.'}
          </p>
        </header>
        <ResumeUpload onParsed={(r) => patchProfile(mergeResume(profile || {}, r)).then(() => toast.ok('Resume saved.')).catch((e) => toast.err(e))} />
      </div>
    )
  }

  const isPdf = (profile.resumeMimeType || '').includes('pdf')

  if (!isPdf) {
    return (
      <div className="page">
        <header className="topbar">
          <h1 className="t-display clamp-1">{profile.resumeFileName || 'Resume'}</h1>
          <p className="t-sm faint mt2">This file type can't be previewed here — replace it with a PDF from the Me tab, or open it as-is.</p>
        </header>
        <a className="btn btn-ghost" href={proxied(profile.resumeUrl)} target="_blank" rel="noreferrer">
          <Icon name="external" size={15} />
          Open it
        </a>
      </div>
    )
  }

  return (
    <div
      style={{
        padding: 'calc(env(safe-area-inset-top, 0px) + var(--s3)) var(--s3)',
        height: 'calc(100dvh - var(--nav-h) - var(--safe-b))',
      }}
    >
      <Suspense
        fallback={
          <div className="col gap3" style={{ alignItems: 'center', justifyContent: 'center', paddingTop: '35dvh' }}>
            <span className="spin" />
          </div>
        }
      >
        <PdfView src={proxied(profile.resumeUrl)} />
      </Suspense>
    </div>
  )
}
