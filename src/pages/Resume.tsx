import { lazy, Suspense, useEffect } from 'react'
import { useAuth } from '../state/Auth'
import { parseResume } from '../lib/api'
import { blobToBase64 } from '../lib/media'
import { isDemo } from '../lib/demo'

// PDF.js is ~1.5MB with its worker — only fetched when this tab is opened.
const PdfView = lazy(() => import('../components/PdfView'))

const SRC = '/resume.pdf'

/**
 * Just the resume. The PDF is served out of docs/ by the API.
 *
 * The one thing happening off-screen: if the profile has no resume text yet,
 * the file is parsed once in the background so drafts can quote real details
 * from it. None of that is rendered.
 */
export function Resume() {
  const { profile, patchProfile } = useAuth()

  useEffect(() => {
    if (isDemo() || profile?.resumeText?.trim()) return
    let stop = false
    void (async () => {
      try {
        const res = await fetch(SRC)
        if (!res.ok) return
        const parsed = await parseResume({
          data: await blobToBase64(await res.blob()),
          mimeType: 'application/pdf',
          fileName: 'Resume',
        })
        if (stop) return
        await patchProfile({
          resumeText: parsed.resumeText,
          resumeFileName: parsed.resumeFileName || 'Resume',
          targetRoles: profile?.targetRoles?.trim() || parsed.targetRoles,
          experiences: profile?.experiences?.trim() || parsed.experiences,
        })
      } catch {
        /* the viewer works with or without the parsed text */
      }
    })()
    return () => {
      stop = true
    }
  }, [profile?.resumeText, profile?.targetRoles, profile?.experiences, patchProfile])

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
        <PdfView src={SRC} />
      </Suspense>
    </div>
  )
}
