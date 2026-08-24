import type { Task, UserSummary } from '@burgers/shared'
import { useState } from 'react'
import { useLocale, useTranslations } from 'use-intl'
import { Avatar } from '../../components/ui/avatar.js'
import { Badge } from '../../components/ui/badge.js'
import { Button } from '../../components/ui/button.js'
import { Dialog } from '../../components/ui/dialog.js'
import { Icon } from '../../components/ui/icon.js'
import { roleLabelKey, statusLabelKey, taskStatusLabelKey } from '../../i18n/labels.js'
import { cn } from '../../lib/cn.js'
import { PriorityMark } from '../tasks/priority-mark.js'
import { PersonActions, canActOnPerson } from './person-actions.js'
import { formatAgo, presenceOf } from './presence.js'

// The person a roster row opens (round 12, 2026-08-24). It answers the two questions a manager
// has when they stop on somebody's name — what is this person carrying, and what may they reach
// — as two tabs over one identity header.
//
// Access ships deliberately empty. Permissions are role-level and are edited on the Access page
// (account menu), so a second editor here would be a second source of truth for the same switches.
// The tab points at where the answer lives rather than pretending to be a feature; what belongs
// here eventually is a READ of what this person may reach, which is a later piece of work.

type Tab = 'tasks' | 'access'

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

// The board's own underline-tab grammar (tasks-screen's scope tabs): gold underline on the
// selected one, the count riding beside the label, and ONE weight across both states so
// switching tabs never shoves its neighbour sideways.
function Tabs({
  tab,
  onSelect,
  taskCount,
}: {
  tab: Tab
  onSelect: (next: Tab) => void
  taskCount: number
}) {
  const t = useTranslations()
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'tasks', label: t('users.tabTasks'), count: taskCount },
    { id: 'access', label: t('users.tabAccess') },
  ]

  return (
    <fieldset
      aria-label={t('users.personTabs')}
      className="m-0 flex gap-[22px] border-b border-border p-0"
    >
      {tabs.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-pressed={tab === item.id}
          onClick={() => onSelect(item.id)}
          className={cn(
            'relative flex min-h-[38px] items-center gap-[7px] pb-[9px] text-body font-semibold',
            'rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            tab === item.id ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {item.label}
          {item.count === undefined ? null : (
            <span className="text-caption font-medium tabular-nums text-muted-foreground">
              {item.count}
            </span>
          )}
          {tab === item.id ? (
            <span
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-gold"
            />
          ) : null}
        </button>
      ))}
    </fieldset>
  )
}

function EmptyPanel({
  icon,
  title,
  body,
}: { icon: 'tasks' | 'role'; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span className="mb-1 grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground">
        <Icon name={icon} />
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
  selfId,
  now,
  onClose,
  onActionError,
}: {
  user: UserSummary
  // This person's open (not-done) tasks, already scoped by the screen from the board read it
  // holds. Scoped to open work so the count on the tab is the same number the roster row showed.
  tasks: Task[]
  isAdmin: boolean
  selfId: string
  now: number
  onClose: () => void
  onActionError: () => void
}) {
  const t = useTranslations()
  const [tab, setTab] = useState<Tab>('tasks')

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
        <Tabs tab={tab} onSelect={setTab} taskCount={tasks.length} />

        {/* A floor under the panel so switching tabs does not resize the dialog around the
            pointer that is switching them. */}
        <div className="min-h-[12.5rem]">
          {tab === 'tasks' ? (
            tasks.length === 0 ? (
              <EmptyPanel
                icon="tasks"
                title={t('users.noOpenTasksTitle')}
                body={t('users.noOpenTasksBody', { name: user.displayName })}
              />
            ) : (
              <ul className="flex flex-col">
                {tasks.map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </ul>
            )
          ) : (
            <EmptyPanel
              icon="role"
              title={t('users.tabAccess')}
              body={t('users.accessPlaceholder')}
            />
          )}
        </div>

        {/* The same actions the row's ⋯ offers, from the same component — so what the dialog
            allows can never drift from what the roster allows.
            The rule is drawn HERE and not inside the trigger: DropdownMenu wraps a trigger in an
            inline-flex span, which shrinks to its content, so a border drawn in there came out
            only as wide as the button — the stray part-width line. Asking canActOnPerson up
            front is what keeps the rule from being drawn across an empty footer. */}
        {canActOnPerson(user, isAdmin, user.id === selfId) ? (
          <div className="flex justify-end border-t border-border pt-4">
            <PersonActions
              user={user}
              isAdmin={isAdmin}
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
