import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { cn } from '../../lib/cn.js'

// A shadcn/ui-style button, rethemed onto the design-system tokens (issue #101,
// components.md Button). Six variants cover the app: primary (the single gold action per
// screen, dark ink on gold), secondary (the quiet non-primary fill), outline (a bordered
// transparent button), ghost (transparent until hover, for icon and low-emphasis
// actions), destructive (the solid danger fill), and link (an inline accent-foreground
// text button, e.g. forgot-password). Structure and props are unchanged from the slate
// original — only the variant set, the token fills, the 48px control height, and the ring
// token are new.
//
// State vocabulary (components.md, "Interaction states"). Two states the first retheme
// left on the shared floor are wired here so every button carries them:
//   • pressed — the DS calls it out for a touch-first app: "no interactive component omits
//     it … not merely a colour nudge". Each variant deepens its fill on `active:`, and the
//     whole control dips a hair (motion-safe:active:scale-[0.98]) for a tactile press that
//     reads without colour. The scale is gated by prefers-reduced-motion (accessibility bar).
//   • disabled — the DS keeps the inherited opacity pattern but "repointed so the muted
//     surface still reads". A flat 50 %-opacity gold read as broken, not off, so the filled
//     variants (primary/secondary/destructive) drop to the muted surface at full opacity;
//     the already-transparent variants (outline/ghost/link) keep the opacity fade, which on
//     them reads as muted with nothing loud to wash out.
type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link'
type Size = 'default' | 'sm' | 'icon'

const base =
  'inline-flex select-none items-center justify-center rounded-md text-sm font-medium transition motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ring focus-visible:ring-offset-background disabled:pointer-events-none'

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
  link: 'bg-transparent text-accent-foreground underline-offset-4 hover:underline active:opacity-80 disabled:opacity-50',
}

// Heights meet the touch floor: default is the 48px control height, sm holds the 44px
// minimum (tokens.md touch targets), and icon is a 44px square. No control drops below
// the floor, so raising the old h-10/h-8 controls is the intended retheme change.
const sizes: Record<Size, string> = {
  default: 'h-12 px-4 py-2',
  sm: 'h-11 px-3',
  icon: 'size-11',
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
