import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn.js'

// A shadcn/ui-style button, rethemed onto the design-system tokens (issue #101,
// components.md Button). Six variants cover the app: primary (the single gold action per
// screen, dark ink on gold), secondary (the quiet non-primary fill), outline (a bordered
// transparent button), ghost (transparent until hover, for icon and low-emphasis
// actions), destructive (the solid danger fill), and link (an inline accent-foreground
// text button, e.g. forgot-password). Structure and props are unchanged from the slate
// original — only the variant set, the token fills, the 48px control height, and the ring
// token are new.
type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link'
type Size = 'default' | 'sm' | 'icon'

const base =
  'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ring focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50'

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  outline:
    'border border-input bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground',
  ghost: 'bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  link: 'bg-transparent text-accent-foreground underline-offset-4 hover:underline',
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

export function Button({
  variant = 'primary',
  size = 'default',
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      // Default to type="button" so a button inside a form never submits by accident;
      // forms pass type="submit" explicitly.
      type={type}
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    />
  )
}
