import { forwardRef } from 'react'
import type { TextareaHTMLAttributes } from 'react'
import { cn } from '../../lib/cn.js'

// Multi-line text entry — a task description, the assistant composer (issue #215,
// components.md §Textarea). It carries the same tokens, states, and 16px body font as
// Input (the iOS-zoom floor included), so a field reads as one family whether it is one
// line or several; only the shape differs. It grows with content up to a few lines then
// scrolls (min-block-size at the control height, resize-y capped by max-h at the call
// site) rather than pushing the layout around. forwardRef so react-hook-form's register()
// can attach its ref; text-start keeps the caret on the reading edge in both directions.
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-10 w-full rounded-md border border-input bg-background px-[13px] py-2 text-start text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 md:text-[0.875rem]',
        className,
      )}
      {...props}
    />
  )
})
