import type { Contact, Status } from './types'

export function todayISO(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Dates are stored as plain "YYYY-MM-DD"; parse as local, not UTC, so the day never shifts. */
function localDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

export function formatDate(iso: string): string {
  const d = localDate(iso)
  if (!d) return iso || ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatDay(iso: string): string {
  const d = localDate(iso)
  if (!d) return ''
  return d.toLocaleDateString(undefined, { weekday: 'long' })
}

export function relativeDay(iso: string): string {
  const d = localDate(iso)
  if (!d) return ''
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((d.getTime() - today.getTime()) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  if (days > 1 && days < 14) return `In ${days} days`
  if (days < -1 && days > -14) return `${-days} days ago`
  return ''
}

export function timeAgo(iso?: string): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const secs = Math.round((Date.now() - then) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 7) return `${days}d ago`
  return formatDate(iso.slice(0, 10))
}

export function clock(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function initials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '·'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Clipboard API needs a secure context; fall back for plain-http dev hosts.
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

export function normalizeUrl(url: string): string {
  const s = (url || '').trim()
  if (!s) return ''
  return /^https?:\/\//i.test(s) ? s : `https://${s}`
}

export function linkedinSearchUrl(c: Contact): string {
  if (c.linkedin) return normalizeUrl(c.linkedin)
  const q = [c.name, c.company].filter(Boolean).join(' ')
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`
}

export function isEmail(s?: string): boolean {
  return Boolean(s && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim()))
}

export const STATUS_STYLE: Record<Status, string> = {
  'Needs follow-up': 'chip-warn',
  'Draft ready': 'chip-accent',
  'Waiting for response': 'chip',
  Replied: 'chip-good',
  'No action needed': 'chip',
}

/** Sort for the contact feed: unfinished and high-value first, then most recent. */
export function feedSort(a: Contact, b: Contact): number {
  const rank = (c: Contact) => {
    const p = c.priority === 'High' ? 0 : c.priority === 'Medium' ? 1 : 2
    const s = c.status === 'Needs follow-up' ? 0 : c.status === 'Draft ready' ? 1 : 2
    return s * 3 + p
  }
  const d = rank(a) - rank(b)
  if (d !== 0) return d
  return (b.createdAt || '').localeCompare(a.createdAt || '')
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** A short client-generated id — good enough for a Storage object name or a
 *  context-item id, where uniqueness only has to hold within one contact. */
export function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
