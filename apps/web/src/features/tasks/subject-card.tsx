import { AVATAR_TONE_COUNT, type TaskSubject } from '@burgers/shared'
import { Link } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { toneClass } from '../../components/ui/avatar-color.js'
import { AvatarStack } from '../../components/ui/avatar.js'
import { DropdownMenu, DropdownMenuItem } from '../../components/ui/dropdown-menu.js'
import { Icon } from '../../components/ui/icon.js'
import { cn } from '../../lib/cn.js'
import { TicketRail } from '../projects/ticket-rail.js'

// A subject's colour: its slot in the department, walked through the eight person tones. The
// slot rather than a hash of the name so that siblings up to eight apart never share a colour,
// where a hash of four names collided on the first try. The slot is fixed at creation and
// survives a rename, so a subject keeps its colour.
export function subjectFill(subject: Pick<TaskSubject, 'position'>): string {
  return toneClass((subject.position % AVATAR_TONE_COUNT) + 1).split(' ')[0] ?? ''
}

// One subject in a department's grid (owner ask 2026-09-20; redrawn in the ledger pass the same
// day). A subject is a container of work with a name, and the card leads with the one number a
// manager acts on: how much of it is still open. The done count is the quieter companion, the
// rail draws the same two numbers as tickets, and the faces are who is on it.
//
// The swatch beside the name is the subject's colour, the one the rail's lit tiles wear, so a
// grid of cards is told apart by colour before the names are read.
//
// The card is a link, not a decorated div: opening a subject is navigation, so it earns a URL,
// a middle-click and a back button. The whole face is the target via the stretched-title
// pattern the board already uses, which keeps the avatar tooltips and the menu clickable above it.
export function SubjectCard({
  subject,
  canManage,
  onRename,
  onDelete,
}: {
  subject: TaskSubject
  // Whether the card wears its menu (tasks.manageSubjects). The API refuses the writes
  // regardless; this only keeps a reader from being shown a menu that would say no.
  canManage: boolean
  onRename: (subject: TaskSubject) => void
  onDelete: (subject: TaskSubject) => void
}) {
  const t = useTranslations()
  const total = subject.openCount + subject.doneCount
  const fill = subjectFill(subject)

  return (
    <li className="group relative flex flex-col gap-4 rounded-lg border border-border bg-card px-4 pb-4 pt-3.5 shadow-sm transition-colors hover:border-border-strong">
      <div className="flex items-start gap-2.5">
        <span aria-hidden className={cn('mt-[0.45rem] size-2.5 flex-none rounded-[3px]', fill)} />

        <div className="min-w-0 flex-1">
          <Link
            to={`/tasks/subjects/${subject.id}`}
            dir="auto"
            aria-label={t('tasks.subjectOpen', { name: subject.name })}
            // Sized to its text, not the row: a full-width `dir="auto"` block flushes a name in
            // the other script to the far edge, stranding it from its swatch.
            className="inline-block max-w-full truncate align-top text-body font-semibold text-foreground after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
          >
            {subject.name}
          </Link>
          {/* The one line of description, when there is one. `dir` on the inner span, not the
              paragraph, for the reason the project card gives: a Hebrew line under a Latin title
              must not flush the block to the other edge. */}
          {subject.description ? (
            <p className="mt-0.5 truncate text-caption text-muted-foreground">
              <span dir="auto">{subject.description}</span>
            </p>
          ) : null}
        </div>

        {canManage ? (
          // The menu sits above the stretched link (z-10) so its press is its own, not the
          // card's. Rests visible like the chevron beside it: a control that only appears on
          // hover is not discoverable on a touch screen.
          <DropdownMenu
            label={t('tasks.subjectMenu')}
            align="end"
            trigger={(props) => (
              <button
                type="button"
                {...props}
                aria-label={t('tasks.subjectMenu')}
                className="relative z-10 -me-1.5 -mt-1 inline-grid size-8 flex-none place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon name="overflow" size="sm" />
              </button>
            )}
          >
            <DropdownMenuItem onSelect={() => onRename(subject)}>
              <Icon name="edit" size="sm" className="flex-none" />
              {t('tasks.renameSubject')}
            </DropdownMenuItem>
            <DropdownMenuItem tone="destructive" onSelect={() => onDelete(subject)}>
              <Icon name="delete" size="sm" className="flex-none" />
              {t('tasks.deleteSubject')}
            </DropdownMenuItem>
          </DropdownMenu>
        ) : (
          <Icon
            name="row-forward"
            size="sm"
            className="mt-1 flex-none text-muted-foreground/50 transition-colors group-hover:text-foreground"
          />
        )}
      </div>

      <div className="mt-auto flex flex-col gap-2">
        <div className="flex items-end justify-between gap-3">
          {/* The counts, said once for a reader and drawn once for the eye: the open number
              leads at heading size because it is the one that changes what a manager does
              today; the done number follows in the caption ink the rail's lit tiles restate. */}
          <p className="flex items-baseline gap-1.5 tabular-nums">
            <span className="text-heading-md font-extrabold leading-none text-foreground">
              {subject.openCount}
            </span>
            <span className="text-caption font-semibold text-muted-foreground">
              {t('tasks.subjectOpenLabel', { count: subject.openCount })}
            </span>
            <span className="text-caption text-muted-foreground">
              {t('tasks.subjectDoneCount', { done: subject.doneCount })}
            </span>
          </p>
          {/* The faces holding open work here. The API already capped the stack and counted
              the rest, so the +N is its number, not a second cap applied on top. */}
          {subject.assignees.length > 0 ? (
            <span className="relative z-10 inline-flex items-center gap-1.5">
              <AvatarStack people={subject.assignees} label={t('tasks.subjectFaces')} />
              {subject.assigneeOverflow > 0 ? (
                <span className="text-caption tabular-nums text-muted-foreground">
                  {t('tasks.subjectMore', { count: subject.assigneeOverflow })}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
        <TicketRail done={subject.doneCount} total={total} fill={fill} />
      </div>
    </li>
  )
}
