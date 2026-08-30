import { useRef, useState } from 'react'
import { Icon } from './Icon'
import { useAuth } from '../state/Auth'
import { useToast } from '../state/Toast'
import { parseResume } from '../lib/api'
import { blobToBase64 } from '../lib/media'
import { uploadResumeFile } from '../lib/storage'
import type { ParsedResume } from '../lib/types'

const MAX_MB = 12
const ACCEPT = '.pdf,.txt,.md,.doc,.docx,application/pdf,text/plain'

// Some browsers/OSes (notably files picked on iOS, or dragged from sources
// with no OS-level mime association) hand back an empty File.type even for
// a plain PDF. That value becomes resumeMimeType, and the Resume tab uses
// it — not the file extension — to decide whether to render the PDF
// preview, so a blank type there silently kills the preview even though
// OCR (which already falls back to 'application/pdf') works fine. Fall
// back to the extension so the two stay in agreement.
const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown',
}

function resolveMimeType(file: File): string {
  if (file.type) return file.type
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  return EXT_MIME[ext] || 'application/octet-stream'
}

/**
 * Resume in, structured profile out. Used by onboarding and by the Resume tab,
 * which is why the caller decides what to do with the parsed result.
 */
export function ResumeUpload({
  onParsed,
  compact,
  label = 'Upload resume',
}: {
  onParsed(r: ParsedResume): void | Promise<void>
  compact?: boolean
  label?: string
}) {
  const { user } = useAuth()
  const toast = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const [pasting, setPasting] = useState(false)
  const [text, setText] = useState('')

  async function handle(file: File | undefined) {
    if (!file) return
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.err(`Over ${MAX_MB}MB.`)
      return
    }
    setBusy(true)
    try {
      const isText = /^text\//.test(file.type) || /\.(txt|md)$/i.test(file.name)
      // Same mime type feeds both OCR and the stored resumeMimeType that
      // gates the PDF preview — they must not disagree with each other.
      const mimeType = resolveMimeType(file)
      const parsed = isText
        ? await parseResume({ text: await file.text(), fileName: file.name })
        : await parseResume({
            data: await blobToBase64(file),
            mimeType,
            fileName: file.name,
          })
      // Keep the actual file, not just its extracted text — it's what gets
      // viewed back and what "append resume" attaches to an email.
      let uploadFailed = false
      const uploaded = user
        ? await uploadResumeFile(user.uid, file, mimeType).catch(() => {
            uploadFailed = true
            return null
          })
        : null
      await onParsed({
        ...parsed,
        resumeFileName: parsed.resumeFileName || file.name,
        ...(uploaded ? { resumeUrl: uploaded.url, resumeStoragePath: uploaded.storagePath, resumeMimeType: mimeType } : {}),
      })
      // The parsed fields (name, school, experience, ...) still saved even
      // when the file itself didn't upload — say so, rather than a blanket
      // "saved" that hides why the Resume tab has no preview afterward.
      if (uploadFailed) toast.err('Resume details saved, but the file itself failed to upload — no preview will be available.')
      else toast.ok('Resume saved.')
    } catch (e) {
      toast.err(e)
    } finally {
      setBusy(false)
    }
  }

  async function handleText() {
    const t = text.trim()
    if (t.length < 40) {
      toast.err('A bit more, please.')
      return
    }
    setBusy(true)
    try {
      const parsed = await parseResume({ text: t, fileName: 'Pasted resume' })
      await onParsed({ ...parsed, resumeText: parsed.resumeText || t, resumeFileName: 'Pasted resume' })
      setPasting(false)
      setText('')
      toast.ok('Resume saved.')
    } catch (e) {
      toast.err(e)
    } finally {
      setBusy(false)
    }
  }

  const picker = (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPT}
      hidden
      onChange={(e) => {
        void handle(e.target.files?.[0])
        e.target.value = ''
      }}
    />
  )

  if (compact) {
    return (
      <>
        {picker}
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? <span className="spin" /> : <Icon name="upload" size={14} />}
          {busy ? 'Reading' : label}
        </button>
      </>
    )
  }

  if (pasting) {
    return (
      <div className="col gap3">
        <textarea
          className="textarea"
          style={{ minHeight: 170 }}
          autoFocus
          placeholder="Paste your resume"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="row gap3">
          <button className="btn btn-ghost grow" onClick={() => setPasting(false)} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary grow" onClick={handleText} disabled={busy}>
            {busy ? <span className="spin spin-dark" /> : <Icon name="spark" size={15} />}
            Save resume
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      {picker}
      <button
        className="card card-tap center"
        style={{
          borderStyle: 'dashed',
          borderColor: drag ? 'var(--mauve)' : undefined,
          background: drag ? 'var(--mauve-dim)' : undefined,
          padding: 'var(--s6) var(--s5)',
        }}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          void handle(e.dataTransfer.files?.[0])
        }}
      >
        <div className="center">
          {busy ? (
            <>
              <span className="spin" style={{ margin: '0 auto' }} />
              <div className="t-sm faint mt3">Reading</div>
            </>
          ) : (
            <>
              <Icon name="upload" size={24} className="faint" />
              <div className="t-section mt3">Drop a resume, or tap to pick</div>
              <div className="t-sm faint" style={{ marginTop: 3 }}>
                PDF, Word, or text
              </div>
            </>
          )}
        </div>
      </button>

      {!busy && (
        <button className="btn btn-bare btn-full mt3 t-sm" onClick={() => setPasting(true)}>
          or paste text
        </button>
      )}
    </>
  )
}
