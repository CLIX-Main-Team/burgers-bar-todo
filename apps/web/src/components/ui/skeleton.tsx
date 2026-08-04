import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn.js'

// The loading-state placeholder (issue #213, components.md §Skeleton): a muted block shaped
// like the content it stands in for, so the layout is stable when real data lands and the
// board never shows a bare spinner on a blank screen. The gentle pulse lives on the
// `.bb-skeleton` class in index.css, which drops the animation under prefers-reduced-motion
// (principle 5). Decorative by default (aria-hidden); the region around a set of skeletons
// carries the `aria-busy` and the accessible "Loading" name, not each block.
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn('bb-skeleton rounded-sm bg-muted', className)} {...props} />
}
