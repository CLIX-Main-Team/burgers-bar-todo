import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { cn } from '../../lib/cn.js'
import { Icon } from './icon.js'

// The design system's canonical Select (issue #215, components.md §Select): a listbox/popover
// that replaces the styled-native `<select>` on the task form, fixing audit X5 (raw native
// selects). It is hand-rolled onto the tokens the way the other primitives are (no Radix in
// the tree) and carries the behaviours a listbox must own so no call site re-implements them:
// click-outside to dismiss, Escape to close and return focus to the trigger, Tab to close,
// roving arrow-key focus across the options, type-ahead, and Home/End. The trigger matches
// Input's height, border, radius, and ring; the popover is a `popover` surface with
// elevation-md, the selected option carrying the accent surface.
//
// It is controlled — `value` + `onValueChange` — so it drops into react-hook-form through a
// Controller. The field label (Field's `<label htmlFor>`) targets the trigger button, which is
// a labelable element, so the whole field is one accessible control; `label` names the listbox
// itself. The interim native select other surfaces still register() onto lives in
// native-select.tsx until they migrate.

export interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  // Shown, in the muted placeholder colour, when `value` matches no option (an unchosen field).
  placeholder?: string
  // Names the listbox popover to assistive tech (the field label; the trigger is named by
  // Field's own <label htmlFor>).
  label?: string
  id?: string
  disabled?: boolean
  className?: string
  // Overrides the trigger's default form-field cut — the header toolbars (The Counter,
  // round 8) seat their filters as 36px bordered-card controls, not full form inputs.
  triggerClassName?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  label,
  id,
  disabled = false,
  className,
  triggerClassName,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedby,
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const listboxId = useId()
  // The type-ahead buffer: consecutive keystrokes within a short window jump to the option whose
  // label starts with what was typed, the ordinary native-select affordance kept alive here.
  const typeahead = useRef<{ term: string; at: number }>({ term: '', at: 0 })

  const selected = options.find((option) => option.value === value)
  const close = useCallback(() => setOpen(false), [])

  // Dismiss on a pointer press outside the trigger-and-list; a press on the trigger is its own
  // toggle, so it is excluded (the same behaviour DropdownMenu carries).
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (listRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // On open, move focus onto the current option (or the first) so a keyboard and screen-reader
  // user lands on the selection; closing returns focus to the trigger where they left off.
  useEffect(() => {
    if (!open) return
    const list = listRef.current
    if (!list) return
    const current = list.querySelector<HTMLElement>('[aria-selected="true"]')
    const first = list.querySelector<HTMLElement>('[role="option"]')
    ;(current ?? first)?.focus()
  }, [open])

  const optionEls = () =>
    Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])

  const choose = (next: string) => {
    onValueChange(next)
    setOpen(false)
    triggerRef.current?.focus()
  }

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    const els = optionEls()
    const active = document.activeElement as HTMLElement | null
    const index = active ? els.indexOf(active) : -1
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        els[(index + 1) % els.length]?.focus()
        return
      case 'ArrowUp':
        event.preventDefault()
        els[(index - 1 + els.length) % els.length]?.focus()
        return
      case 'Home':
        event.preventDefault()
        els[0]?.focus()
        return
      case 'End':
        event.preventDefault()
        els[els.length - 1]?.focus()
        return
      case 'Enter':
      case ' ': {
        event.preventDefault()
        const chosen = options[index]
        if (chosen) choose(chosen.value)
        return
      }
      case 'Escape':
        event.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
        return
      case 'Tab':
        setOpen(false)
        return
    }
    // Type-ahead: printable single characters extend the buffer (reset after a pause) and jump
    // to the first option whose label starts with it.
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = event.timeStamp
      const term = now - typeahead.current.at < 600 ? typeahead.current.term + event.key : event.key
      typeahead.current = { term, at: now }
      const match = options.findIndex((option) =>
        option.label.toLowerCase().startsWith(term.toLowerCase()),
      )
      if (match !== -1) els[match]?.focus()
    }
  }

  // Space or Enter with the button focused opens the list onto the selection, matching a native
  // select; ArrowDown/Up also open it (the button's own keydown, not the list's).
  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (open) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
    }
  }

  return (
    <div className={cn('relative', className)}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        // The field label names the trigger explicitly (not only via Field's <label htmlFor>), so
        // the accessible name is the label — not the selected value's text — which keeps the control
        // findable by its label and satisfies label-in-name (WCAG 2.5.3).
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedby}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          'flex w-full items-center justify-between gap-2 text-start text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
          triggerClassName ??
            'h-10 rounded-md border border-input bg-background px-[13px] text-base md:text-body',
        )}
      >
        {/* The selected label lays out by its own script (a Hebrew name in an English UI); the
            placeholder reads in the muted colour so an unchosen field looks unset, not filled. */}
        <span
          className={cn('truncate', selected ? 'text-foreground' : 'text-muted-foreground')}
          dir="auto"
        >
          {selected ? selected.label : placeholder}
        </span>
        <Icon name="disclosure" size="sm" className="shrink-0 text-muted-foreground" />
      </button>

      {open ? (
        // The listbox/option ARIA pattern is intentional here — this is a hand-rolled Select, the
        // DS canonical replacement for the native one (there is no Radix in the tree). The <ul>
        // takes tabIndex -1 so it is programmatically focusable (its options hold the roving focus)
        // and owns the keyboard handling; a native <select>/<option> could not carry the token
        // popover the DS specifies. (biome's a11y roles rules are turned off for this file in
        // biome.json — the listbox/option composition is intentional and correct.)
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {options.map((option) => {
            const isSelected = option.value === value
            return (
              // The listbox owns keyboard handling on the <ul>; each option is programmatically
              // focused (tabIndex -1) and chosen via that handler, so a per-option key handler
              // would duplicate it. (a11y roles rules are off for this file — see biome.json.)
              <li
                key={option.value}
                role="option"
                aria-selected={isSelected}
                tabIndex={-1}
                onClick={() => choose(option.value)}
                className={cn(
                  'flex min-h-9 cursor-pointer items-center gap-2 rounded-sm px-2 text-start text-body outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground',
                  isSelected && 'bg-accent text-accent-foreground',
                )}
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  {isSelected ? <Icon name="selected" size="sm" /> : null}
                </span>
                <span className="truncate" dir="auto">
                  {option.label}
                </span>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
