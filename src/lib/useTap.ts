import { useCallback, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react'

/** Movement below this still counts as a tap rather than a drag-away. */
const TAP_TOLERANCE_PX = 10

export interface TapHandlers {
  onPointerDown(e: ReactPointerEvent): void
  onPointerUp(e: ReactPointerEvent): void
  onClick(e: ReactMouseEvent): void
}

/**
 * A tap handler that fires on `pointerup` instead of waiting for the browser
 * to synthesize a `click`. Chromium does not reliably synthesize that click
 * for a tap landing right next to (or immediately after) an unrelated
 * pointer-capturing drag elsewhere on the page — e.g. the delete action a
 * swipe just revealed (see useSwipeToDelete) — even though the tap's own
 * pointerdown/pointerup land on the right element every time. Driving the
 * action from pointerup sidesteps that instead of hoping the browser's click
 * synthesis behaves.
 *
 * `onClick` is still wired up and still fires the action — pointerup never
 * fires for a keyboard-triggered activation (Enter/Space on a focused
 * button), so that path is what keyboard and screen-reader users hit. A flag
 * suppresses the browser's own follow-up click after a pointerup already
 * handled it, so a tap/click never double-fires the action.
 */
export function useTap(onTap: () => void): TapHandlers {
  const start = useRef<{ x: number; y: number } | null>(null)
  const handledByPointer = useRef(false)

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    if (e.button !== 0) return
    start.current = { x: e.clientX, y: e.clientY }
  }, [])

  const onPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      const from = start.current
      start.current = null
      if (!from) return
      const moved = Math.hypot(e.clientX - from.x, e.clientY - from.y)
      if (moved > TAP_TOLERANCE_PX) return
      handledByPointer.current = true
      onTap()
    },
    [onTap],
  )

  const onClick = useCallback(
    (e: ReactMouseEvent) => {
      if (handledByPointer.current) {
        // Already handled from pointerup — this is the browser's own
        // trailing click (when it bothers to fire one). Swallow it.
        handledByPointer.current = false
        e.preventDefault()
        e.stopPropagation()
        return
      }
      // No pointerup preceded this — a keyboard Enter/Space activation.
      onTap()
    },
    [onTap],
  )

  return { onPointerDown, onPointerUp, onClick }
}
