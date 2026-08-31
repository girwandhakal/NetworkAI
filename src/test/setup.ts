// Runs before every test file — extends `expect` with the jest-dom matchers
// (toBeInTheDocument, etc.) and cleans up whatever the previous test mounted.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})

// jsdom has no PointerEvent (https://github.com/jsdom/jsdom/issues/2527), so
// `fireEvent.pointerDown(...)` would otherwise fall back to a plain `Event`
// that silently drops `button`/`clientX`/`clientY` — exactly the fields
// useSwipeToDelete reads. MouseEvent covers the same init shape, so
// subclassing it is enough to make pointer-event tests behave like a real browser.
if (typeof window !== 'undefined' && !window.PointerEvent) {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number
    pointerType: string
    isPrimary: boolean
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params)
      this.pointerId = params.pointerId ?? 0
      this.pointerType = params.pointerType ?? 'mouse'
      this.isPrimary = params.isPrimary ?? true
    }
  }
  // @ts-expect-error — assigning our stand-in onto a browser global jsdom omits.
  window.PointerEvent = PointerEventPolyfill
}

// jsdom also doesn't implement pointer capture at all — stub it out so
// `element.setPointerCapture(...)` (used to keep a drag tracking the row
// once it leaves the element's bounds) doesn't throw in tests.
if (typeof Element !== 'undefined' && !Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.hasPointerCapture = () => false
}
