import { forwardRef } from 'react'
import type { InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn.js'

// The text/email/password input, rethemed onto the tokens (issue #101, components.md
// Input). forwardRef so react-hook-form's register() can attach its ref. text-start keeps
// the caret and text on the reading edge in both directions. Height is the 48px control
// height and the font is body (16px, text-base) — the input floor that also blocks iOS
// focus auto-zoom (tokens.md typography); the border, ground, placeholder, and focus ring
// all paint through the semantic tokens, so the field follows light and dark.
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'flex h-12 w-full rounded-md border border-input bg-background px-3 py-2 text-start text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    )
  },
)
