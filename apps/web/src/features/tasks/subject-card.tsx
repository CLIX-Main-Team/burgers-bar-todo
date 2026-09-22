import { AVATAR_TONE_COUNT, type TaskSubject } from '@burgers/shared'
import { Link } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { toneClass } from '../../components/ui/avatar-color.js'
import { AvatarStack } from '../../components/ui/avatar.js'
import { DropdownMenu, DropdownMenuItem } from '../../components/ui/dropdown-menu.js'
import { Icon } from '../../components/ui/icon.js'
import { TILE_SURFACE } from '../../components/ui/surfaces.js'
import { cn } from '../../lib/cn.js'
import { TicketRail } from '../projects/ticket-rail.js'

// A subject's colour: its slot in the department, walked through the eight person tones. The
// slot rather than a hash of the name so that siblings up to eight apart never share a colour,
// where a hash of four names collided on the first try. The slot is fixed at creation and
// survives a rename, so a subject keeps its colour.
export function subjectFill(subject: Pick<TaskSubject, 'position'>): string {
  return toneClass((subject.position % AVATAR_TONE_COUNT) + 1).split(' ')[0] ?? ''
}

// Where a subject belongs: the branch's name, or "All branches" for the chain's (owner ask
// 2026-09-22). Worn by the tile and by the subject page's head card, so the two never say it
// differently. On a white card it is a bordered pill; on a sunken tile it is a small white chip
// instead, since a hairline on the grey read as a hole cut in it. `dir` on the inner text, not
// the pill: on the pill itself a Hebrew name flipped the whole box and moved the glyph to the
// other side of it, so a row of pills read with their glyphs on alternating edges.
export function SubjectPlacePill({
  subject,
  onTile = false,
  className,
}: {
  subject: Pick<TaskSubject, 'locationId' | 'locationName'>
  onTile?: boolean
  className?: string
}) {
  const t = useTranslations()
  return (
    <span
      className={cn(
        'inline-flex min-w-0 flex-none items-center gap-1 rounded-md px-2 py-[2px] text-caption font-semibold text-muted-foreground',
        onTile ? 'bg-card' : 'border border-border-strong',
        className,
      )}
    >
      <Icon name={subject.locationId ? 'location' : 'manage-locations'} size="sm" />
      <span dir="auto" className="truncate">
        {subject.locationName ?? t('tasks.subjectAllBranches')}
      </span>
    </span>
  )
}

// One subject in a department's card (owner ask 2026-09-20; a tile sunk into the department's
// card since the Tasks redesign, 2026-09-22, the way the Dashboard's overview holds its figures).
// A subject is a container of work with a name, and the tile leads with the one number a manager
// acts on: how much of it is still open, at the Dashboard's figure size. The done count is the
// quieter line under it, the rail draws the same two numbers as tickets, and the faces are who
// is on it.
//
// The swatch beside the name is the subject's colour, the one the rail's lit notches wear, so a
// card of tiles is told apart by colour before the names are read.
//
// The tile is a link, not a decorated div: opening a subject is navigation, so it earns a URL,
// a middle-click and a back button. The whole face is the target via the stretched-title
// pattern the board already uses, which keeps the avatar tooltips and the menu clickable above it.
export function SubjectCard({
  subject,
  canManage,
  onRename,
  onDelete,
}: {
  subject: TaskSubject
  // Whether the tile wears its menu (tasks.manageSubjects). The API refuses the writes
  // regardless; this only keeps a reader from being shown a menu that would say no.
  canManage: boolean
  onRename: (subject: TaskSubject) => void
  onDelete: (subject: TaskSubject) => void
}) {
  const t = useTranslations()
  const total = subject.openCount + subject.doneCount
  const fill = subjectFill(subject)

  return (
    <li
      className={cn(
        TILE_SURFACE,
        // Flat until the pointer finds it; a ring is the hover a sunken ground can take in both
        // themes, where a darker fill would vanish into the dark one.
        'group relative flex flex-col gap-5 p-4 transition-shadow hover:ring-1 hover:ring-inset hover:ring-border-strong',
      )}
    >
      <div className="flex items-start gap-2.5">
        <span aria-hidden className={cn('mt-[0.45rem] size-2.5 flex-none rounded-[3px]', fill)} />

        <div className="min-w-0 flex-1">
          <Link
            to={`/tasks/subjects/${subject.id}`}
            dir="auto"
            aria-label={t('tasks.subjectOpen', { name: subject.name })}
            // Sized to its text, not the row: a full-width `dir="auto"` block flushes a name in
            // the other script to the far edge, stranding it from its swatch.
            className="inline-block max-w-full truncate align-top text-body font-bold text-foreground after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-[0.875rem] focus-visible:after:ring-2 focus-visible:after:ring-ring"
          >
            {subject.name}
          </Link>
          {/* Where the subject belongs (0053), so a card of tiles answers "whose is this?" at a
              glance (owner ask 2026-09-22). The chain's subjects say "All branches" rather than
              nothing: a blank read as "not placed" where it meant "everywhere". The
              description, when there is one, follows on the same line and truncates. */}
          <div className="mt-1.5 flex min-w-0 items-center gap-2 text-caption text-muted-foreground">
            <SubjectPlacePill subject={subject} onTile />
            {subject.description ? (
              <span dir="auto" className="min-w-0 truncate">
                {subject.description}
              </span>
            ) : null}
          </div>
        </div>

        {canManage ? (
          // The menu sits above the stretched link (z-10) so its press is its own, not the
          // tile's. Rests visible like the chevron beside it: a control that only appears on
          // hover is not discoverable on a touch screen.
          <DropdownMenu
            label={t('tasks.subjectMenu')}
            align="end"
            trigger={(props) => (
              <button
                type="button"
                {...props}
                aria-label={t('tasks.subjectMenu')}
                className="relative z-10 -me-1.5 -mt-1 inline-grid size-8 flex-none place-items-center rounded-md text-muted-foreground hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

      <div className="mt-auto flex flex-col gap-3">
        <div className="flex items-end justify-between gap-3">
          {/* The counts, said once for a reader and drawn once for the eye: the open number
              leads at the figure size because it is the one that changes what a manager does
              today; the done number follows in the caption ink the rail's lit notches
              restate. */}
          <p className="flex min-w-0 flex-col gap-1 tabular-nums">
            <span className="flex items-baseline gap-1.5">
              <span className="text-figure font-bold text-foreground">{subject.openCount}</span>
              <span className="text-label font-semibold text-muted-foreground">
                {t('tasks.subjectOpenLabel', { count: subject.openCount })}
              </span>
            </span>
            <span className="text-caption text-muted-foreground">
              {t('tasks.subjectDone', { count: subject.doneCount })}
            </span>
          </p>
          {/* The faces holding open work here. The API already capped the stack and counted
              the rest, so the +N is its number, not a second cap applied on top. */}
          {subject.assignees.length > 0 ? (
            <span className="relative z-10 inline-flex flex-none items-center gap-1.5">
              <AvatarStack
                people={subject.assignees}
                label={t('tasks.subjectFaces')}
                ring="ring-surface-sunken"
              />
              {subject.assigneeOverflow > 0 ? (
                <span className="text-caption tabular-nums text-muted-foreground">
                  {t('tasks.subjectMore', { count: subject.assigneeOverflow })}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
        <TicketRail done={subject.doneCount} total={total} fill={fill} empty="bg-border" />
      </div>
    </li>
  )
}
