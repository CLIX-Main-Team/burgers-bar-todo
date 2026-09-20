import { type Department, type TaskSubject, departmentLabel } from '@burgers/shared'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { AlertDialog } from '../../components/ui/alert-dialog.js'
import { Button } from '../../components/ui/button.js'
import { Icon } from '../../components/ui/icon.js'
import { Skeleton } from '../../components/ui/skeleton.js'
import { useLocale } from '../../i18n/locale.js'
import { ApiError, taskSubjectsApi } from '../../lib/api.js'
import { cn } from '../../lib/cn.js'
import { useRowStagger } from '../../lib/use-row-stagger.js'
import { useDepartments } from '../departments/use-departments.js'
import { StatePanel } from './board-states.js'
import { SubjectCard } from './subject-card.js'
import { SubjectDialog } from './subject-dialog.js'
import { invalidateSubjects, useAllSubjects } from './subject-queries.js'

// The first level of the shared board (owner ask 2026-09-20): a department, and the subjects its
// work is filed under. A chain-horizon viewer picks the department from a row of chips; a
// department-held viewer is already in theirs, so the chips are not drawn and the department's
// name is the heading. Under either, the same grid of cards.
//
// Every subject the viewer reaches comes in one read (the API narrows it to their horizon), so
// the chips' counts, the grid and the empty states all derive from that one list rather than a
// query per department; the seven chips are the departments list, so a department with nothing
// in it still has a chip to be found under.

// Where the chosen chip is kept between visits: the same person opens the same department most
// days, so the URL carries it for a link and the device remembers it for the next visit.
const REMEMBERED_DEPARTMENT = 'bb.tasks.department'

function rememberedSlug(): string | null {
  try {
    return window.localStorage.getItem(REMEMBERED_DEPARTMENT)
  } catch {
    return null
  }
}

function rememberSlug(slug: string): void {
  try {
    window.localStorage.setItem(REMEMBERED_DEPARTMENT, slug)
  } catch {
    // Storage is a convenience; a private window that refuses it costs nothing but the memory.
  }
}

