import { forwardRef } from 'react'
import type { SelectHTMLAttributes } from 'react'
import { cn } from '../../lib/cn.js'

// The interim native styled select, kept for the people surfaces (the invite role/location
// pickers and the user-list location filter) that have not yet moved to the DS listbox
// Select. The design system's canonical Select is the popover listbox in select.tsx
// (components.md §Select, issue #215, which built it for the task form and fixes audit X5);
// this file is the native escape hatch those surfaces still register() onto until they
// migrate. Same tokens as Input — the trigger matches its height, border, radius, and ring —
// so the two selects read alike; the dropdown itself is OS-rendered and follows color-scheme.
export const NativeSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function NativeSelect({ className, children, ...props }, ref) {
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
