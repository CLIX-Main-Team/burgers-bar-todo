import {
  type ButtonHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { cn } from '../../lib/cn.js'
import { Icon } from './icon.js'

// A small anchored menu of actions or choices (issue #213, components.md §DropdownMenu),
// hand-rolled onto the tokens the way the other primitives are (there is no Radix in the
// tree). It owns the behaviours a menu must carry so no call site re-implements them: click
// outside to dismiss, Escape to close and return focus to the trigger, Tab to close, and
// roving arrow-key focus across the rows. Rows are at least the touch minimum tall; a checked
// row (the current task status under "Move to…") shows a check and the accent surface. Tokens:
// popover and popover-foreground for the menu, accent for the active/checked row, elevation-md.

interface MenuContext {
  close: () => void
}
const DropdownMenuContext = createContext<MenuContext | null>(null)

function useMenu(): MenuContext {
  const ctx = useContext(DropdownMenuContext)
  if (!ctx) throw new Error('DropdownMenu item rendered outside a DropdownMenu')
  return ctx
}

export function DropdownMenu({
  label,
  trigger,
  children,
  align = 'end',
}: {
  // The accessible name of the menu itself (aria-label on the role="menu" container).
  label: string
  // Render the trigger control; spread the given props onto it so the menu can drive its
  // aria-expanded / aria-haspopup and open it on click.
  trigger: (props: {
    ref: (node: HTMLButtonElement | null) => void
    onClick: () => void
    'aria-haspopup': 'menu'
    'aria-expanded': boolean
  }) => ReactNode
  children: ReactNode
  // Which edge the menu aligns to under the trigger; logical, so it mirrors in RTL.
  align?: 'start' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const close = useCallback(() => setOpen(false), [])

  // Dismiss on a pointer press anywhere outside the trigger-and-menu, the ordinary menu
  // behaviour; a press on the trigger is handled by its own click (toggle), so it is excluded.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // On open, move focus into the menu (the first row) so keyboard and screen-reader users land
  // where the actions are; closing returns focus to the trigger where they left off.
  useEffect(() => {
    if (open) {
      // Land on the first *enabled* row: the current status under "Move to…" is a disabled
      // radio, so focusing it would no-op and strand the keyboard user (an employee's card
      // opens straight onto that disabled row otherwise).
      const first = menuRef.current?.querySelector<HTMLElement>(
        '[role^="menuitem"]:not([disabled])',
      )
      first?.focus()
    }
  }, [open])

  // Only enabled rows take roving focus, so Arrow keys never stick on the disabled current status.
  const items = () =>
    Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])') ?? [],
    )

  // Roving focus across the rows; Escape and Tab both close, Escape returning focus to the
  // trigger so the keyboard path is reversible.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const rows = items()
    const active = document.activeElement as HTMLElement | null
    const index = active ? rows.indexOf(active) : -1
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        rows[(index + 1) % rows.length]?.focus()
        break
      case 'ArrowUp':
        event.preventDefault()
        rows[(index - 1 + rows.length) % rows.length]?.focus()
        break
      case 'Home':
        event.preventDefault()
        rows[0]?.focus()
        break
      case 'End':
        event.preventDefault()
        rows[rows.length - 1]?.focus()
        break
      case 'Escape':
        event.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
        break
      case 'Tab':
        setOpen(false)
        break
    }
  }

  return (
    <span className="relative inline-flex">
      {trigger({
        ref: (node) => {
          triggerRef.current = node
        },
        onClick: () => setOpen((v) => !v),
        'aria-haspopup': 'menu',
        'aria-expanded': open,
      })}
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          className={cn(
            'absolute top-full z-20 mt-1 min-w-44 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md',
            align === 'end' ? 'end-0' : 'start-0',
          )}
        >
          <DropdownMenuContext.Provider value={{ close }}>{children}</DropdownMenuContext.Provider>
        </div>
      ) : null}
    </span>
  )
}

const rowBase =
  'flex w-full min-h-9 items-center gap-2 rounded-sm px-2 text-start text-body text-popover-foreground outline-none'
// Default rows warm to the accent surface on hover/focus. A destructive row keeps its danger
// colour on hover/focus instead of being overwritten by the accent foreground — the destroy
// signal must survive the pointer, so its own hover/focus tokens are applied, not the accent's.
const rowHover =
  'hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground'
const rowHoverDestructive =
  'text-destructive hover:bg-destructive-muted hover:text-destructive-muted-foreground focus-visible:bg-destructive-muted focus-visible:text-destructive-muted-foreground'

// A plain action row (Edit, Delete). `tone="destructive"` paints the label in the destructive
// role for a destroy action, which still routes its confirmation through an AlertDialog — the
// row only opens it.
export function DropdownMenuItem({
  onSelect,
  tone = 'default',
  className,
  children,
  ...props
}: {
  onSelect: () => void
  tone?: 'default' | 'destructive'
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onSelect'>) {
  const { close } = useMenu()
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className={cn(rowBase, tone === 'destructive' ? rowHoverDestructive : rowHover, className)}
      onClick={() => {
        close()
        onSelect()
      }}
      {...props}
    >
      {children}
    </button>
  )
}

// A choosable row that reflects a current selection — the three statuses under "Move to…",
// the current one checked. It keeps the check column reserved on every row so the labels line
// up whether or not a row is the current one, and the checked row carries the accent surface.
export function DropdownMenuRadioItem({
  checked,
  onSelect,
  className,
  children,
  ...props
}: {
  checked: boolean
  onSelect: () => void
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onSelect'>) {
  const { close } = useMenu()
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      tabIndex={-1}
      className={cn(rowBase, rowHover, checked && 'bg-accent text-accent-foreground', className)}
      onClick={() => {
        close()
        onSelect()
      }}
      {...props}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {checked ? <Icon name="selected" size="sm" /> : null}
      </span>
      {children}
    </button>
  )
}

// A non-interactive group heading inside the menu ("Move to"). The caller gives it an `id` and
// points a wrapping `role="group"`'s `aria-labelledby` at it (see MoveToItems), so the heading
// names its section to assistive tech rather than reading as a stray row.
export function DropdownMenuLabel({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('px-2 py-1 text-xs font-medium text-muted-foreground', className)}
      {...props}
    >
      {children}
    </div>
  )
}

export function DropdownMenuSeparator() {
  // A native <hr> carries the separator role implicitly without an explicit interactive role,
  // so it divides the menu's sections without being a focus stop.
  return <hr className="my-1 h-px border-0 bg-border" />
}
