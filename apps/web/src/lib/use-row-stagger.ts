import { useCallback } from 'react'
import { STAGGER_CAP, STAGGER_STEP } from './motion.js'

// Stagger a GRID by row instead of by cell (round 15 rev 2, 2026-08-31).
//
// The plain `bb-stagger` class counts children in DOM order, which in a one-column list is the
// same thing as top to bottom. In a grid it is not: DOM order runs across each row and wraps, so
// a four-up grid arrived cell by cell, left to right — a scan rather than a sweep, and the owner
// called it on sight ("i need it to show from top to bottom").
//
// Doing it in CSS would mean knowing the column count, which changes at four breakpoints and
// differs between the grids that need this; nth-child cannot take a variable. Doing it with a
// prop would mean every card component learning its own index. So the row is measured instead:
// one read of each child's offsetTop tells us which row it landed in, at whatever width.
//
// A CALLBACK ref, not an object ref with an effect, and that is the important part. These grids
// render behind a loading state, so the <ul> does not exist when its screen first mounts and a
// mount-only effect measures nothing — every cell keeps a zero delay and the whole grid arrives
// at once. React calls a callback ref at the moment the node attaches, which is exactly when
// there is something to measure. It also keeps the call unconditional at the top of a component,
// where a hook has to be: the first attempt at this moved the call below the screen's own
// `if (query.isPending) return …`, which changes the hook count between renders and took the
// page down to a blank tree.
export function useRowStagger<T extends HTMLElement>(baseMs = 0) {
  return useCallback(
    (grid: T | null) => {
      if (!grid) return
      // Nothing to schedule when the reader has asked for no motion: the stylesheet's own
      // no-preference query has already dropped the animation these delays would apply to.
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

      let previousTop = Number.NaN
      let row = -1
      for (const child of Array.from(grid.children)) {
        if (!(child instanceof HTMLElement)) continue
        // A new offsetTop means a new visual row. Cells in one row share it exactly, and
        // `auto-rows-fr` — which the grids using this all carry — keeps that true even when one
        // card is taller than its neighbours.
        if (child.offsetTop !== previousTop) {
          row += 1
          previousTop = child.offsetTop
        }
        child.style.setProperty(
          '--bb-row-delay',
          `${baseMs + Math.min(row, STAGGER_CAP) * STAGGER_STEP}ms`,
        )
      }
    },
    [baseMs],
  )
}
