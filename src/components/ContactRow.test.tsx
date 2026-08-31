import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ContactRow } from './ContactRow'
import { deleteContact } from '../lib/db'
import { SWIPE_ACTION_WIDTH } from '../lib/useSwipeToDelete'
import type { Contact } from '../lib/types'

vi.mock('../lib/db', () => ({
  deleteContact: vi.fn(),
}))

vi.mock('../state/Auth', () => ({
  useAuth: () => ({ user: { uid: 'uid-1' } }),
}))

const toast = { ok: vi.fn(), err: vi.fn(), info: vi.fn() }
vi.mock('../state/Toast', () => ({
  useToast: () => toast,
}))

const baseContact: Contact = {
  id: 'contact-1',
  name: 'Ada Lovelace',
  company: 'Analytical Engines Inc',
  priority: 'Medium',
  status: 'Needs follow-up',
  createdAt: '2026-01-01T00:00:00.000Z',
}

function renderRow(overrides: Partial<Contact> = {}) {
  render(
    <MemoryRouter>
      <ContactRow c={{ ...baseContact, ...overrides }} eventId="event-1" />
    </MemoryRouter>,
  )
}

function getRow(): HTMLElement {
  return screen.getByText('Ada Lovelace').closest('a')!
}

/** `.swipe-action` is legitimately `aria-hidden` while closed, so it must be
 *  queried directly rather than through `getByRole` (which excludes it). */
function getAction(): HTMLElement {
  return document.querySelector('.swipe-action')!
}

/**
 * Drags the row left by `dx` px and releases — then fires the trailing
 * `click` a real browser still dispatches after a drag's pointerup, exactly
 * as it would past a real touch/mouse drag. The hook swallows that one
 * internally, so by the time `swipe()` returns the row is ready for a
 * genuinely separate tap (see the "closes it instead of navigating" test).
 */
function swipe(row: HTMLElement, dx: number) {
  fireEvent.pointerDown(row, { pointerId: 1, button: 0, clientX: 200, clientY: 0 })
  fireEvent.pointerMove(row, { pointerId: 1, clientX: 200 + dx, clientY: 0 })
  fireEvent.pointerUp(row, { pointerId: 1, clientX: 200 + dx, clientY: 0 })
  fireEvent.click(row)
}

/** Flushes the microtask queue so an awaited `deleteContact()` and the
 *  state updates that follow it land before assertions run. */
async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ContactRow — swipe to delete', () => {
  it('renders the contact with the delete action not revealed', () => {
    renderRow()
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    const action = getAction()
    expect(action).toHaveAttribute('aria-hidden', 'true')
    expect(action).toHaveAttribute('tabindex', '-1')
  })

  it('a plain tap does not reveal or open anything, and does not delete', () => {
    renderRow()
    const row = getRow()
    fireEvent.pointerDown(row, { pointerId: 1, button: 0, clientX: 200, clientY: 0 })
    fireEvent.pointerUp(row, { pointerId: 1, clientX: 200, clientY: 0 })
    expect(screen.queryByText('Delete Ada Lovelace?')).not.toBeInTheDocument()
    expect(deleteContact).not.toHaveBeenCalled()
  })

  it('a leftward swipe past halfway reveals the delete action and moves the card', () => {
    renderRow()
    swipe(getRow(), -SWIPE_ACTION_WIDTH)

    expect(getAction()).toHaveAttribute('aria-hidden', 'false')
    expect(getRow().style.transform).toContain(`-${SWIPE_ACTION_WIDTH}px`)
  })

  it('a short swipe (less than halfway) springs back closed', () => {
    renderRow()
    swipe(getRow(), -(SWIPE_ACTION_WIDTH * 0.2))

    expect(getAction()).toHaveAttribute('aria-hidden', 'true')
    expect(getRow().style.transform).toContain('0px')
  })

  it('tapping the row while the action is revealed closes it instead of navigating', () => {
    renderRow()
    const row = getRow()
    swipe(row, -SWIPE_ACTION_WIDTH) // includes the drag's own (swallowed) trailing click
    expect(getAction()).toHaveAttribute('aria-hidden', 'false')

    // A separate, later tap — no drag behind this one.
    fireEvent.click(row)
    expect(getAction()).toHaveAttribute('aria-hidden', 'true')
  })

  it('tapping the revealed delete action opens the confirmation naming the contact', () => {
    renderRow()
    swipe(getRow(), -SWIPE_ACTION_WIDTH)

    fireEvent.click(getAction())

    expect(screen.getByText('Delete Ada Lovelace?')).toBeInTheDocument()
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument()
  })

  it('canceling the confirmation leaves the contact untouched', async () => {
    renderRow()
    swipe(getRow(), -SWIPE_ACTION_WIDTH)
    fireEvent.click(getAction())

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await flush()

    expect(screen.queryByText('Delete Ada Lovelace?')).not.toBeInTheDocument()
    expect(deleteContact).not.toHaveBeenCalled()
  })

  it('confirming deletes the contact from the database and shows a success toast', async () => {
    vi.mocked(deleteContact).mockResolvedValueOnce(undefined)
    renderRow({ id: 'contact-42' })
    swipe(getRow(), -SWIPE_ACTION_WIDTH)
    fireEvent.click(getAction())

    fireEvent.click(screen.getByRole('dialog').querySelector('.btn-danger')!)
    await flush()

    expect(deleteContact).toHaveBeenCalledTimes(1)
    expect(deleteContact).toHaveBeenCalledWith('uid-1', 'event-1', 'contact-42')
    expect(toast.ok).toHaveBeenCalledWith('Contact deleted.')
    expect(screen.queryByText('Delete Ada Lovelace?')).not.toBeInTheDocument()
  })

  it('leaves the confirmation open and toasts an error if the delete fails', async () => {
    vi.mocked(deleteContact).mockRejectedValueOnce(new Error('offline'))
    renderRow()
    swipe(getRow(), -SWIPE_ACTION_WIDTH)
    fireEvent.click(getAction())
    fireEvent.click(screen.getByRole('dialog').querySelector('.btn-danger')!)
    await flush()

    expect(toast.err).toHaveBeenCalled()
    expect(toast.ok).not.toHaveBeenCalled()
    expect(screen.getByText('Delete Ada Lovelace?')).toBeInTheDocument()
  })

  it('a mostly-vertical drag (scrolling) does not reveal the delete action', () => {
    renderRow()
    const row = getRow()
    fireEvent.pointerDown(row, { pointerId: 1, button: 0, clientX: 200, clientY: 100 })
    fireEvent.pointerMove(row, { pointerId: 1, clientX: 190, clientY: 160 })
    fireEvent.pointerUp(row, { pointerId: 1, clientX: 190, clientY: 160 })

    expect(getAction()).toHaveAttribute('aria-hidden', 'true')
  })
})
