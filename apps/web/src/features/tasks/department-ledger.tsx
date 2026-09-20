import { type Department, type TaskSubject, departmentLabel } from '@burgers/shared'
import { type ReactNode, useEffect, useRef } from 'react'
import { useTranslations } from 'use-intl'
import { useLocale } from '../../i18n/locale.js'
import { cn } from '../../lib/cn.js'
import { subjectFill } from './subject-card.js'

// The furniture around a department's subject cards (design pass 2026-09-20, direction "index
// and ledger"). Two pieces, one idea: the department index says which departments there are and
// how much is open in each, and the ledger head says what the chosen one adds up to before the
// cards break it down. A reader with the whole chain scans the index, lands on a department,
// reads its one-line sum, then the share bar tells them where the open work sits before a
// single card is read.

// The picker: one pressed button per department, the open count beside the name. Two layouts
// from one list because the same choice is made on two very different widths. From lg it is a
// vertical INDEX at the inline start, the chosen row filled the solid blue every chosen thing
// in the app wears; below lg it is the scrolling STRIP of chips the phone already knew, since
// seven names do not fit 390px and a column would push the cards under the fold.
export function DepartmentPicker({
  layout,
  departments,
  chosen,
  openByDepartment,
  onSelect,
}: {
  layout: 'index' | 'strip'
  departments: Department[]
  chosen: Department
  openByDepartment: Map<string, number>
  onSelect: (department: Department) => void
}) {
  const t = useTranslations()
  const { locale } = useLocale()
  // The strip scrolls, and the chosen chip may sit past its edge on a fresh load (finance is
  // sixth of seven); it is brought into view so the pressed one is the one seen.
  const strip = useRef<HTMLFieldSetElement | null>(null)
  const chosenId = chosen.id
  useEffect(() => {
    if (layout !== 'strip') return
    strip.current
      ?.querySelector<HTMLElement>(`[data-department="${chosenId}"]`)
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [layout, chosenId])

  if (layout === 'index') {
    return (
      <nav aria-label={t('tasks.departmentTabs')} className="flex flex-col gap-2">
        <p className="px-2.5 text-caption font-bold uppercase tracking-[0.06em] text-muted-foreground">
          {t('tasks.departmentIndex')}
        </p>
        <ul className="flex flex-col gap-0.5">
          {departments.map((department) => {
            const active = department.id === chosen.id
            const open = openByDepartment.get(department.id) ?? 0
            return (
              <li key={department.id}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelect(department)}
                  className={cn(
                    'flex h-9 w-full items-center justify-between gap-2 rounded-md px-2.5 text-label font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <span dir="auto" className="truncate">
                    {departmentLabel(department, locale)}
                  </span>
                  {/* The count keeps its slot at zero so the names stay one column; only the
                      ink goes quiet. */}
                  <span
                    className={cn(
                      'flex-none text-caption tabular-nums',
                      active
                        ? 'text-primary-foreground/80'
                        : open > 0
                          ? 'text-foreground'
                          : 'text-muted-foreground/50',
                    )}
                  >
                    {open}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
    )
  }

  return (
    <fieldset
      ref={strip}
      aria-label={t('tasks.departmentTabs')}
      className="m-0 -mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 pb-1 scroll-px-4 [scrollbar-width:none]"
    >
      {departments.map((department) => {
        const active = department.id === chosen.id
        const open = openByDepartment.get(department.id) ?? 0
        return (
          <button
            key={department.id}
            type="button"
            data-department={department.id}
            aria-pressed={active}
            onClick={() => onSelect(department)}
            className={cn(
              'inline-flex h-8 flex-none items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-caption font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border-strong bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            <span dir="auto">{departmentLabel(department, locale)}</span>
            {open > 0 ? (
              <span
                className={cn(
                  'tabular-nums',
                  active ? 'text-primary-foreground/80' : 'text-muted-foreground',
                )}
              >
                {open}
              </span>
            ) : null}
          </button>
        )
      })}
    </fieldset>
  )
}

// The ledger head: the department's name where a section title goes, its sum in one line, and
// the share bar. The bar is the level's one signature: a single track split by subject, each
// piece the subject's own colour and as wide as its share of the open work, so "where is this
// department's work piling up" is answered by proportion before any number is read. The card
// below wears the same colour as a swatch beside its name, which makes the bar a legend and
// the grid its entries. Hovering a piece lights its card; pressing one moves focus to it.
export function DepartmentLedgerHead({
  department,
  subjects,
  action,
  onHighlight,
  onJump,
}: {
  department: Department
  // Every subject of this department, before the search narrows the grid: the head sums the
  // department, not the matches.
  subjects: TaskSubject[]
  // The New subject button, or nothing for a reader who may not.
  action: ReactNode
  onHighlight: (subjectId: string | null) => void
  onJump: (subjectId: string) => void
}) {
  const t = useTranslations()
  const { locale } = useLocale()
  const open = subjects.reduce((sum, subject) => sum + subject.openCount, 0)
  const done = subjects.reduce((sum, subject) => sum + subject.doneCount, 0)
  const shares = subjects.filter((subject) => subject.openCount > 0)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 dir="auto" className="truncate text-heading-md font-extrabold text-foreground">
            {departmentLabel(department, locale)}
          </h2>
          <p className="mt-0.5 text-label tabular-nums text-muted-foreground">
            {t('tasks.ledgerSummary', { subjects: subjects.length, open, done })}
          </p>
        </div>
        {action}
      </div>

      {shares.length === 0 ? (
        <div aria-hidden="true" className="h-2 rounded-full bg-muted" />
      ) : (
        // A list, not a fieldset: Chromium lays a fieldset's children out in an anonymous box
        // that ignores the fieldset's height, and the pieces collapsed to nothing.
        <ul aria-label={t('tasks.shareBar')} className="flex h-2 gap-[2px]">
          {shares.map((subject) => (
            <li
              key={subject.id}
              style={{ flexGrow: subject.openCount }}
              className="flex min-w-[3px] basis-0 overflow-hidden rounded-[2px] first:rounded-s-full last:rounded-e-full"
            >
              <button
                type="button"
                aria-label={t('tasks.shareOf', { name: subject.name, count: subject.openCount })}
                onPointerEnter={() => onHighlight(subject.id)}
                onPointerLeave={() => onHighlight(null)}
                onFocus={() => onHighlight(subject.id)}
                onBlur={() => onHighlight(null)}
                onClick={() => onJump(subject.id)}
                className={cn(
                  'h-full w-full transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  subjectFill(subject),
                )}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
