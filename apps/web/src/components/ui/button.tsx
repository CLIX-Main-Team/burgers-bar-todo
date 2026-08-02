import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn.js'

// A small shadcn/ui-style button (engineering-design: Tailwind v4 + shadcn/ui). Three
// variants cover the whole auth surface: primary for the main submit, outline for
// secondary actions (log out, resend), and destructive for revoke/deactivate.
type Variant = 'primary' | 'outline' | 'destructive'
type Size = 'default' | 'sm'

const base =
  'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-400 disabled:pointer-events-none disabled:opacity-50'

const variants: Record<Variant, string> = {
  primary: 'bg-slate-900 text-white hover:bg-slate-800',
  outline: 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-100',
  destructive: 'border border-red-300 bg-white text-red-700 hover:bg-red-50',
}

const sizes: Record<Size, string> = {
  default: 'h-10 px-4 py-2',
  sm: 'h-8 px-3 text-xs',
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
