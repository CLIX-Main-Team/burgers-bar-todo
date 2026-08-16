import { forwardRef } from 'react'
import type { InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn.js'

// The text/email/password input, rethemed onto the tokens (issue #101, components.md
// Input). forwardRef so react-hook-form's register() can attach its ref. text-start keeps
// the caret and text on the reading edge in both directions. Height is The Counter's 40px
// form field (2026-08-14); the font holds the 16px text-base floor below md — the size that
// blocks iOS focus auto-zoom (tokens.md typography) — and drops to the artifact's 14px from
// md, where no zoom rule applies. Border, ground, placeholder, and focus ring all paint
// through the semantic tokens, so the field follows light and dark.
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-background px-[13px] text-start text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 md:text-body',
          className,
        )}
        {...props}
      />
    )
  },
)
