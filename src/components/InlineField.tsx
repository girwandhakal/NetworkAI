import { useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from './Icon'
import { normalizeUrl } from '../lib/util'

/**
 * A value that reads as text until you tap it. Saves on blur, so the user can
 * fix a bad OCR field without ever entering an "edit mode".
 */
export function InlineField({
  value,
  onSave,
  placeholder,
  label,
  icon,
  href,
  multiline,
  big,
}: {
  value: string
  onSave(v: string): Promise<void> | void
  placeholder: string
  label?: string
  icon?: IconName
  /** 'mailto' | 'tel' | 'url' — renders a launch button when there is a value. */
  href?: 'mailto' | 'tel' | 'url'
  multiline?: boolean
  big?: boolean
}) {
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const dirty = useRef(false)
  const area = useRef<HTMLTextAreaElement>(null)

  // Adopt external updates (the AI backfilling a field) unless mid-edit.
  useEffect(() => {
    if (!dirty.current) setDraft(value)
  }, [value])

  // Grow to fit the content — a wrapped email draft has far more visual lines
  // than newlines, so a row count would cut it off.
  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft, multiline])

  async function commit() {
    const next = draft.trim()
    dirty.current = false
    if (next === (value || '').trim()) return
    setSaving(true)
    try {
      await onSave(next)
    } finally {
      setSaving(false)
    }
  }

  const style = big
    ? { fontFamily: 'var(--f-display)', fontSize: 24, fontWeight: 700, letterSpacing: '-0.014em', lineHeight: 1.2 }
    : undefined

  const link =
    href && value
      ? href === 'mailto'
        ? `mailto:${value}`
        : href === 'tel'
          ? `tel:${value.replace(/[^\d+]/g, '')}`
          : normalizeUrl(value)
      : ''

  return (
    <div className="row-t gap2">
      {icon && (
        <span className="faint" style={{ paddingTop: 7, flex: 'none' }}>
          <Icon name={icon} size={15} />
        </span>
      )}
      <div className="grow" style={{ minWidth: 0 }}>
        {label && <div className="t-label" style={{ marginBottom: 2 }}>{label}</div>}
        {multiline ? (
          <textarea
            ref={area}
            className="inline-edit"
            rows={1}
            value={draft}
            placeholder={placeholder}
            style={{ resize: 'none', overflow: 'hidden', display: 'block' }}
            onChange={(e) => {
              dirty.current = true
              setDraft(e.target.value)
            }}
            onBlur={commit}
          />
        ) : (
          <input
            className="inline-edit"
            value={draft}
            placeholder={placeholder}
            style={style}
            onChange={(e) => {
              dirty.current = true
              setDraft(e.target.value)
            }}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        )}
      </div>
      {saving && <span className="spin" style={{ marginTop: 8 }} />}
      {!saving && link && (
        <a className="btn-icon" href={link} target="_blank" rel="noreferrer" aria-label={`Open ${label || placeholder}`} style={{ marginTop: label ? 12 : 0 }}>
          <Icon name={href === 'mailto' ? 'mail' : href === 'tel' ? 'phone' : 'external'} size={14} />
        </a>
      )}
    </div>
  )
}
