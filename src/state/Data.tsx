import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Unsubscribe } from 'firebase/firestore'
import { watchContacts, watchEvents } from '../lib/db'
import { subscribe as subscribeQueue, drain } from '../lib/queue'
import { useAuth } from './Auth'
import type { Contact, EventRec } from '../lib/types'

export interface ContactWithEvent extends Contact {
  eventId: string
  eventName: string
}

interface Ctx {
  events: EventRec[]
  /** Every contact across every event, for the follow-up queues. */
  all: ContactWithEvent[]
  byEvent: Record<string, Contact[]>
  loading: boolean
  error: string
  online: boolean
  queued: number
  processing: boolean
}

const DataCtx = createContext<Ctx>({
  events: [],
  all: [],
  byEvent: {},
  loading: true,
  error: '',
  online: true,
  queued: 0,
  processing: false,
})

export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const uid = user?.uid || ''

  const [events, setEvents] = useState<EventRec[]>([])
  const [byEvent, setByEvent] = useState<Record<string, Contact[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [online, setOnline] = useState(navigator.onLine)
  const [queued, setQueued] = useState(0)
  const [processing, setProcessing] = useState(false)

  const subs = useRef<Record<string, Unsubscribe>>({})

  /* events */
  useEffect(() => {
    if (!uid) {
      setEvents([])
      setByEvent({})
      setLoading(false)
      return
    }
    setLoading(true)
    const stop = watchEvents(
      uid,
      (list) => {
        setEvents(list)
        setLoading(false)
        setError('')
      },
      (e) => {
        setError(e.message || 'Could not load your events.')
        setLoading(false)
      },
    )
    return () => {
      stop()
      Object.values(subs.current).forEach((fn) => fn())
      subs.current = {}
    }
  }, [uid])

  /* one contacts listener per event, added and torn down as events change */
  useEffect(() => {
    if (!uid) return
    const live = new Set(events.map((e) => e.id))

    for (const id of Object.keys(subs.current)) {
      if (!live.has(id)) {
        subs.current[id]()
        delete subs.current[id]
        setByEvent((prev) => {
          const next = { ...prev }
          delete next[id]
          return next
        })
      }
    }

    for (const ev of events) {
      if (subs.current[ev.id]) continue
      subs.current[ev.id] = watchContacts(uid, ev.id, (list) => {
        setByEvent((prev) => ({ ...prev, [ev.id]: list }))
      })
    }
  }, [uid, events])

  /* connectivity + offline queue depth */
  useEffect(() => {
    const on = () => {
      setOnline(true)
      void drain()
    }
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    const stop = subscribeQueue(({ pending, running }) => {
      setQueued(pending)
      setProcessing(running)
    })
    void drain()
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      stop()
    }
  }, [])

  const all = useMemo<ContactWithEvent[]>(() => {
    const names = new Map(events.map((e) => [e.id, e.name]))
    return events.flatMap((ev) =>
      (byEvent[ev.id] || []).map((c) => ({ ...c, eventId: ev.id, eventName: names.get(ev.id) || '' })),
    )
  }, [events, byEvent])

  const value = useMemo<Ctx>(
    () => ({ events, all, byEvent, loading, error, online, queued, processing }),
    [events, all, byEvent, loading, error, online, queued, processing],
  )

  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>
}

export function useData(): Ctx {
  return useContext(DataCtx)
}
