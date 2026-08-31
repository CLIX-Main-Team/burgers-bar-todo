import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EXIT_MS,
  STAGGER_CAP,
  STAGGER_STEP,
  delayStyle,
  rowDelay,
  rowDelayStyle,
} from './motion.js'

// Read from disk rather than imported: the assertions below are ABOUT the stylesheet's text —
// which tokens it declares and how they relate — and an import would hand back a bundled string
// with the custom properties already resolved away. Resolved from the workspace root, which is
// where vitest runs, since import.meta.url is not a file URL under the jsdom transform.
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

describe('rowDelay', () => {
  it('starts the first row at the base with no step added', () => {
    expect(rowDelay(200, 0)).toBe(200)
  })

  it('adds one step per row', () => {
    expect(rowDelay(200, 1)).toBe(200 + STAGGER_STEP)
    expect(rowDelay(200, 3)).toBe(200 + 3 * STAGGER_STEP)
  })

  it('holds flat past the cap, so a long list does not spend seconds arriving', () => {
    const capped = rowDelay(0, STAGGER_CAP)
    expect(rowDelay(0, STAGGER_CAP + 1)).toBe(capped)
    expect(rowDelay(0, 40)).toBe(capped)
    // The whole point of the cap: a forty-row list still finishes in well under a second.
    expect(capped).toBeLessThan(400)
  })
})

describe('delayStyle', () => {
  it('adds no attribute at all when there is no delay', () => {
    expect(delayStyle(0)).toEqual({})
  })

  it('names the delay in ms otherwise', () => {
    expect(delayStyle(120)).toEqual({ animationDelay: '120ms' })
  })

  it('composes with rowDelay', () => {
    expect(rowDelayStyle(200, 2)).toEqual({ animationDelay: `${200 + 2 * STAGGER_STEP}ms` })
  })
})

describe('the motion layer', () => {
  // Every --bb-dur-* token the stylesheet declares, by its bare name.
  const durations = new Map(
    Array.from(css.matchAll(/--bb-dur-([a-z]+):\s*(\d+)ms/g), (m) => [m[1], Number(m[2])]),
  )

  // EXIT_MS exists twice by necessity — as a token CSS animates from, and as a number the
  // modals count down before unmounting. This is what stops the two from drifting apart: a
  // shorter token would unmount mid-animation, a longer one would leave a dead panel on screen.
  it('keeps EXIT_MS equal to the --bb-dur-exit token it mirrors', () => {
    expect(durations.get('exit')).toBe(EXIT_MS)
  })

  it('declares both tiers', () => {
    for (const name of [
      'press',
      'exit',
      'tip',
      'state',
      'knob',
      'modal',
      'rise',
      'sweep',
      'draw',
    ]) {
      expect(durations.has(name), `--bb-dur-${name} is declared`).toBe(true)
    }
  })

  // Material's rule, and the reason a dismissal does not feel like an argument with the finger
  // that asked for it.
  it('keeps the exit shorter than the entrance it reverses', () => {
    const exit = durations.get('exit') ?? 0
    const modal = durations.get('modal') ?? 0
    expect(exit).toBeLessThanOrEqual(0.7 * modal)
  })

  it('keeps every response duration inside the 200ms that still reads as instant', () => {
    for (const name of ['press', 'exit', 'tip', 'state', 'knob', 'modal']) {
      expect(durations.get(name), `--bb-dur-${name}`).toBeLessThanOrEqual(200)
    }
  })

  it('keeps every arrival duration long enough to read as a movement', () => {
    for (const name of ['rise', 'sweep', 'draw']) {
      expect(durations.get(name), `--bb-dur-${name}`).toBeGreaterThanOrEqual(400)
    }
  })

  it('defines a keyframe for every animation the layer names', () => {
    const declared = new Set(Array.from(css.matchAll(/@keyframes (bb-[a-z-]+)/g), (m) => m[1]))
    const referenced = new Set(
      Array.from(css.matchAll(/--animate-[a-z-]+:\s*(bb-[a-z-]+)/g), (m) => m[1]),
    )
    expect(referenced.size).toBeGreaterThan(0)
    for (const name of referenced) {
      expect(declared, `${name} is defined`).toContain(name)
    }
  })
})
