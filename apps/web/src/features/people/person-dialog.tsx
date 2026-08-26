import type { Task, UserSummary } from '@burgers/shared'
import { useId } from 'react'
import { useLocale, useTranslations } from 'use-intl'
import { Avatar } from '../../components/ui/avatar.js'
import { Badge } from '../../components/ui/badge.js'
import { Button } from '../../components/ui/button.js'
import { Dialog } from '../../components/ui/dialog.js'
import { Icon } from '../../components/ui/icon.js'
import { roleLabelKey, statusLabelKey, taskStatusLabelKey } from '../../i18n/labels.js'
import { PriorityMark } from '../tasks/priority-mark.js'
import { PersonActions, canActOnPerson } from './person-actions.js'
import { formatAgo, presenceOf } from './presence.js'

// The person a roster row opens (round 12, 2026-08-24). It answers the one question a manager
// has when they stop on somebody's name: what is this person carrying.
//
// It shipped with a second tab, Access, holding nothing but a line pointing at the Access page.
// Permissions are role-level and edited there, and per-person exceptions were considered and
// declined (owner call 2026-08-26) — a role stops meaning anything once people carry private
// extras on top of it. With no per-person answer to give, the tab was a signpost charging the
// price of a tab, so it and the tab bar with it are gone and the dialog shows the task list flat.

