import { useEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { Icon } from './Icon'

/**
 * PDF preview that actually works on a phone.
 *
 * iOS Safari will not render a PDF inside <object> or <iframe> — it shows a
 * blank box, or the first page as a cropped image with no way to scroll. The
 * only reliable route on mobile is rasterizing each page to a <canvas>
 * ourselves, which is what this does.
 */

GlobalWorkerOptions.workerSrc = workerUrl

// Rendering at the device pixel ratio keeps text sharp, but a 3x retina phone
// rendering a full page is a lot of pixels to hold; 2x is the sweet spot.
const MAX_DPR = 2

export default function PdfView({ src }: { src: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  const [pages, setPages] = useState(0)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    let doc: PDFDocumentProxy | null = null

    const task = getDocument({
      url: src,
      cMapUrl: '/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/pdfjs/standard_fonts/',
    })

    void (async () => {
      try {
        doc = await task.promise
        if (cancelled) return
        setPages(doc.numPages)

        const box = host.current
        if (!box) return
        const width = box.clientWidth
        if (!width) return

        const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
        box.replaceChildren()

        for (let n = 1; n <= doc.numPages; n++) {
          if (cancelled) return
          const page = await doc.getPage(n)
          const base = page.getViewport({ scale: 1 })
          const viewport = page.getViewport({ scale: width / base.width })

          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width * dpr)
          canvas.height = Math.floor(viewport.height * dpr)
          canvas.style.width = '100%'
          canvas.style.height = 'auto'
          canvas.style.display = 'block'
          canvas.style.borderRadius = 'var(--r2)'
          canvas.style.border = '1px solid var(--line)'
          canvas.style.background = '#ffffff'
          if (n > 1) canvas.style.marginTop = 'var(--s3)'

          const ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('Canvas is unavailable.')
          ctx.scale(dpr, dpr)

          await page.render({ canvas, viewport }).promise
          if (cancelled) return
          box.appendChild(canvas)
          setReady(true)
        }
      } catch (e) {
        if (!cancelled) setError((e as Error)?.message || 'Could not open the PDF.')
      }
    })()

    return () => {
      cancelled = true
      void task.destroy().catch(() => {})
    }
    // Re-rendering on resize would mean re-rasterizing every page on each
    // keyboard open or rotation; the canvases scale with CSS instead.
  }, [src])

  if (error) {
    return (
      <div className="col gap4" style={{ height: '100%', alignItems: 'center', justifyContent: 'center', padding: 'var(--s6)' }}>
        <Icon name="resume" size={26} className="faint" />
        <p className="t-sm faint center">{error}</p>
        <a className="btn btn-primary" href={src} target="_blank" rel="noreferrer">
          <Icon name="external" size={15} />
          Open resume
        </a>
      </div>
    )
  }

  return (
    <div
      style={{
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* margin: auto centers this vertically when it is shorter than the
          scroll container, and steps aside for normal top-to-bottom
          scrolling once it is taller — unlike justify-content: center,
          which would clip the top of a tall page. */}
      <div ref={host} style={{ width: '100%', margin: 'auto 0' }} />
      {!ready && (
        <div className="col gap3" style={{ alignItems: 'center', justifyContent: 'center', paddingTop: '35dvh' }}>
          <span className="spin" />
          <span className="t-sm faint">{pages ? `Rendering ${pages} page${pages === 1 ? '' : 's'}` : 'Opening'}</span>
        </div>
      )}
    </div>
  )
}
