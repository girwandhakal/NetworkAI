import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Confirm, Sheet } from './Ui'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * A sheet very often opens from the same tap/click that also, moments
 * later, delivers a browser-synthesized compatibility event (touch's
 * mousedown/click) at those same screen coordinates — which the newly
 * mounted scrim now covers. Without a grace window, that stray event reads
 * as "tapped the backdrop" and the sheet closes itself the instant it opens.
 */
describe('Sheet — backdrop dismiss', () => {
  it('ignores a backdrop mousedown that lands immediately after opening', () => {
    const onClose = vi.fn()
    render(
      <Sheet open onClose={onClose} title="Delete this?">
        <p>content</p>
      </Sheet>,
    )

    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('still dismisses on a genuine backdrop tap once the grace window has passed', () => {
    const onClose = vi.fn()
    render(
      <Sheet open onClose={onClose} title="Delete this?">
        <p>content</p>
      </Sheet>,
    )

    vi.advanceTimersByTime(400)
    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('never dismisses from a mousedown on the sheet content itself, grace window or not', () => {
    const onClose = vi.fn()
    render(
      <Sheet open onClose={onClose} title="Delete this?">
        <p>content</p>
      </Sheet>,
    )

    vi.advanceTimersByTime(400)
    fireEvent.mouseDown(screen.getByText('Delete this?'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('resets the grace window each time the sheet re-opens', () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <Sheet open={false} onClose={onClose} title="Delete this?">
        <p>content</p>
      </Sheet>,
    )

    vi.advanceTimersByTime(10_000) // long before this particular open
    rerender(
      <Sheet open onClose={onClose} title="Delete this?">
        <p>content</p>
      </Sheet>,
    )

    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it("the window is short enough that a person's own deliberate quick dismiss still works", () => {
    // A plain-click-opened sheet (no preceding drag/gesture) with no stray
    // compat event to guard against — a real second tap arriving well within
    // human reaction time (150ms) must still close it.
    const onClose = vi.fn()
    render(
      <Sheet open onClose={onClose} title="Sign out?">
        <p>content</p>
      </Sheet>,
    )

    vi.advanceTimersByTime(150)
    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('Confirm — double-submission guard', () => {
  it('does not call onConfirm twice for two pointerups landing before `busy` commits', async () => {
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 50)))
    render(<Confirm open title="Delete this?" body="Cannot be undone." onConfirm={onConfirm} onClose={vi.fn()} />)

    const deleteBtn = screen.getByRole('button', { name: /Delete/ })
    // Two full tap gestures back to back, before React has a chance to
    // commit the `disabled` attribute driven by `busy` — the native
    // disabled-suppresses-click protection this replaced doesn't apply to a
    // raw pointerup.
    fireEvent.pointerDown(deleteBtn)
    fireEvent.pointerUp(deleteBtn)
    fireEvent.pointerDown(deleteBtn)
    fireEvent.pointerUp(deleteBtn)

    expect(onConfirm).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(50)
      await Promise.resolve()
    })
  })

  it('ignores Cancel while a confirm is in flight', async () => {
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 50)))
    const onClose = vi.fn()
    render(<Confirm open title="Delete this?" body="Cannot be undone." onConfirm={onConfirm} onClose={onClose} />)

    const deleteBtn = screen.getByRole('button', { name: /Delete/ })
    fireEvent.pointerDown(deleteBtn)
    fireEvent.pointerUp(deleteBtn)

    const cancelBtn = screen.getByRole('button', { name: 'Cancel' })
    fireEvent.pointerDown(cancelBtn)
    fireEvent.pointerUp(cancelBtn)

    expect(onClose).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(50)
      await Promise.resolve()
    })
  })
})
