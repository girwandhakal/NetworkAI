import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useTap } from './useTap'

function pointerEvent(overrides: Partial<{ button: number; clientX: number; clientY: number }> = {}) {
  return { button: 0, clientX: 0, clientY: 0, ...overrides } as ReactPointerEvent
}

function mouseEvent() {
  return { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as ReactMouseEvent & {
    preventDefault: ReturnType<typeof vi.fn>
    stopPropagation: ReturnType<typeof vi.fn>
  }
}

describe('useTap', () => {
  it('fires on pointerup for a stationary tap — it does not wait for a click', () => {
    const onTap = vi.fn()
    const { result } = renderHook(() => useTap(onTap))

    act(() => result.current.onPointerDown(pointerEvent({ clientX: 10, clientY: 10 })))
    act(() => result.current.onPointerUp(pointerEvent({ clientX: 10, clientY: 10 })))

    expect(onTap).toHaveBeenCalledTimes(1)
  })

  it('does not fire if the pointer moved away before releasing (a drag, not a tap)', () => {
    const onTap = vi.fn()
    const { result } = renderHook(() => useTap(onTap))

    act(() => result.current.onPointerDown(pointerEvent({ clientX: 0, clientY: 0 })))
    act(() => result.current.onPointerUp(pointerEvent({ clientX: 40, clientY: 0 })))

    expect(onTap).not.toHaveBeenCalled()
  })

  it('ignores a pointerup with no preceding pointerdown on this element', () => {
    const onTap = vi.fn()
    const { result } = renderHook(() => useTap(onTap))

    act(() => result.current.onPointerUp(pointerEvent()))

    expect(onTap).not.toHaveBeenCalled()
  })

  it('ignores a non-primary pointer (e.g. a right-click)', () => {
    const onTap = vi.fn()
    const { result } = renderHook(() => useTap(onTap))

    act(() => result.current.onPointerDown(pointerEvent({ button: 2 })))
    act(() => result.current.onPointerUp(pointerEvent()))

    expect(onTap).not.toHaveBeenCalled()
  })

  it('swallows the click that follows a pointerup it already handled — no double-fire', () => {
    const onTap = vi.fn()
    const { result } = renderHook(() => useTap(onTap))

    act(() => result.current.onPointerDown(pointerEvent()))
    act(() => result.current.onPointerUp(pointerEvent()))
    expect(onTap).toHaveBeenCalledTimes(1)

    const click = mouseEvent()
    act(() => result.current.onClick(click))
    expect(onTap).toHaveBeenCalledTimes(1) // still just once
    expect(click.preventDefault).toHaveBeenCalled()
  })

  it('falls back to onClick when no pointerup preceded it — keyboard Enter/Space activation', () => {
    const onTap = vi.fn()
    const { result } = renderHook(() => useTap(onTap))

    // A keyboard activation never fires pointerdown/pointerup at all.
    const click = mouseEvent()
    act(() => result.current.onClick(click))

    expect(onTap).toHaveBeenCalledTimes(1)
    expect(click.preventDefault).not.toHaveBeenCalled()
  })
})
