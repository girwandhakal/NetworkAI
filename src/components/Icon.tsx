/** Inline stroke icons — no icon dependency, and they inherit currentColor. */

export type IconName =
  | 'events'
  | 'people'
  | 'mail'
  | 'link'
  | 'resume'
  | 'user'
  | 'plus'
  | 'mic'
  | 'camera'
  | 'left'
  | 'right'
  | 'check'
  | 'copy'
  | 'trash'
  | 'pencil'
  | 'refresh'
  | 'send'
  | 'x'
  | 'search'
  | 'spark'
  | 'phone'
  | 'globe'
  | 'alert'
  | 'logout'
  | 'external'
  | 'stop'
  | 'text'
  | 'upload'
  | 'clock'

const P: Record<IconName, JSX.Element> = {
  events: (
    <>
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
      <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.6 20a6.6 6.6 0 0 1 12.8 0" />
      <path d="M16.2 5.4a3.2 3.2 0 0 1 0 5.9M18 13.6a6.4 6.4 0 0 1 3.4 5" />
    </>
  ),
  mail: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="m3.5 7.5 7.3 5.2a2 2 0 0 0 2.4 0l7.3-5.2" />
    </>
  ),
  link: (
    <>
      <path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 1 0-5.7-5.7L11.8 6.5" />
      <path d="M13.5 10.5a4 4 0 0 0-5.7 0L5 13.3a4 4 0 1 0 5.7 5.7l1.4-1.4" />
    </>
  ),
  resume: (
    <>
      <path d="M14 2.6H7a2.4 2.4 0 0 0-2.4 2.4v14a2.4 2.4 0 0 0 2.4 2.4h10a2.4 2.4 0 0 0 2.4-2.4V8z" />
      <path d="M14 2.6V8h5.4M8.6 12.6h6.8M8.6 16.4h4.6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.6 20.4a7.4 7.4 0 0 1 14.8 0" />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  mic: (
    <>
      <rect x="9" y="2.6" width="6" height="11.4" rx="3" />
      <path d="M5.5 11.2a6.5 6.5 0 0 0 13 0M12 17.8v3.6" />
    </>
  ),
  camera: (
    <>
      <path d="M2.8 8.6A2 2 0 0 1 4.8 6.6h1.9l1.3-2.2h8l1.3 2.2h1.9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4.8a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="13" r="3.6" />
    </>
  ),
  left: <path d="M14.5 5 8 12l6.5 7" />,
  right: <path d="M9.5 5 16 12l-6.5 7" />,
  check: <path d="M4.8 12.6 9.4 17 19.2 6.8" />,
  copy: (
    <>
      <rect x="8.6" y="8.6" width="11.8" height="11.8" rx="2.2" />
      <path d="M15.4 5.6v-.8a2.2 2.2 0 0 0-2.2-2.2H5.8a2.2 2.2 0 0 0-2.2 2.2v7.4a2.2 2.2 0 0 0 2.2 2.2h.8" />
    </>
  ),
  trash: (
    <>
      <path d="M3.8 6.4h16.4M9 6.4V4.6a1.6 1.6 0 0 1 1.6-1.6h2.8A1.6 1.6 0 0 1 15 4.6v1.8" />
      <path d="M5.8 6.4 6.8 20a1.6 1.6 0 0 0 1.6 1.5h7.2a1.6 1.6 0 0 0 1.6-1.5l1-13.6" />
    </>
  ),
  pencil: (
    <>
      <path d="M16.4 3.4a2.4 2.4 0 0 1 3.4 3.4L7.6 19H4.2v-3.4z" />
      <path d="M14.6 5.2 18 8.6" />
    </>
  ),
  refresh: (
    <>
      <path d="M20.4 12a8.4 8.4 0 1 1-2.6-6.1" />
      <path d="M20.6 3.6v5.2h-5.2" />
    </>
  ),
  send: <path d="M21 3.4 10.6 13.8M21 3.4l-6.6 18-3.8-7.6-7.6-3.8z" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.8" />
      <path d="m16 16 4.6 4.6" />
    </>
  ),
  spark: (
    <>
      <path d="M12 2.6 13.9 9 20.4 11l-6.5 2-1.9 6.4-1.9-6.4L3.6 11 10.1 9z" />
      <path d="M18.6 16.4 19.4 19l2.6.8-2.6.8-.8 2.6" opacity=".55" />
    </>
  ),
  phone: (
    <path d="M21 16.4v2.8a1.9 1.9 0 0 1-2.1 1.9 18.7 18.7 0 0 1-8.1-2.9 18.3 18.3 0 0 1-5.6-5.6A18.7 18.7 0 0 1 2.3 4.4 1.9 1.9 0 0 1 4.2 2.3H7a1.9 1.9 0 0 1 1.9 1.6c.1 1 .35 1.9.7 2.8a1.9 1.9 0 0 1-.4 2L8 9.9a15 15 0 0 0 5.6 5.6l1.2-1.2a1.9 1.9 0 0 1 2-.4c.9.35 1.8.6 2.8.7A1.9 1.9 0 0 1 21 16.4z" />
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9.2" />
      <path d="M2.8 12h18.4M12 2.8a15 15 0 0 1 0 18.4 15 15 0 0 1 0-18.4" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 3.6 2.4 17.2A1.9 1.9 0 0 0 4 20.1h16a1.9 1.9 0 0 0 1.6-2.9L13.7 3.6a1.9 1.9 0 0 0-3.4 0z" />
      <path d="M12 9.4v4M12 16.8h.01" />
    </>
  ),
  logout: (
    <>
      <path d="M9.4 21H5.2A2.2 2.2 0 0 1 3 18.8V5.2A2.2 2.2 0 0 1 5.2 3h4.2" />
      <path d="M15.8 16.6 20.4 12l-4.6-4.6M20.4 12H9.4" />
    </>
  ),
  external: (
    <>
      <path d="M13.4 3.6h7v7" />
      <path d="M20.4 3.6 11 13" />
      <path d="M18.4 14v5.4a2 2 0 0 1-2 2H4.6a2 2 0 0 1-2-2V7.6a2 2 0 0 1 2-2H10" />
    </>
  ),
  stop: <rect x="6.4" y="6.4" width="11.2" height="11.2" rx="2.2" />,
  text: <path d="M4.6 6.6h14.8M4.6 12h14.8M4.6 17.4h9.4" />,
  upload: (
    <>
      <path d="M21 15.4v3.4a2.2 2.2 0 0 1-2.2 2.2H5.2A2.2 2.2 0 0 1 3 18.8v-3.4" />
      <path d="M7.4 8.4 12 3.8l4.6 4.6M12 3.8v11.6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9.2" />
      <path d="M12 6.8V12l3.4 2" />
    </>
  ),
}

const FILLED: IconName[] = ['send', 'spark', 'phone', 'stop']

export function Icon({
  name,
  size = 20,
  className,
  strokeWidth,
}: {
  name: IconName
  size?: number
  className?: string
  strokeWidth?: number
}) {
  const filled = FILLED.includes(name)
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth ?? 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {P[name]}
    </svg>
  )
}
