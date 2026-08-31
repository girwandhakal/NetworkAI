import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react'

/** Width of the revealed action, in px. `.swipe-action` in global.css must match. */
export const SWIPE_ACTION_WIDTH = 76

/** Movement below this reads as a tap; past it, the gesture commits to an axis. */
const DRAG_TOLERANCE = 8

/** Only one row stays open at a time — opening a new one closes whichever
 *  was open, the way a swipe-list on iOS or Android behaves. */
let openRow: (() => void) | null = null

export interface SwipeHandlers {
  onPointerDown(e: ReactPointerEvent): void
  onPointerMove(e: ReactPointerEvent): void
  onPointerUp(e: ReactPointerEvent): void
  onPointerCancel(e: ReactPointerEvent): void
  onClick(e: ReactMouseEvent): void
}

/**
 * Swipe-left-to-reveal-delete for a list row that's otherwise a plain
 * `<Link>` (or any tappable element). A long-press on an anchor fights the
 * browser's own touch UI — iOS's link-preview callout, Android's
 * copy/select menu — in ways CSS can't reliably suppress; a horizontal drag
 * doesn't trigger either, which is why this (Apple Mail's pattern, and
 * Android's) is the standard mobile answer for "delete this row" instead.
 *
 * Attach `handlers` to the tappable element and drive its `transform` with
 * `offset` (translateX, in px, always <= 0). `dragging` says whether a live
 * drag is in progress — suspend that element's transform transition while
 * it's true so the row tracks the finger 1:1, then let the transition take
 * over for the snap open/closed. `open` is whether the action is fully
 * revealed; render the actual delete button separately (behind the row,
 * inside the same clipped wrapper) and call `close()` after it's tapped.
 */
export function useSwipeToDelete(actionWidth: number = SWIPE_ACTION_WIDTH): {
  offset: number
  open: boolean
  dragging: boolean
  close(): void
  handlers: SwipeHandlers
} {
  const [offset, setOffset] = useState(0)
  const [open, setOpen] = useState(false)
  const [dragging, setDragging] = useState(false)

  const offsetRef = useRef(0)
  const start = useRef<{ x: number; y: number; offset: number } | null>(null)
  const axis = useRef<'x' | 'y' | null>(null)
  const activePointer = useRef<number | null>(null)
  // Did this gesture move enough to count as a drag? If so, the click that
  // the eventual pointerup still fires needs to be swallowed.
  const dragged = useRef(false)

  const setOffsetBoth = useCallback((v: number) => {
    offsetRef.current = v
    setOffset(v)
  }, [])

  const close = useCallback(() => {
    setOffsetBoth(0)
    setOpen(false)
  }, [setOffsetBoth])

  // Register/unregister this row as "the one that's open" so a swipe
  // elsewhere closes it first.
  useEffect(() => {
    if (open) {
      if (openRow && openRow !== close) openRow()
      openRow = close
    } else if (openRow === close) {
      openRow = null
    }
    return () => {
      if (openRow === close) openRow = null
    }
  }, [open, close])

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    if (e.button !== 0) return
    // A second finger landing on the same row mid-drag must not hijack the
    // gesture already in progress under a different pointer.
    if (activePointer.current !== null && activePointer.current !== e.pointerId) return
    start.current = { x: e.clientX, y: e.clientY, offset: offsetRef.current }
    axis.current = null
    activePointer.current = e.pointerId
    dragged.current = false
  }, [])

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!start.current || e.pointerId !== activePointer.current) return
      const dx = e.clientX - start.current.x
      const dy = e.clientY - start.current.y

      if (axis.current === null) {
        if (Math.abs(dx) < DRAG_TOLERANCE && Math.abs(dy) < DRAG_TOLERANCE) return
        axis.current = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
        if (axis.current === 'x') {
          e.currentTarget.setPointerCapture(e.pointerId)
          setDragging(true)
          dragged.current = true
        }
      }
      // A vertical drag is a scroll — leave it to the page and touch (dz).
      if (axis.current !== 'x') return

      e.preventDefault()
      setOffsetBoth(Math.min(0, Math.max(-actionWidth, start.current.offset + dx)))
    },
    [actionWidth, setOffsetBoth],
  )

  const endDrag = useCallback(
    (e: ReactPointerEvent) => {
      // Ignore a stray up/cancel from a pointer that isn't the one this
      // gesture is actually tracking (e.g. a second finger resting nearby).
      if (e.pointerId !== activePointer.current) return
      if (axis.current === 'x') {
        const shouldOpen = offsetRef.current <= -actionWidth / 2
        setOffsetBoth(shouldOpen ? -actionWidth : 0)
        setOpen(shouldOpen)
        // Pointer capture is *supposed* to release implicitly on pointerup —
        // release it explicitly too. Left dangling, it can make the very next,
        // unrelated tap (e.g. on the just-revealed delete button) fail to
        // produce a click at all.
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId)
        }
      }
      setDragging(false)
      start.current = null
      axis.current = null
      activePointer.current = null
    },
    [actionWidth, setOffsetBoth],
  )

  const onPointerUp = useCallback((e: ReactPointerEvent) => endDrag(e), [endDrag])
  const onPointerCancel = useCallback((e: ReactPointerEvent) => endDrag(e), [endDrag])

  const onClick = useCallback(
    (e: ReactMouseEvent) => {
      if (dragged.current) {
        e.preventDefault()
        e.stopPropagation()
        dragged.current = false
        return
      }
      if (open) {
        // Tapping the row while its delete action is showing closes the
        // reveal instead of also navigating — matches iOS Mail.
        e.preventDefault()
        e.stopPropagation()
        close()
      }
    },
    [open, close],
  )

  return { offset, open, dragging, close, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClick } }
}
