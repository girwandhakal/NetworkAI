import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * demo.ts keeps its store in a module-level variable seeded from
 * localStorage at import time, so each test gets a clean slate by clearing
 * storage and re-importing the module fresh.
 */
beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

describe('demoDb.deleteContact', () => {
  it('removes the contact and decrements the event contact count', async () => {
    const { demoDb } = await import('./demo')
    const uid = 'demo-user'

    const eventId = await demoDb.createEvent(uid, { name: 'Spring Career Fair', date: '2026-02-10' })
    const keepId = await demoDb.createContact(uid, eventId, { name: 'Alan Turing' })
    const dropId = await demoDb.createContact(uid, eventId, { name: 'Ada Lovelace' })

    await demoDb.deleteContact(uid, eventId, dropId)

    const contacts = await once<import('./types').Contact[]>((cb) => demoDb.watchContacts(uid, eventId, cb))
    expect(contacts.map((c) => c.id)).toEqual([keepId])

    const event = await once<import('./types').EventRec | null>((cb) => demoDb.watchEvent(uid, eventId, cb))
    expect(event?.contactCount).toBe(1)
  })

  it('is a no-op for an id that is not there', async () => {
    const { demoDb } = await import('./demo')
    const uid = 'demo-user'
    const eventId = await demoDb.createEvent(uid, { name: 'Fall Career Fair', date: '2026-09-01' })
    await demoDb.createContact(uid, eventId, { name: 'Grace Hopper' })

    await demoDb.deleteContact(uid, eventId, 'does-not-exist')

    const contacts = await once<import('./types').Contact[]>((cb) => demoDb.watchContacts(uid, eventId, cb))
    expect(contacts).toHaveLength(1)
  })
})

/** watch()-style APIs fire once, async — resolve with that first value. */
function once<T>(subscribe: (cb: (value: T) => void) => () => void): Promise<T> {
  return new Promise((resolve) => {
    const stop = subscribe((value) => {
      stop()
      resolve(value)
    })
  })
}
