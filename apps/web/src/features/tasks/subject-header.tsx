import type { TaskSubject } from '@burgers/shared'
import { Link } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { Icon } from '../../components/ui/icon.js'
import { useDepartmentName, useDepartments } from '../departments/use-departments.js'
import { StatePanel } from './board-states.js'
import { SubjectPlacePill } from './subject-card.js'

// The head of one subject's board (owner ask 2026-09-20): the way back to its department, the
// subject's name where the page title would be, whose it is (the place pill, owner ask
// 2026-09-22: inside a chain-wide subject the owner saw tasks from two branches and took it for
// a bug), its line of description, and the counts over the rows this viewer sees. Small on
// purpose: everything below it is today's board, and the header only has to say where you are.
export function SubjectHeader({
  subject,
  open,
  done,
}: {
  subject: TaskSubject
  open: number
  done: number
}) {
  const t = useTranslations()
  const departmentName = useDepartmentName()(subject.departmentId)
  const slug = useDepartments().data?.find((d) => d.id === subject.departmentId)?.slug
  const back = slug ? `/tasks?department=${encodeURIComponent(slug)}` : '/tasks'

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Link
        to={back}
        className="inline-flex w-fit items-center gap-1 text-caption font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
      >
        <Icon name="back" size="sm" className="flex-none" />
        <span dir="auto">
          {departmentName
            ? t('tasks.backToDepartment', { department: departmentName })
            : t('tasks.backToTasks')}
        </span>
      </Link>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <h1 dir="auto" className="min-w-0 truncate text-heading-lg font-extrabold text-foreground">
          {subject.name}
        </h1>
        <SubjectPlacePill subject={subject} />
      </div>
      <p className="text-label text-muted-foreground">
        {subject.description ? (
          <>
            <span dir="auto">{subject.description}</span>
            <span aria-hidden> · </span>
          </>
        ) : null}
        <span className="tabular-nums">{t('tasks.subjectProgress', { open, done })}</span>
      </p>
    </div>
  )
}

// The subject is gone, or belongs to a department this viewer cannot see: one answer for both,
// the way the API gives one, with the way back.
export function SubjectNotFound() {
  const t = useTranslations()
  return (
    <StatePanel
      icon="board-empty"
      title={t('tasks.subjectNotFound')}
      body={t('tasks.subjectNotFoundHint')}
      action={
        <Link
          to="/tasks"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong bg-card px-3 text-caption font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon name="back" size="sm" />
          {t('tasks.backToTasks')}
        </Link>
      }
    />
  )
}
