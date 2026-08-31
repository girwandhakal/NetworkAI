import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * db.ts talks to Firestore through the modular SDK's free functions
 * (`doc`, `writeBatch`, `increment`, ...) rather than methods on a client
 * object, so mocking the SDK module is what lets us assert on the exact
 * writes a delete performs without a real Firebase project.
 */
const batch = {
  delete: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
  commit: vi.fn(() => Promise.resolve()),
}

const docRef = vi.fn((...segments: unknown[]) => ({ path: segments.slice(1).join('/') }))

// db.ts's own `./firebase` reads real env config and, if present, would spin
// up an actual Firestore client with IndexedDB persistence — neither exists
// nor is wanted in this test environment. Swap in a stand-in `db` handle;
// the mocked `firebase/firestore` functions below never actually touch it.
const FAKE_DB = { __fakeDb: true }
vi.mock('./firebase', () => ({ db: FAKE_DB }))

vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => docRef(...args),
  collection: vi.fn((...segments: unknown[]) => ({ path: segments.slice(1).join('/') })),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  increment: vi.fn((n: number) => ({ __increment: n })),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  writeBatch: vi.fn(() => batch),
}))

beforeEach(() => {
  vi.clearAllMocks()
  batch.commit.mockResolvedValue(undefined)
  localStorage.clear() // keeps isDemo() false, so db.ts resolves to the real Firestore path
})

describe('deleteContact (real Firestore path)', () => {
  it('deletes the contact document and decrements the event\'s contact counter, in one batch', async () => {
    const { deleteContact } = await import('./db')

    await deleteContact('uid-1', 'event-1', 'contact-1')
    // deleteContact fires the write without awaiting Firestore's ack (see
    // fireAndForget) — give its promise chain a tick to run.
    await Promise.resolve()
    await Promise.resolve()

    expect(docRef).toHaveBeenCalledWith(FAKE_DB, 'users', 'uid-1', 'events', 'event-1', 'contacts', 'contact-1')
    expect(docRef).toHaveBeenCalledWith(FAKE_DB, 'users', 'uid-1', 'events', 'event-1')

    expect(batch.delete).toHaveBeenCalledTimes(1)
    expect(batch.delete).toHaveBeenCalledWith({ path: 'users/uid-1/events/event-1/contacts/contact-1' })

    expect(batch.set).toHaveBeenCalledTimes(1)
    expect(batch.set).toHaveBeenCalledWith(
      { path: 'users/uid-1/events/event-1' },
      { contactCount: { __increment: -1 } },
      { merge: true },
    )

    expect(batch.commit).toHaveBeenCalledTimes(1)
  })

  it('reports (rather than throwing out of) a failed delete, so an offline caller does not hang', async () => {
    const { deleteContact } = await import('./db')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    batch.commit.mockRejectedValueOnce(new Error('network unavailable'))

    // deleteContact does not await the commit — it resolves immediately either way.
    await expect(deleteContact('uid-1', 'event-1', 'contact-1')).resolves.toBeUndefined()
    await Promise.resolve()
    await Promise.resolve()

    expect(spy).toHaveBeenCalledWith('Firestore write failed (delete contact):', expect.any(Error))
    spy.mockRestore()
  })
})
