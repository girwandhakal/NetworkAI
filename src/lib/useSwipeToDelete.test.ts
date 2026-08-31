import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { SWIPE_ACTION_WIDTH, useSwipeToDelete } from './useSwipeToDelete'

let capturedIds: number[] = []

function pointerEvent(overrides: Partial<{ pointerId: number; clientX: number; clientY: number; button: number }> = {}) {
  const pointerId = overrides.pointerId ?? 1
  return {
    pointerId,
    button: 0,
    clientX: 0,
    clientY: 0,
    ...overrides,
    preventDefault: vi.fn(),
    currentTarget: {
      setPointerCapture: vi.fn((id: number) => capturedIds.push(id)),
      hasPointerCapture: vi.fn(() => false),
      releasePointerCapture: vi.fn(),
    },
  } as unknown as ReactPointerEvent
}

function mouseEvent() {
  return { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as ReactMouseEvent & {
    preventDefault: ReturnType<typeof vi.fn>
    stopPropagation: ReturnType<typeof vi.fn>
  }
}

beforeEach(() => {
  capturedIds = []
})

describe('useSwipeToDelete', () => {
  it('starts closed with zero offset', () => {
    const { result } = renderHook(() => useSwipeToDelete())
    expect(result.current.offset).toBe(0)
    expect(result.current.open).toBe(false)
  })

  it('tracks a leftward drag 1:1, clamped to the action width', () => {
    const { result } = renderHook(() => useSwipeToDelete())

    act(() => result.current.handlers.onPointerDown(pointerEvent({ clientX: 100 })))
    act(() => result.current.handlers.onPointerMove(pointerEvent({ clientX: 60 })))
    expect(result.current.offset).toBe(-40)
    expect(result.current.dragging).toBe(true)

    // Dragged well past the action width — offset clamps rather than overshoots.
    act(() => result.current.handlers.onPointerMove(pointerEvent({ clientX: -200 })))
    expect(result.current.offset).toBe(-SWIPE_ACTION_WIDTH)
  })

  it('snaps open past the halfway point on release, closed if short of it', () => {
    const past = renderHook(() => useSwipeToDelete())
    act(() => past.result.current.handlers.onPointerDown(pointerEvent({ clientX: 100 })))
    act(() => past.result.current.handlers.onPointerMove(pointerEvent({ clientX: 100 - SWIPE_ACTION_WIDTH * 0.6 })))
    act(() => past.result.current.handlers.onPointerUp(pointerEvent()))
    expect(past.result.current.open).toBe(true)
    expect(past.result.current.offset).toBe(-SWIPE_ACTION_WIDTH)

    const short = renderHook(() => useSwipeToDelete())
    act(() => short.result.current.handlers.onPointerDown(pointerEvent({ clientX: 100 })))
    act(() => short.result.current.handlers.onPointerMove(pointerEvent({ clientX: 100 - SWIPE_ACTION_WIDTH * 0.2 })))
    act(() => short.result.current.handlers.onPointerUp(pointerEvent()))
    expect(short.result.current.open).toBe(false)
    expect(short.result.current.offset).toBe(0)
  })

  it('ignores small jitter — no drag starts, and a plain tap is left alone', () => {
    const { result } = renderHook(() => useSwipeToDelete())
    act(() => result.current.handlers.onPointerDown(pointerEvent({ clientX: 100 })))
    act(() => result.current.handlers.onPointerMove(pointerEvent({ clientX: 104 })))
    expect(result.current.dragging).toBe(false)
    expect(result.current.offset).toBe(0)

    const click = mouseEvent()
    act(() => result.current.handlers.onClick(click))
    expect(click.preventDefault).not.toHaveBeenCalled()
  })

  it('treats a mostly-vertical drag as a scroll, not a swipe', () => {
    const { result } = renderHook(() => useSwipeToDelete())
    act(() => result.current.handlers.onPointerDown(pointerEvent({ clientX: 100, clientY: 100 })))
    act(() => result.current.handlers.onPointerMove(pointerEvent({ clientX: 90, clientY: 150 })))
    expect(result.current.dragging).toBe(false)
    expect(result.current.offset).toBe(0)
    expect(capturedIds).toHaveLength(0)
  })

  it('swallows the click after a completed drag, but not an unrelated later click', () => {
    const { result } = renderHook(() => useSwipeToDelete())
    // A short drag that springs back closed — isolates click-swallowing from
    // the separate "tap while open closes it" behavior below.
    act(() => result.current.handlers.onPointerDown(pointerEvent({ clientX: 100 })))
    act(() => result.current.handlers.onPointerMove(pointerEvent({ clientX: 100 - SWIPE_ACTION_WIDTH * 0.2 })))
    act(() => result.current.handlers.onPointerUp(pointerEvent()))
    expect(result.current.open).toBe(false)

    const afterDrag = mouseEvent()
    act(() => result.current.handlers.onClick(afterDrag))
    expect(afterDrag.preventDefault).toHaveBeenCalled()

    const laterClick = mouseEvent()
    act(() => result.current.handlers.onClick(laterClick))
    expect(laterClick.preventDefault).not.toHaveBeenCalled()
  })

  it('a tap while open closes the row instead of navigating', () => {
    const { result } = renderHook(() => useSwipeToDelete())
    act(() => result.current.handlers.onPointerDown(pointerEvent({ clientX: 100 })))
    act(() => result.current.handlers.onPointerMove(pointerEvent({ clientX: 100 - SWIPE_ACTION_WIDTH })))
    act(() => result.current.handlers.onPointerUp(pointerEvent()))
    expect(result.current.open).toBe(true)

    // A real browser fires a click after this drag's own pointerup too —
    // that one gets swallowed and never reaches the "tap while open" check.
    act(() => result.current.handlers.onClick(mouseEvent()))
    expect(result.current.open).toBe(true)

    // A separate, later tap (no drag behind it) closes it instead.
    const click = mouseEvent()
    act(() => result.current.handlers.onClick(click))
    expect(click.preventDefault).toHaveBeenCalled()
    expect(result.current.open).toBe(false)
    expect(result.current.offset).toBe(0)
  })

  it('close() resets an open row', () => {
    const { result } = renderHook(() => useSwipeToDelete())
    act(() => result.current.handlers.onPointerDown(pointerEvent({ clientX: 100 })))
    act(() => result.current.handlers.onPointerMove(pointerEvent({ clientX: 100 - SWIPE_ACTION_WIDTH })))
    act(() => result.current.handlers.onPointerUp(pointerEvent()))
    expect(result.current.open).toBe(true)

    act(() => result.current.close())
    expect(result.current.open).toBe(false)
    expect(result.current.offset).toBe(0)
  })

  it('opening one row closes another that was already open', () => {
    const a = renderHook(() => useSwipeToDelete())
    const b = renderHook(() => useSwipeToDelete())

    act(() => a.result.current.handlers.onPointerDown(pointerEvent({ pointerId: 1, clientX: 100 })))
    act(() => a.result.current.handlers.onPointerMove(pointerEvent({ pointerId: 1, clientX: 100 - SWIPE_ACTION_WIDTH })))
    act(() => a.result.current.handlers.onPointerUp(pointerEvent({ pointerId: 1 })))
    expect(a.result.current.open).toBe(true)

    act(() => b.result.current.handlers.onPointerDown(pointerEvent({ pointerId: 2, clientX: 100 })))
    act(() => b.result.current.handlers.onPointerMove(pointerEvent({ pointerId: 2, clientX: 100 - SWIPE_ACTION_WIDTH })))
    act(() => b.result.current.handlers.onPointerUp(pointerEvent({ pointerId: 2 })))
    expect(b.result.current.open).toBe(true)

    expect(a.result.current.open).toBe(false)
  })

  it('ignores a non-primary button (right-click drag)', () => {
    const { result } = renderHook(() => useSwipeToDelete())
    act(() => result.current.handlers.onPointerDown(pointerEvent({ clientX: 100, button: 2 })))
    act(() => result.current.handlers.onPointerMove(pointerEvent({ clientX: 50 })))
    expect(result.current.dragging).toBe(false)
    expect(result.current.offset).toBe(0)
  })
})
