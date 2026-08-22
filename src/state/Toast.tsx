import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon } from '../components/Icon'

type Kind = 'ok' | 'err' | 'info'
interface Item {
  id: number
  kind: Kind
  text: string
}

interface Ctx {
  ok(text: string): void
  err(text: unknown): void
  info(text: string): void
}

const ToastCtx = createContext<Ctx | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([])
  const seq = useRef(0)

  const push = useCallback((kind: Kind, text: string) => {
    if (!text) return
    const id = ++seq.current
    setItems((prev) => [...prev.slice(-2), { id, kind, text }])
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), kind === 'err' ? 6000 : 3000)
  }, [])

  const api = useMemo<Ctx>(
    () => ({
      ok: (t) => push('ok', t),
      info: (t) => push('info', t),
      err: (e) => push('err', e instanceof Error ? e.message : String(e || 'Something went wrong.')),
    }),
    [push],
  )

  return (
    <ToastCtx.Provider value={api}>
      {children}
      {items.length > 0 && (
        <div className="toasts" role="status" aria-live="polite">
          {items.map((t) => (
            <div key={t.id} className={`toast toast-${t.kind}`}>
              <Icon name={t.kind === 'ok' ? 'check' : t.kind === 'err' ? 'alert' : 'spark'} size={15} />
              <span className="grow">{t.text}</span>
              <button className="btn-bare" style={{ padding: 0, minHeight: 0 }} onClick={() => setItems((p) => p.filter((x) => x.id !== t.id))} aria-label="Dismiss">
                <Icon name="x" size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </ToastCtx.Provider>
  )
}

export function useToast(): Ctx {
  const ctx = useContext(ToastCtx)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
