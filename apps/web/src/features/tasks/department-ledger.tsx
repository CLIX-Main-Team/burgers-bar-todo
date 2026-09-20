import { type Department, type TaskSubject, departmentLabel } from '@burgers/shared'
import { type ReactNode, useEffect, useRef } from 'react'
import { useTranslations } from 'use-intl'
import { useLocale } from '../../i18n/locale.js'
import { cn } from '../../lib/cn.js'

// The furniture around a department's subject cards (design pass 2026-09-20). The picker is the
// strip of chips the level opened with: the owner saw an index column and a share bar drawn in
// their place and asked for the chips back and the bar gone, keeping the head's sum and the
// redrawn cards. So: chips above, the department's name and its one-line sum below, the cards
// under that.

// One chip per department, the open count beside the name. A scrolling row on a phone (seven
// names do not fit 390px), wrapping on desktop. The chosen chip is the solid blue every other
// chosen thing in the app wears, and it is brought into view on load, since finance is sixth
// of seven and a fresh load may leave it past the strip's edge.
export function DepartmentChips({
  departments,
  chosen,
  openByDepartment,
  onSelect,
}: {
  departments: Department[]
  chosen: Department
  openByDepartment: Map<string, number>
  onSelect: (department: Department) => void
}) {
  const t = useTranslations()
  const { locale } = useLocale()
  const strip = useRef<HTMLFieldSetElement | null>(null)
  const chosenId = chosen.id
  useEffect(() => {
    strip.current
      ?.querySelector<HTMLElement>(`[data-department="${chosenId}"]`)
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [chosenId])

  return (
    <fieldset
      ref={strip}
      aria-label={t('tasks.departmentTabs')}
      className="m-0 -mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 pb-1 scroll-px-4 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0"
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

// The head over the cards: the department's name where a section title goes, its sum in one
// line (subjects, open, done), and the New subject button at the inline end.
export function DepartmentLedgerHead({
  department,
  subjects,
  action,
}: {
  department: Department
  // Every subject of this department, before the search narrows the grid: the head sums the
  // department, not the matches.
  subjects: TaskSubject[]
  // The New subject button, or nothing for a reader who may not.
  action: ReactNode
}) {
  const t = useTranslations()
  const { locale } = useLocale()
  const open = subjects.reduce((sum, subject) => sum + subject.openCount, 0)
  const done = subjects.reduce((sum, subject) => sum + subject.doneCount, 0)

  return (
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
  )
}
