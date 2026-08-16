import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { cn } from '../../lib/cn.js'

// A shadcn/ui-style button, rethemed onto the design-system tokens (issue #101,
// components.md Button). Six variants cover the app: primary (the single blue action per
// screen, white on the brand blue), secondary (the quiet non-primary fill), outline (a bordered
// transparent button), ghost (transparent until hover, for icon and low-emphasis
// actions), destructive (the solid danger fill), and link (an inline accent-foreground
// text button, e.g. forgot-password). Structure and props are unchanged from the slate
// original — only the variant set, the token fills, the control heights, and the ring
// token are new.
//
// State vocabulary (components.md, "Interaction states"). Two states the first retheme
// left on the shared floor are wired here so every button carries them:
//   • pressed — the DS calls it out for a touch-first app: "no interactive component omits
//     it … not merely a colour nudge". Each variant deepens its fill on `active:`, and the
//     whole control dips a hair (motion-safe:active:scale-[0.98]) for a tactile press that
//     reads without colour. The scale is gated by prefers-reduced-motion (accessibility bar).
//   • disabled — the DS keeps the inherited opacity pattern but "repointed so the muted
//     surface still reads". A flat 50 %-opacity fill read as broken, not off, so the filled
//     variants (primary/secondary/destructive) drop to the muted surface at full opacity;
//     the already-transparent variants (outline/ghost/link) keep the opacity fade, which on
//     them reads as muted with nothing loud to wash out.
type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link'
type Size = 'default' | 'sm' | 'icon'

const base =
  'relative inline-flex select-none items-center justify-center gap-[7px] rounded-md text-body font-semibold transition motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ring focus-visible:ring-offset-background disabled:pointer-events-none ' +
  // The phone's tap collar: an invisible 5px skirt that lifts a 34-36px control to the 44px
  // touch floor without moving a pixel of the drawn button (a11y audit 2026-08-16). It lives
  // inside the button, so it extends only that button's hit area, and it is dropped from `md`
  // where a pointer makes it pointless.
  "after:absolute after:-inset-y-[5px] after:-inset-x-[5px] after:content-[''] md:after:hidden"

const variants: Record<Variant, string> = {
  primary:
    'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 disabled:bg-muted disabled:text-muted-foreground',
  secondary:
    'bg-secondary text-secondary-foreground hover:bg-secondary/80 active:bg-secondary/70 disabled:bg-muted disabled:text-muted-foreground',
  outline:
    'border border-input bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground active:bg-accent active:text-accent-foreground disabled:opacity-50',
  ghost:
    'bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground active:bg-accent active:text-accent-foreground disabled:opacity-50',
  destructive:
    'bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/80 disabled:bg-muted disabled:text-muted-foreground',
  // Links are the one place blue still speaks by itself (design refresh 2026-08-12: the
  // accent pair went gold, so link-buttons read the dedicated --link token instead).
  link: 'bg-transparent text-link underline-offset-4 hover:underline active:opacity-80 disabled:opacity-50',
}

// The Counter's control heights (owner call 2026-08-14 — the approved artifact is the
// dimensional spec): default is the 36px toolbar control, sm the 34px compact step, icon a
// 36px square.
//
// The 44px touch floor is met without changing any of those drawn heights (a11y audit
// 2026-08-16, which found ~30 phone-reachable controls under the floor): below `md` every
// button carries an invisible 5px collar, so a 34-36px control answers a 44px tap the way
// hitSlop does on native. It is a pseudo-element inside the button, so it extends that
// button's own hit area and nothing else's, and it is dropped from `md` up where the pointer
// makes it pointless.
const sizes: Record<Size, string> = {
  default: 'h-9 px-[15px]',
  sm: 'h-[34px] px-[13px] text-label',
  icon: 'size-9',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'default', className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      // Default to type="button" so a button inside a form never submits by accident;
      // forms pass type="submit" explicitly.
      type={type}
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    />
  )
})
