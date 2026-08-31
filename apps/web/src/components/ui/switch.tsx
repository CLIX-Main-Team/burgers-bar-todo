import { cn } from '../../lib/cn.js'

// A two-state switch (owner ask 2026-08-24, built for the Access page's live matrix). A
// real `role="switch"` button: on/off is `aria-checked`, the accessible name comes from
// `label` (the visual row text sits outside), and Space/Enter both fire the click the way
// a native button does. Painted from the semantic tokens — primary when on, muted when
// off — so it follows both themes; the thumb travels with logical inset so RTL mirrors
// for free (principles.md).
export interface SwitchProps {
  checked: boolean
  onCheckedChange(checked: boolean): void
  label: string
  disabled?: boolean
  className?: string
}

export function Switch({ checked, onCheckedChange, label, disabled, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 flex-none items-center rounded-full transition-colors duration-[var(--bb-dur-knob)] ease-entrance motion-reduce:transition-none',
        checked ? 'bg-primary' : 'bg-muted-foreground/35',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          // The knob keeps travelling on `inset-inline-start` rather than a transform: the
          // property is the reason RTL mirrors for free, and it is one out-of-flow 16px
          // element, so the layout cost the transform rule warns about does not apply.
          'absolute size-4 rounded-full bg-white shadow-sm transition-[inset-inline-start] duration-[var(--bb-dur-knob)] ease-entrance motion-reduce:transition-none',
          checked ? 'start-[18px]' : 'start-0.5',
        )}
      />
    </button>
  )
}
