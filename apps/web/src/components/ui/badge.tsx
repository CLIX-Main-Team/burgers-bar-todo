import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn.js'

// A small status or category label (issue #213, components.md §Badge). Badges paint with
// the soft (tinted) status variants from tokens.md so their small text stays above 4.5:1 in
// both themes. The variant names the token family, not the meaning: the board maps
// priority-high onto `warning` and low and backlog onto `muted`, while task-status chips
// paint from the dedicated status tokens (board-columns.ts STATUS_TONE) — priority-high's
// leading glyph keeps it distinct from the not-started pill sharing the orange family. `destructive` is the one
// solid fill: the notification-counter red (owner call 2026-08, modelled on the team's
// CRM's bell counter) — a count demanding attention, never a status label.
type Variant = 'muted' | 'accent' | 'success' | 'warning' | 'destructive'

const variants: Record<Variant, string> = {
  muted: 'bg-muted text-muted-foreground',
  accent: 'bg-accent text-accent-foreground',
  success: 'bg-success-muted text-success-muted-foreground',
  warning: 'bg-warning-muted text-warning-muted-foreground',
  destructive: 'bg-destructive text-destructive-foreground',
}

// A pill by default (radius-full), with a small leading gap so an optional glyph sits snug
// against the label. The label type role keeps the chip legible without shouting.
const base =
  'inline-flex shrink-0 items-center gap-1 rounded-full px-[9px] py-[2px] text-caption font-bold'

export function Badge({
  variant = 'muted',
  className,
  ...props
}: { variant?: Variant } & HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn(base, variants[variant], className)} {...props} />
}
