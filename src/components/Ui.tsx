import { useEffect, useState, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import { copyText } from '../lib/util'
import { useToast } from '../state/Toast'

/* ── sheet ───────────────────────────────────────────────── */

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean
  onClose(): void
  title?: string
  subtitle?: string
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    // Stop the page behind the sheet from scrolling under it on touch.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true">
      <div className="sheet">
        <div className="grabber" />
        {title && (
          <div className="mt2" style={{ marginBottom: 'var(--s5)' }}>
            <h2 className="sheet-title">{title}</h2>
            {subtitle && <p className="t-sm faint">{subtitle}</p>}
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

/* ── form field ──────────────────────────────────────────── */

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <span className="t-sm faint">{hint}</span>}
    </div>
  )
}

/* ── empty state ─────────────────────────────────────────── */

export function Empty({
  icon,
  title,
  body,
  action,
}: {
  icon: IconName
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: 16,
          background: 'var(--surface-2)',
          border: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto var(--s4)',
          color: 'var(--ink-3)',
        }}
      >
        <Icon name={icon} size={22} />
      </div>
      <div className="t-section" style={{ color: 'var(--ink)' }}>
        {title}
      </div>
      <p className="t-sm faint mt2" style={{ maxWidth: 300, margin: '6px auto 0' }}>
        {body}
      </p>
      {action && <div className="mt5">{action}</div>}
    </div>
  )
}

/* ── copy button ─────────────────────────────────────────── */

export function CopyButton({
  text,
  label = 'Copy',
  done = 'Copied',
  className = 'btn btn-ghost btn-sm',
  icon = true,
}: {
  text: string
  label?: string
  done?: string
  className?: string
  icon?: boolean
}) {
  const [hit, setHit] = useState(false)
  const toast = useToast()

  return (
    <button
      className={className}
      disabled={!text}
      onClick={async () => {
        if (await copyText(text)) {
          setHit(true)
          setTimeout(() => setHit(false), 1600)
        } else {
          toast.err('Could not reach the clipboard. Select the text and copy it manually.')
        }
      }}
    >
      {icon && <Icon name={hit ? 'check' : 'copy'} size={14} />}
      {hit ? done : label}
    </button>
  )
}

/* ── confirm ─────────────────────────────────────────────── */

export function Confirm({
  open,
  title,
  body,
  confirmLabel = 'Delete',
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  body: string
  confirmLabel?: string
  onConfirm(): void
  onClose(): void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <Sheet open={open} onClose={onClose} title={title} subtitle={body}>
      <div className="row gap3">
        <button className="btn btn-ghost grow" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          className="btn btn-danger grow"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onConfirm()
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? <span className="spin" /> : <Icon name="trash" size={14} />}
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  )
}

/* ── loading ─────────────────────────────────────────────── */

export function Loading({ label }: { label?: string }) {
  return (
    <div className="empty">
      <div className="row gap3" style={{ justifyContent: 'center' }}>
        <span className="spin" />
        <span className="t-sm faint">{label || 'Loading'}</span>
      </div>
    </div>
  )
}

export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="col gap3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="card">
          <div className="skel" style={{ height: 13, width: '52%' }} />
          <div className="skel mt3" style={{ height: 11, width: '78%' }} />
        </div>
      ))}
    </div>
  )
}

/* ── section heading ─────────────────────────────────────── */

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="between" style={{ marginBottom: 'var(--s3)' }}>
      <span className="t-label">{children}</span>
      {right}
    </div>
  )
}
