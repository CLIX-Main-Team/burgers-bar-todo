import { cn } from '../../lib/cn.js'
import { ICON_REGISTRY, type IconRole, type RegistryEntry } from './icon-registry.js'

// The one way any surface draws a glyph (ADR-0020, docs/design-system/iconography.md). A
// call site names a semantic role — <Icon name="send" /> — never a Phosphor glyph, and the
// wrapper owns RTL mirroring, sizing, colour inheritance, and accessibility once so no call
// site re-implements them.

export type IconSize = 'sm' | 'md' | 'lg'

// Named sizes, each a Tailwind step (Size, iconography.md). Visual size is decoupled from
// the 44px hit area, which the button owns — an `sm`/`md` glyph still lives in a 44px tap
// target.
const SIZE_CLASS: Record<IconSize, string> = {
  sm: 'size-4', // 16px — inline with caption / metadata text
  md: 'size-5', // 20px — default: buttons, menu items, status badges
  lg: 'size-6', // 24px — BottomNav, avatar fallback, largest touch targets
}

export interface IconProps {
  /** The semantic role to draw, resolved to a glyph through the registry. */
  name: IconRole
  /** Named size step; defaults to `md`. There is deliberately no `color` prop — colour is
   *  `currentColor`, inheriting the surrounding `foreground` / `*-foreground` token. */
  size?: IconSize
  /** The reserved active/selected signal: flips the weight to `fill` (else `regular`).
   *  Fires in exactly two places — the active BottomNav destination and the current task
   *  status (Weight, iconography.md). */
  active?: boolean
  /** Names a standalone meaningful glyph: flips it to `role="img"` + `aria-label` and drops
   *  `aria-hidden`. Omit for decorative icons, whose name comes from the surrounding
   *  control (Accessibility, iconography.md). */
  label?: string
  className?: string
}

export function Icon({ name, size = 'md', active, label, className }: IconProps) {
  // Annotated so the lookup reads as one uniform RegistryEntry rather than the union of
  // per-role literal shapes — `directional`/`defaultWeight` are optional on every role.
  const { glyph: Glyph, directional, defaultWeight }: RegistryEntry = ICON_REGISTRY[name]

  // `fill` is reserved for the active/selected state; every other rendering rests at the
  // role's default weight, `regular` for all roles today.
  const weight = active ? 'fill' : (defaultWeight ?? 'regular')

  // A standalone labelled glyph announces itself; a decorative one stays hidden so the
  // surrounding control is not double-announced.
  const a11y = label
    ? ({ role: 'img', 'aria-label': label } as const)
    : ({ 'aria-hidden': true } as const)

  return (
    <Glyph
      weight={weight}
      // Directional roles carry the class the single RTL rule keys off (index.css):
      // `[dir="rtl"] .icon--directional { transform: scaleX(-1); }`. The wrapper stays
      // purely presentational — the flip rides the ambient `dir`, no locale subscription.
      className={cn(SIZE_CLASS[size], directional && 'icon--directional', className)}
      {...a11y}
    />
  )
}
