import { forwardRef } from 'react'
import type { SelectHTMLAttributes } from 'react'
import { cn } from '../../lib/cn.js'

// A native select styled to match the inputs, rethemed onto the tokens (issue #101,
// components.md Select). Used for the invite role choice, which is only ever offered when
// the acting principal may choose it (an Admin); a Manager's form shows the fixed role as
// read-only text instead (ui-flow, invite management). The trigger matches Input's height,
// border, radius, and ring; the dropdown itself is OS-rendered and follows color-scheme.
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          'flex h-12 w-full rounded-sm border border-input bg-background px-3 py-2 text-start text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      >
        {children}
      </select>
    )
  },
)
