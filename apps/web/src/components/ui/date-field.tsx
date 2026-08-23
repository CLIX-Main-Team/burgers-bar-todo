import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'use-intl'
import { useLocale } from '../../i18n/locale.js'
import { CLIP_GUTTER } from '../../lib/clip-bounds.js'
import { cn } from '../../lib/cn.js'
import { Icon } from './icon.js'

// The date control the app owns (owner review 2026-08-21). It replaces `<input type="date">`,
// which was the one control in this product drawn by the browser rather than by us: its own
// font, its own grey, its own calendar glyph, and in Hebrew it still laid the digits out left
// to right inside a right-to-left form.
//
// It is shaped around what a shift actually asks for rather than around what a calendar
// usually offers. Nearly every task on this board is due today or tomorrow, so those are one
// press at the foot of the panel instead of a hunt through a grid, and clearing a date is a
// press rather than a selection you have to undo. The month is there for everything else.
//
// The week starts on Sunday because the business it serves does. That is a real choice, not
// an oversight: an Israeli restaurant's week opens on Sunday, and a Monday-first grid would
// put the start of their week in the middle of the row.

// Six weeks are always drawn, even when a month needs five. A panel that changed height as
// you stepped through the months would move the ground under the pointer.
const WEEKS = 6
const DAYS_IN_WEEK = 7
// Fixed, so the panel can be placed against the trigger without a measure-then-jump.
const PANEL_WIDTH = 280

function toKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

