import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(process.cwd(), 'src/styles/global.css'), 'utf8')

/**
 * Regression guard for a real bug: `.page`'s entrance animation (`page-in`)
 * only declares `transform` in its `from` keyframe. With fill-mode `both`,
 * the animation keeps *permanently* applying its computed final value for
 * `transform` — an explicit identity matrix, not the keyword `none` —
 * instead of reverting to the real cascade once it finishes. Any non-`none`
 * transform on an ancestor, even a no-op one, silently turns every
 * `position: fixed` modal inside it (Sheet/Confirm/CaptureSheet) from
 * viewport-relative into relative-to-that-ancestor instead: invisible on a
 * short page, but on a long scrolled list it pushes the entire dialog off
 * -screen below the fold — contact rows could be swiped and "deleted"
 * without the confirmation ever being reachable.
 *
 * `backwards` avoids this: it still applies the entry frame before the
 * animation starts (no flash of unstyled content) but correctly lets
 * `transform` fall back to `none` once the animation ends, since `.page`
 * never sets a static `transform` of its own.
 */
describe('.page animation fill-mode', () => {
  it('does not use `both` (or `forwards`), which would leave transform stuck', () => {
    const rule = css.match(/\.page\s*{[^}]*}/)?.[0]
    expect(rule, '.page rule not found in global.css').toBeTruthy()

    const animation = rule!.match(/animation:\s*([^;]+);/)?.[1]
    expect(animation, '.page has no `animation` declaration to check').toBeTruthy()

    expect(animation).not.toMatch(/\bboth\b/)
    expect(animation).not.toMatch(/\bforwards\b/)
  })

  it('the page-in keyframe still only sets transform on `from`, so `backwards` is correct here', () => {
    // If a `to`/`100%` keyframe ever declares its own `transform`, this
    // whole failure mode goes away and the fill-mode constraint above no
    // longer matters — this just documents that assumption so a future
    // change to the keyframe doesn't leave the comment above stale.
    const keyframe = css.match(/@keyframes\s+page-in\s*{[\s\S]*?\n}/)?.[0]
    expect(keyframe, 'page-in keyframe not found in global.css').toBeTruthy()
    expect(keyframe).not.toMatch(/(to|100%)\s*{[^}]*transform/)
  })
})