// The identity header. The dialog's own chrome title is hidden (`hideTitle`) because THIS is the
// title — printing the name in the chrome as well would say it twice, which is the exact case
// that prop exists for. Presence rides a pill here rather than the avatar dot the roster uses: in
// the roster the dot and the word sit columns apart and each earns its place, but at this size
// they would be two marks for one fact, an inch from each other.
function PersonHeader({ user, now }: { user: UserSummary; now: number }) {
  const t = useTranslations()
  const locale = useLocale()
  const presence = presenceOf(user, now)

  return (
    <div className="flex items-start gap-3.5">
      <Avatar name={user.displayName} className="size-12 text-body" />
      <div className="min-w-0 flex-1">
        {/* The dialog's close button floats in this corner, so the two lines that could run
            under it are held clear of it. Presence used to sit up here too and collided with
            it; it now rides the end of the meta row below — past the button entirely, and
            still on the line's own edge where it stays easy to find. */}
        <p className="truncate pe-9 text-heading-sm font-bold text-foreground">
          <bdi>{user.displayName}</bdi>
        </p>
        <p className="truncate pe-9 text-label text-muted-foreground">
          <bdi>{user.email}</bdi>
        </p>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <Badge variant="muted">{t(roleLabelKey(user.role))}</Badge>
            <span className="truncate text-caption text-muted-foreground">
              <bdi>{user.locationName ?? t('users.locationChainWide')}</bdi>
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {presence.kind === 'online' ? (
              <Badge variant="success">
                <span aria-hidden className="size-1.5 rounded-full bg-current" />
                {t('users.online')}
              </Badge>
            ) : (
              <span className="text-caption text-muted-foreground">
                {presence.kind === 'never' ? t('users.neverSignedIn') : formatAgo(presence, locale)}
              </span>
            )}
            {/* Account state is a different axis from presence and only worth the ink when it
                is not the ordinary one — an active account says so by having nothing to say. */}
            {user.status === 'active' ? null : (
              <Badge variant={user.status === 'deactivated' ? 'warning' : 'muted'}>
                {t(statusLabelKey(user.status))}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// What the tab bar left behind: the label, its count, and the rule that separated the header
// from the panel. The old bar carried a gold underline to mark which of the two was showing;
// with one list and nothing to choose between, an underline under a heading would read as a
// selected tab that cannot be unselected, so the divider is a plain rule.
//
// It stays an <h3> and the list below it is labelled by it, so a screen reader still reaches
// the list through a named heading the way it used to reach it through a named tab.
function TasksHeading({ id, count }: { id: string; count: number }) {
  const t = useTranslations()

  return (
    <h3
      id={id}
      className="flex min-h-[38px] items-center gap-[7px] border-b border-border pb-[9px] text-body font-semibold text-foreground"
    >
      {t('users.openTasks')}
      <span className="text-caption font-medium text-muted-foreground">{count}</span>
    </h3>
  )
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span className="mb-1 grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground">
        <Icon name="tasks" />
      </span>
      <p className="text-body font-semibold text-foreground">{title}</p>
      <p className="max-w-[22rem] text-label text-muted-foreground">{body}</p>
    </div>
  )
}

function TaskRow({ task }: { task: Task }) {
  const t = useTranslations()
  const locale = useLocale()
  const due = task.dueDate
    ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(
        new Date(task.dueDate),
      )
    : null

  return (
    <li className="flex items-start gap-3 border-b border-border py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-medium text-foreground">
          <bdi>{task.title}</bdi>
        </p>
        <p className="mt-0.5 text-caption text-muted-foreground">
          {[t(taskStatusLabelKey(task.status)), due].filter(Boolean).join(' · ')}
        </p>
      </div>
      {/* The board's own priority mark rather than the word (owner ask). Three spelled-out
          priorities at three different widths made a ragged edge here exactly as they did on the
          board, and the flag is one fixed square whatever the priority. It brings the name with
          it — the same hover / press-and-hold tooltip and sr-only text the board's mark carries —
          so this list says priority the way every other list in the app already says it. */}
      <PriorityMark priority={task.priority} className="mt-0.5" />
    </li>
  )
}

export function PersonDialog({
  user,
  tasks,
  isAdmin,
  canInvite,
  selfId,
  now,
  onClose,
  onActionError,
}: {
  user: UserSummary
  // This person's open (not-done) tasks, already scoped by the screen from the board read it
  // holds. Scoped to open work so the heading's count is the same number the roster row showed.
  tasks: Task[]
  isAdmin: boolean
  canInvite: boolean
  selfId: string
  now: number
  onClose: () => void
  onActionError: () => void
}) {
  const t = useTranslations()
  const headingId = useId()

  return (
    <Dialog
      open
      onClose={onClose}
      title={user.displayName}
      hideTitle
      className="max-w-[34rem] pt-6"
    >
      <div className="flex flex-col gap-4">
        <PersonHeader user={user} now={now} />
        <TasksHeading id={headingId} count={tasks.length} />

        {/* The floor stays even though there are no tabs left to switch between: it is what
            keeps the dialog one size whether the person is carrying nothing or five things, so
            walking down a roster does not resize the box under the pointer doing the walking. */}
        <div className="min-h-[12.5rem]">
          {tasks.length === 0 ? (
            <EmptyPanel
              title={t('users.noOpenTasksTitle')}
              body={t('users.noOpenTasksBody', { name: user.displayName })}
            />
          ) : (
            <ul aria-labelledby={headingId} className="flex flex-col">
              {tasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </ul>
          )}
        </div>

        {/* The same actions the row's ⋯ offers, from the same component — so what the dialog
            allows can never drift from what the roster allows.
            The rule is drawn HERE and not inside the trigger: DropdownMenu wraps a trigger in an
            inline-flex span, which shrinks to its content, so a border drawn in there came out
            only as wide as the button — the stray part-width line. Asking canActOnPerson up
            front is what keeps the rule from being drawn across an empty footer. */}
        {canActOnPerson(user, isAdmin, user.id === selfId, canInvite) ? (
          <div className="flex justify-end border-t border-border pt-4">
            <PersonActions
              user={user}
              isAdmin={isAdmin}
              canInvite={canInvite}
              isSelf={user.id === selfId}
              onError={onActionError}
              trigger={(props) => (
                <Button {...props} variant="outline" size="sm" className="gap-1.5">
                  <Icon name="overflow" size="sm" />
                  {t('users.manage')}
                </Button>
              )}
            />
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
