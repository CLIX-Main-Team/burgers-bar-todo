import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn.js'

// A small status or category label (issue #213, components.md §Badge). Badges always paint
// with the soft (tinted) status variants from tokens.md, never the solid fills, so their
// small text stays above 4.5:1 in both themes. The variant names the token family, not the
// meaning: the board maps priority-high and backlog onto `warning`, in-progress onto
// `accent`, done onto `success`, and low onto `muted`, so a status chip and a priority chip
// never read as the same signal on one card (the gold-and-neutral vs. orange split).
// Only the four families v1's Badges actually use are exposed — a destructive soft chip is
// added when a surface needs one, not before.
type Variant = 'muted' | 'accent' | 'success' | 'warning'

const variants: Record<Variant, string> = {
  muted: 'bg-muted text-muted-foreground',
  accent: 'bg-accent text-accent-foreground',
  success: 'bg-success-muted text-success-muted-foreground',
  warning: 'bg-warning-muted text-warning-muted-foreground',
}

// A pill by default (radius-full), with a small leading gap so an optional glyph sits snug
// against the label. The label type role keeps the chip legible without shouting.
const base = 'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium'

export function Badge({
  variant = 'muted',
  className,
  ...props
}: { variant?: Variant } & HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn(base, variants[variant], className)} {...props} />
}