export function DepartmentSubjects({
  chainWide,
  ownDepartmentId,
  canManage,
  term,
}: {
  // Whether the viewer's tasks.departments horizon is the chain (chips) or their own department.
  chainWide: boolean
  // The department on the viewer's own row, null while unplaced. Only read for a
  // department-held viewer; a chain viewer picks.
  ownDepartmentId: string | null
  // tasks.manageSubjects: the New subject button and each card's menu.
  canManage: boolean
  // The header search, already trimmed and lowercased: at this level it narrows subject names.
  term: string
}) {
  const t = useTranslations()
  const { locale } = useLocale()
  const departmentsQuery = useDepartments()
  const subjectsQuery = useAllSubjects()
  const [searchParams, setSearchParams] = useSearchParams()
  const [editing, setEditing] = useState<{ subject?: TaskSubject } | null>(null)
  const [deleting, setDeleting] = useState<TaskSubject | null>(null)
  // The cards rise row by row like the projects grid, the same hook and the same base delay.
  const grid = useRowStagger<HTMLUListElement>(80)
  // The chip strip scrolls on a phone, and the chosen chip may sit past its edge on a fresh
  // load (finance is sixth of seven); it is brought into view so the pressed one is the one seen.
  const strip = useRef<HTMLFieldSetElement | null>(null)

  const departments = departmentsQuery.data ?? []
  const subjects = subjectsQuery.data ?? []

  // Which department the grid shows. A chain viewer's choice lives in the URL (?department=slug),
  // seeded from the device's memory and then from the first chip; a department-held viewer's is
  // their own row, whatever the URL says.
  const urlSlug = searchParams.get('department')
  const chosen: Department | null = chainWide
    ? (departments.find((d) => d.slug === urlSlug) ??
      departments.find((d) => d.slug === rememberedSlug()) ??
      departments[0] ??
      null)
    : (departments.find((d) => d.id === ownDepartmentId) ?? null)

  // Write the resolved choice back to the URL once the list has loaded, so a refresh and a
  // shared link land on the same chips, and remember it for next time.
  useEffect(() => {
    if (!chainWide || !chosen || chosen.slug === urlSlug) return
    setSearchParams(
      (params) => {
        params.set('department', chosen.slug)
        return params
      },
      { replace: true },
    )
  }, [chainWide, chosen, urlSlug, setSearchParams])
  useEffect(() => {
    if (chainWide && chosen) rememberSlug(chosen.slug)
  }, [chainWide, chosen])
  useEffect(() => {
    if (!chosen) return
    strip.current
      ?.querySelector<HTMLElement>('[aria-pressed="true"]')
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [chosen])

  const selectDepartment = (department: Department) => {
    setSearchParams((params) => {
      params.set('department', department.slug)
      return params
    })
  }

  // Open work per department, for the chips: summed off the one subjects read, so the numbers
  // agree with the cards they lead to.
  const openByDepartment = new Map<string, number>()
  for (const subject of subjects) {
    openByDepartment.set(
      subject.departmentId,
      (openByDepartment.get(subject.departmentId) ?? 0) + subject.openCount,
    )
  }

  const shown = chosen
    ? subjects.filter(
        (subject) =>
          subject.departmentId === chosen.id &&
          (term === '' || subject.name.toLowerCase().includes(term)),
      )
    : []

  const remove = useMutation({
    mutationFn: (subject: TaskSubject) => taskSubjectsApi.remove(subject.id),
    onSuccess: () => {
      invalidateSubjects()
      setDeleting(null)
    },
  })
  // A subject still holding work cannot go (the API refuses with the count). The card already
  // knows the viewer's count, so the confirm opens on the "move or finish first" sentence
  // straight away; the API's own 409, which counts every branch's rows, is the fallback for a
  // viewer whose card understated it.
  const refusedCount =
    remove.error instanceof ApiError && remove.error.status === 409
      ? ((remove.error.payload as { taskCount?: number } | undefined)?.taskCount ?? null)
      : null
  const heldCount = deleting ? deleting.openCount + deleting.doneCount : 0
  const inUseCount = refusedCount ?? (heldCount > 0 ? heldCount : null)

  if (departmentsQuery.isError || subjectsQuery.isError) {
    return (
      <StatePanel
        icon="board-error"
        title={t('tasks.errorTitle')}
        body={t(
          departmentsQuery.isError ? 'tasks.departmentsLoadFailed' : 'tasks.subjectsLoadFailed',
        )}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void departmentsQuery.refetch()
              void subjectsQuery.refetch()
            }}
          >
            {t('common.retry')}
          </Button>
        }
      />
    )
  }

  if (departmentsQuery.isPending || subjectsQuery.isPending) {
    return <SubjectsLoading />
  }

  // A department-held viewer with no department: told so, and told who can fix it. Nothing to
  // draw chips for and nothing the API would show them.
  if (!chosen) {
    return (
      <StatePanel
        icon="board-empty"
        title={t('tasks.noDepartment')}
        body={t('tasks.noDepartmentHint')}
        action={null}
      />
    )
  }

  const heading = departmentLabel(chosen, locale)

  return (
    <div className="flex flex-col gap-4">
      {/* On a phone the strip takes the whole width on its own row and the button sits above
          it at the inline-end; from md they share one row. Seven chips beside a button in
          270px left the chosen one off-screen. */}
      <div className="flex flex-col-reverse gap-3 md:flex-row md:flex-wrap md:items-center">
        {chainWide ? (
          // The chips: one per department, the open count beside the name. A scrolling row on a
          // phone (seven names do not fit 390px), wrapping on desktop. The chosen chip is the
          // solid blue every other chosen thing in the app wears.
          <fieldset
            ref={strip}
            aria-label={t('tasks.departmentTabs')}
            className="m-0 -mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-1 md:flex-wrap md:overflow-visible md:px-0 md:pb-0"
          >
            {departments.map((department) => {
              const active = department.id === chosen.id
              const open = openByDepartment.get(department.id) ?? 0
              return (
                <button
                  key={department.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => selectDepartment(department)}
                  className={cn(
                    'inline-flex h-8 flex-none items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-caption font-semibold transition-colors',
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
        ) : (
          <h2 dir="auto" className="text-heading-sm font-bold text-foreground">
            {heading}
          </h2>
        )}
        {canManage ? (
          <Button
            variant="outline"
            size="sm"
            className="ms-auto flex-none self-end md:self-auto"
            onClick={() => setEditing({})}
          >
            <Icon name="create" size="sm" />
            {t('tasks.newSubject')}
          </Button>
        ) : null}
      </div>

      {shown.length === 0 ? (
        term !== '' ? (
          <p className="py-6 text-center text-body text-muted-foreground">
            {t('tasks.subjectSearchNoMatches')}
          </p>
        ) : (
          <StatePanel
            icon="board-empty"
            title={t('tasks.subjectsEmpty', { department: heading })}
            body={t(canManage ? 'tasks.subjectsEmptyHint' : 'tasks.subjectsEmptyReadOnly')}
            action={
              canManage ? (
                <Button size="sm" onClick={() => setEditing({})}>
                  <Icon name="create" size="sm" />
                  {t('tasks.newSubject')}
                </Button>
              ) : null
            }
          />
        )
      ) : (
        <ul
          ref={grid}
          aria-label={heading}
          className="bb-stagger-rows grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3"
        >
          {shown.map((subject) => (
            <SubjectCard
              key={subject.id}
              subject={subject}
              canManage={canManage}
              onRename={(target) => setEditing({ subject: target })}
              onDelete={(target) => {
                remove.reset()
                setDeleting(target)
              }}
            />
          ))}
        </ul>
      )}

      {editing ? (
        <SubjectDialog
          departmentId={chosen.id}
          subject={editing.subject}
          onClose={() => setEditing(null)}
        />
      ) : null}

      <AlertDialog
        open={deleting !== null}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting)
        }}
        title={t('tasks.subjectDeleteTitle', { name: deleting?.name ?? '' })}
        description={
          inUseCount !== null
            ? t('tasks.subjectDeleteInUse', { count: inUseCount })
            : remove.isError
              ? t('tasks.subjectDeleteFailed')
              : t('tasks.subjectDeleteBody')
        }
        confirmLabel={t('tasks.subjectDeleteConfirm')}
        cancelLabel={t('common.cancel')}
        confirmDisabled={remove.isPending || inUseCount !== null}
      />
    </div>
  )
}

// Silhouettes shaped like the cards, so the grid does not jump when the data lands.
function SubjectsLoading() {
  const t = useTranslations()
  return (
    <ul
      aria-busy="true"
      aria-label={t('tasks.loadingBoard')}
      className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3"
    >
      {[0, 1, 2].map((slot) => (
        <li
          key={slot}
          className="flex flex-col gap-3.5 rounded-lg border border-border bg-card px-4 py-4"
        >
          <div className="flex items-start gap-3">
            <Skeleton className="size-9 rounded-[0.625rem]" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
          <Skeleton className="h-1.5 w-full rounded-full" />
        </li>
      ))}
    </ul>
  )
}
