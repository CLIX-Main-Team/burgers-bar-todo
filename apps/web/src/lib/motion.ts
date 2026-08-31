import type { CSSProperties } from 'react'

// The app's motion layer, TypeScript half (round 15, 2026-08-31). The durations and curves
// live in index.css as tokens, because CSS is what spends them; what cannot live there is
// TIMING ACROSS SIBLINGS — when the third row of a list starts relative to the first. That
// arithmetic is here, in one place, for the same reason round 12 kept the dashboard's score
// in one object: the order a screen arrives in is a design decision, and it should be
// readable as a list rather than reconstructed by grepping nine components.
//
// Nothing here decides WHETHER to animate. Every call site applies its result through
// Tailwind's motion-safe variant, so a reader who asked for reduced motion gets the settled
// screen at once — never a slower one, and never a delayed one.

/** How long an exit animation runs, mirroring --bb-dur-exit in index.css. It has to exist as a
 *  number as well as a token because the modals hold themselves mounted for exactly this long
 *  (see use-exit-transition.ts) and JavaScript cannot read a keyframe's length. motion.test.ts
 *  asserts the two stay equal, so the mirror cannot drift silently. */
export const EXIT_MS = 120

/** Milliseconds between one row of a list and the next. Material's band is 30-50ms; 40 is the
 *  middle of it, and the middle is right here: at 8 rows it reads as one sweep down the list,
 *  and below about 30 the order stops being legible at all. */
export const STAGGER_STEP = 40

/** How many rows actually get their own delay before the rest share the last one. Without a
 *  cap a forty-branch chain would spend 1.6 seconds listing itself, and the reader would be
 *  watching an animation rather than a list. Six is where a group still reads as ordered. */
export const STAGGER_CAP = 5

/**
 * The delay for row `index` of a list whose first row starts at `base` ms, held flat past the
 * cap. Generalised out of round 12's dashboard, which is now one caller among many.
 */
export function rowDelay(base: number, index: number): number {
  return base + Math.min(index, STAGGER_CAP) * STAGGER_STEP
}

/**
 * A delay as the inline style an animation reads it from. Returns an empty object at 0 rather
 * than `animationDelay: '0ms'`, so the common case adds no attribute to the DOM at all.
 *
 * Inline style rather than a Tailwind class on purpose: these values are computed from a row's
 * index, and a class per possible delay is a class Tailwind cannot see to generate.
 */
export function delayStyle(ms: number): CSSProperties {
  return ms > 0 ? { animationDelay: `${ms}ms` } : {}
}

/**
 * The delay style for row `index` of a list starting at `base` — `rowDelay` and `delayStyle`
 * together, which is how every caller uses them.
 */
export function rowDelayStyle(base: number, index: number): CSSProperties {
  return delayStyle(rowDelay(base, index))
}
