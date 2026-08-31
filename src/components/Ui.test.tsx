import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Sheet } from './Ui'

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
})
