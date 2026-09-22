import { type Department, type TaskSubject, departmentLabel } from '@burgers/shared'
import { type ReactNode, useEffect, useId, useRef } from 'react'
import { useTranslations } from 'use-intl'
import type { IconRole } from '../../components/ui/icon-registry.js'
import { Icon } from '../../components/ui/icon.js'
import { useLocale } from '../../i18n/locale.js'
import { cn } from '../../lib/cn.js'
import { departmentIconName } from '../departments/department-icon.js'

// The furniture around a department's subjects (design pass 2026-09-20; redrawn in the Tasks
// redesign 2026-09-22).

// The strip that says which tasks the page is showing: each department, one pill apiece with its
// open count, and your own private list. It used to be two rows, a pair of underline tabs
// (Personal tasks / All tasks) over a row of department chips; the "All tasks" tab only ever led
// to the chips under it, so the two rows were one choice asked twice. Now it is one row.
//
// The private list is a different kind of place from a department, and on a desktop it lives in
// the page's header beside New task (PersonalPill, drawn by the screen), which is also what lets
// the seven departments hold one line at a laptop's width. On a phone, where the header keeps no
// buttons, it leads the strip, set off by a rule.
//
// The chosen pill is the solid blue every other "you are here" wears in the app (owner call:
// blue for where you are). A scrolling row on a phone, wrapping on desktop, and the chosen pill
// is brought into view on load, since finance is sixth of seven and a fresh load may leave it
// past the strip's edge.
export function TaskNav({
  personal,
  departments,
  chosenId,
  openByDepartment,
  onSelectPersonal,
  onSelectDepartment,
}: {
  // The private list's pill: its open count and whether it is the page being shown. Absent for
  // a role that holds no private list.
  personal: { open: number; active: boolean } | null
  departments: Department[]
  // The department being shown, or null while the private list is.
  chosenId: string | null
  openByDepartment: Map<string, number>
  onSelectPersonal: () => void
  onSelectDepartment: (department: Department) => void
}) {
  const t = useTranslations()
  const { locale } = useLocale()
  const strip = useRef<HTMLFieldSetElement | null>(null)
  const activeKey = personal?.active ? 'personal' : chosenId
  useEffect(() => {
    if (!activeKey) return
    strip.current
      ?.querySelector<HTMLElement>(`[data-nav="${activeKey}"]`)
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [activeKey])

  return (
    <fieldset
      ref={strip}
      aria-label={t('tasks.boardNav')}
      className="m-0 -mx-4 flex min-w-0 items-center gap-2 overflow-x-auto border-0 px-4 py-0.5 scroll-px-4 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0"
    >
      {personal ? (
        <>
          <PersonalPill
            open={personal.open}
            active={personal.active}
            onClick={onSelectPersonal}
            className="md:hidden"
          />
          {departments.length > 0 ? (
            <span
              aria-hidden="true"
              className="mx-1 h-5 w-px flex-none bg-border-strong md:hidden"
            />
          ) : null}
        </>
      ) : null}
      {departments.map((department) => (
        <NavPill
          key={department.id}
          navKey={department.id}
          label={departmentLabel(department, locale)}
          count={openByDepartment.get(department.id) ?? 0}
          active={!personal?.active && department.id === chosenId}
          onClick={() => onSelectDepartment(department)}
        />
      ))}
    </fieldset>
  )
}

// The private list's pill: the strip's first on a phone, the header's on a desktop.
export function PersonalPill({
  open,
  active,
  onClick,
  className,
}: {
  open: number
  active: boolean
  onClick: () => void
  className?: string
}) {
  const t = useTranslations()
  return (
    <NavPill
      navKey="personal"
      icon="account"
      label={t('tasks.personalTasks')}
      count={open}
      active={active}
      onClick={onClick}
      className={className}
    />
  )
}

function NavPill({
  navKey,
  icon,
  label,
  count,
  active,
  onClick,
  className,
}: {
  navKey: string
  icon?: IconRole
  label: string
  count: number
  active: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      data-nav={navKey}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-9 flex-none items-center gap-2 whitespace-nowrap rounded-full border ps-3.5 pe-1.5 text-label font-semibold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border-strong bg-card text-muted-foreground hover:text-foreground',
        icon && 'ps-3',
        className,
      )}
    >
      {icon ? <Icon name={icon} size="sm" className="flex-none" /> : null}
      <span dir="auto">{label}</span>
      {/* The open count in its own disc, the Dashboard's pill badge, so a zero still has a
          place to sit and the pills keep one rhythm whether or not a department is busy. */}
      <span
        className={cn(
          'inline-grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-caption tabular-nums',
          active ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted',
        )}
      >
        {count}
      </span>
    </button>
  )
}

// The head of a department's card: its mark and name where a section title goes, its sum in
// one line (subjects, open, done), and the owner's branch filter and the New subject button at
// the inline end.
export function DepartmentLedgerHead({
  department,
  subjects,
  filter,
  action,
  headingId,
}: {
  department: Department
  // Every subject of this department the branch filter leaves, before the search narrows the
  // grid: the head sums what the reader chose to look at, not the matches.
  subjects: TaskSubject[]
  // The owner's branch filter (department-subjects.tsx), or nothing for everyone else.
  filter: ReactNode
  // The New subject button, or nothing for a reader who may not.
  action: ReactNode
  // Names the card the head sits in.
  headingId?: string
}) {
  const t = useTranslations()
  const { locale } = useLocale()
  const fallbackId = useId()
  const open = subjects.reduce((sum, subject) => sum + subject.openCount, 0)
  const done = subjects.reduce((sum, subject) => sum + subject.doneCount, 0)

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className="inline-grid size-10 flex-none place-items-center rounded-xl bg-surface-sunken text-foreground"
        >
          <Icon name={departmentIconName(department.slug)} />
        </span>
        <div className="min-w-0">
          <h2
            id={headingId ?? fallbackId}
            dir="auto"
            className="truncate text-heading-md font-extrabold text-foreground"
          >
            {departmentLabel(department, locale)}
          </h2>
          <p className="mt-0.5 text-label tabular-nums text-muted-foreground">
            {t('tasks.ledgerSummary', { subjects: subjects.length, open, done })}
          </p>
        </div>
      </div>
      {filter || action ? (
        <div className="flex flex-none items-center gap-2 sm:ms-auto">
          {filter}
          {action}
        </div>
      ) : null}
    </div>
  )
}
