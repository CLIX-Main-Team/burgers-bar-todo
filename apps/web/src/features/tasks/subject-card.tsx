import type { TaskSubject } from '@burgers/shared'
import { Link } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { hashedTone, toneClass } from '../../components/ui/avatar-color.js'
import { AvatarStack } from '../../components/ui/avatar.js'
import { DropdownMenu, DropdownMenuItem } from '../../components/ui/dropdown-menu.js'
import { Icon } from '../../components/ui/icon.js'
import { cn } from '../../lib/cn.js'
import { TicketRail } from '../projects/ticket-rail.js'

// One subject in a department's grid (owner ask 2026-09-20): the card a department's work is
// filed under. It borrows the project card's grammar on purpose, because the two are the same
// shape of thing to a reader (a container of tasks with a name, a measure of progress and the
// people in it), and a grid that looks like the projects grid needs no learning. Four channels,
// one fact each: the tile's letter and colour is which subject, the rail is how far along, the
// faces are who is on it, the counts say the rail's fact in words.
//
// The colour is the name hashed into the person palette, the same rule the avatars use, so a
// subject needs no stored colour and keeps its tint through a rename only when the name keeps.
// The card is a link, not a decorated div: opening a subject is navigation, so it earns a URL, a
// middle-click and a back button; the whole face is the target via the stretched-title pattern
// the board already uses, which keeps the avatar tooltips and the menu clickable above it.
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
  const tone = hashedTone(subject.name)
  // The rail wants the ground alone (no ink): the first class of the tone pair.
  const fill = toneClass(tone).split(' ')[0] ?? ''
  // The first letter of the name, whatever script it is in. A grapheme, not a code unit, so a
  // name opening with an emoji or a combining mark still shows one whole character.
  const initial = [...subject.name.trim()][0] ?? ''

  return (
    <li className="group relative flex flex-col gap-3.5 rounded-lg border border-border bg-card px-4 py-4 shadow-sm transition-colors hover:border-border-strong">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          dir="auto"
          className={cn(
            'inline-grid size-9 flex-none place-items-center rounded-[0.625rem] text-body font-bold',
            toneClass(tone),
          )}
        >
          {initial}
        </span>

        <div className="min-w-0 flex-1">
          <Link
            to={`/tasks/subjects/${subject.id}`}
            dir="auto"
            aria-label={t('tasks.subjectOpen', { name: subject.name })}
            className="block truncate text-body font-semibold text-foreground after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
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

      <div className="flex flex-col gap-2">
        <TicketRail done={subject.doneCount} total={total} fill={fill} />
        <div className="flex items-center justify-between gap-2.5">
          <span className="text-caption tabular-nums text-muted-foreground">
            {t('tasks.subjectProgress', { open: subject.openCount, done: subject.doneCount })}
          </span>
          {/* The faces holding open work here. The API already capped the stack and counted the
              rest, so the +N is its number, not a second cap applied on top. */}
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
      </div>
    </li>
  )
}