// 'YYYY-MM-DD' built as a LOCAL date, never through `new Date(string)` — that parses a bare
// date as UTC midnight, which lands on the previous day for anyone west of Greenwich.
function fromKey(key: string): Date | null {
  const [year, month, day] = key.split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

// The first cell of the grid: back up from the first of the month to the Sunday on or before it.
function gridStart(month: Date): Date {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  return addDays(first, -first.getDay())
}

export function DateField({
  value,
  onChange,
  label,
  disabled,
  className,
}: {
  /** 'YYYY-MM-DD', or '' for no date. */
  value: string
  onChange: (next: string) => void
  /** The accessible name of the control, e.g. "Due date". */
  label: string
  disabled?: boolean
  className?: string
}) {
  const t = useTranslations()
  const { locale, direction } = useLocale()
  const [open, setOpen] = useState(false)
  const today = startOfDay(new Date())
  const selected = value === '' ? null : fromKey(value)
  const [month, setMonth] = useState(() => selected ?? today)
  // Which day the keyboard is on. It is its own thing from the selection: arrowing around a
  // calendar is looking, and only Enter chooses.
  const [focusedKey, setFocusedKey] = useState(() => toKey(selected ?? today))
  // Where the portalled panel sits, in viewport coordinates. Null until it has been placed,
  // which is the one frame it stays hidden rather than flashing at the top-left of the page.
  const [placement, setPlacement] = useState<{ top: number; left: number } | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const monthLabel = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
  }).format(month)
  const valueLabel = selected
    ? new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(selected)
    : null

  // The weekday header, read out of the locale rather than written down twice. Any Sunday will
  // do as the reference; this one is arbitrary and never shown.
  const weekdays = useMemo(() => {
    const reference = new Date(2026, 0, 4) // a Sunday
    const names = (weekday: 'short' | 'narrow') => {
      const format = new Intl.DateTimeFormat(locale, { weekday })
      return Array.from({ length: DAYS_IN_WEEK }, (_, index) =>
        format.format(addDays(reference, index)),
      )
    }
    // Hebrew's "short" weekday is "יום א׳", three characters and a space, which crowds a 40px
    // column and makes the header heavier than the numbers under it. So the width is chosen by
    // what the locale actually returns rather than by naming the locale: anything longer than a
    // three-letter Mon/Tue drops to the narrow form.
    const short = names('short')
    return short.some((name) => name.length > 3) ? names('narrow') : short
  }, [locale])

  const weeks = useMemo(() => {
    const start = gridStart(month)
    return Array.from({ length: WEEKS }, (_, week) =>
      Array.from({ length: DAYS_IN_WEEK }, (_, day) => addDays(start, week * DAYS_IN_WEEK + day)),
    )
  }, [month])

  // Escape closes the CALENDAR, and nothing else. The panel lives in a portal at the body, so
  // the key never bubbles through the dialog's DOM — it goes panel → body → document, where the
  // task dialog's own close listener is waiting, and the calendar's dismissal became the whole
  // form's (found 2026-08-21). Caught in the capture phase, this runs before that listener and
  // stops the event's journey there.
  useEffect(() => {
    if (!open) return
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('keydown', onEscape, true)
    return () => document.removeEventListener('keydown', onEscape, true)
  }, [open])

  // Dismiss on a press anywhere else, the same contract every other popover in the app keeps.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      // The panel is no longer a descendant of the field, so "outside" has to be asked of both.
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  // The panel is PORTALLED to the body and placed by hand (owner report 2026-08-21: opening it
  // was "not optimized"). Rendered where it is authored, it lived inside the task dialog's own
  // scrolling card — and a card that scrolls also clips, so a calendar opened near the foot of
  // the form was cut in half and had to be scrolled to. Out at the body it is clipped by
  // nothing; the cost is that its position is arithmetic rather than CSS, which is what this
  // effect does: under the trigger by default, standing above it when the space below cannot
  // hold it, and pulled back from either inline edge of the viewport.
  //
  // It follows the trigger for as long as it is open — the capture-phase scroll listener sees
  // the dialog's own scrolling, which a listener on the window alone would miss.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const anchor = trigger.getBoundingClientRect()
      const height = panelRef.current?.offsetHeight ?? 340
      const below = anchor.bottom + 4
      const above = anchor.top - height - 4
      const top =
        below + height > window.innerHeight - CLIP_GUTTER && above > CLIP_GUTTER ? above : below
      // Hung from the trigger's own reading edge, then clamped inside the viewport, so the
      // panel opens where the eye already is in either script.
      const hung = direction === 'rtl' ? anchor.right - PANEL_WIDTH : anchor.left
      const left = Math.min(
        Math.max(CLIP_GUTTER, hung),
        window.innerWidth - PANEL_WIDTH - CLIP_GUTTER,
      )
      setPlacement({ top, left })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, direction])

  const close = (returnFocus = true) => {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }

  const choose = (date: Date) => {
    onChange(toKey(date))
    close()
  }

  const clear = () => {
    onChange('')
    close()
  }

  const moveFocus = (days_: number) => {
    const from = fromKey(focusedKey) ?? today
    const next = addDays(from, days_)
    setFocusedKey(toKey(next))
    if (next.getMonth() !== month.getMonth() || next.getFullYear() !== month.getFullYear()) {
      setMonth(next)
    }
  }

  const onGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // In Hebrew the grid reads right to left, so the right arrow walks BACK through the days.
    // Anything else would send the cursor the opposite way from the eye.
    const inline = direction === 'rtl' ? -1 : 1
    const step: Record<string, number> = {
      ArrowRight: inline,
      ArrowLeft: -inline,
      ArrowDown: DAYS_IN_WEEK,
      ArrowUp: -DAYS_IN_WEEK,
    }
    const delta = step[event.key]
    if (delta !== undefined) {
      event.preventDefault()
      moveFocus(delta)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  // Keep the keyboard's day under the finger, on open and after every arrow.
  useEffect(() => {
    if (!open) return
    panelRef.current?.querySelector<HTMLElement>(`[data-day="${focusedKey}"]`)?.focus()
  }, [open, focusedKey])

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <div className="flex items-center gap-1">
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => {
            setMonth(selected ?? today)
            setFocusedKey(toKey(selected ?? today))
            setOpen((was) => !was)
          }}
          className={cn(
            'inline-flex h-8 min-w-0 items-center rounded-md px-1 text-body font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
            valueLabel ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          <span className="truncate">{valueLabel ?? t('common.dateSet')}</span>
        </button>
        {/* Clearing a date is one press from the row itself, the same undo the board's filter
            chips carry. Reopening a panel to un-choose something is two decisions for one. */}
        {valueLabel && !disabled ? (
          <button
            type="button"
            aria-label={t('common.dateClearOne', { label })}
            onClick={() => onChange('')}
            className="flex size-6 flex-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon name="close" size="sm" />
          </button>
        ) : null}
      </div>

      {open
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label={label}
              style={{
                top: placement?.top ?? 0,
                left: placement?.left ?? 0,
                width: PANEL_WIDTH,
                visibility: placement ? 'visible' : 'hidden',
              }}
              className="fixed z-[60] rounded-[10px] border border-border bg-popover p-2.5 text-popover-foreground shadow-md"
            >
              <div className="flex items-center justify-between gap-2 pb-1.5">
                <button
                  type="button"
                  aria-label={t('common.monthPrev')}
                  onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Icon name="pager-prev" size="sm" />
                </button>
                <span className="text-label font-semibold text-foreground">{monthLabel}</span>
                <button
                  type="button"
                  aria-label={t('common.monthNext')}
                  onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Icon name="pager-next" size="sm" />
                </button>
              </div>

              {/* A real table, because a month IS one: seven named columns and a row per week. It
              also gives the keyboard one tab stop for the whole month with the arrows inside
              it, instead of 42 stops between the trigger and Save. */}
              <table onKeyDown={onGridKeyDown} className="w-full border-collapse">
                <thead>
                  <tr>
                    {weekdays.map((day) => (
                      <th
                        key={day}
                        scope="col"
                        className="h-6 text-caption font-semibold text-muted-foreground"
                      >
                        {day}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((week) => (
                    <tr key={toKey(week[0] as Date)}>
                      {week.map((day) => {
                        const key = toKey(day)
                        const outside = day.getMonth() !== month.getMonth()
                        const isToday = key === toKey(today)
                        const isSelected = selected !== null && key === toKey(selected)
                        return (
                          <td key={key} className="p-0 text-center">
                            <button
                              type="button"
                              aria-pressed={isSelected}
                              aria-current={isToday ? 'date' : undefined}
                              data-day={key}
                              tabIndex={key === focusedKey ? 0 : -1}
                              onClick={() => choose(day)}
                              onFocus={() => setFocusedKey(key)}
                              className={cn(
                                'mx-auto my-px flex size-8 items-center justify-center rounded-md text-label tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                isSelected
                                  ? 'bg-primary font-semibold text-primary-foreground'
                                  : outside
                                    ? 'text-border-strong hover:bg-muted'
                                    : 'text-foreground hover:bg-muted',
                                // Today is ringed rather than filled, so it still reads as today
                                // on a day that is also the chosen one.
                                isToday &&
                                  !isSelected &&
                                  'font-semibold ring-1 ring-inset ring-primary',
                              )}
                            >
                              {day.getDate()}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* The two dates a shift actually means, and the way out. They sit at the foot
              because the grid is the thing you came for; these are the shortcuts past it. */}
              <div className="mt-2 flex items-center gap-1 border-t border-border pt-2">
                <button
                  type="button"
                  onClick={() => choose(today)}
                  className="rounded-md px-2 py-1 text-caption font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t('common.dateToday')}
                </button>
                <button
                  type="button"
                  onClick={() => choose(addDays(today, 1))}
                  className="rounded-md px-2 py-1 text-caption font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t('common.dateTomorrow')}
                </button>
                <button
                  type="button"
                  onClick={clear}
                  className="ms-auto rounded-md px-2 py-1 text-caption text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t('common.dateNone')}
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
