import type { Role, UserSummary } from '@burgers/shared'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { Alert } from '../../components/ui/alert.js'
import { Avatar } from '../../components/ui/avatar.js'
import { roleLabelKey, statusLabelKey } from '../../i18n/labels.js'
import { cn } from '../../lib/cn.js'
import { PersonActions } from './person-actions.js'
import { USERS_QUERY_KEY } from './users-query.js'

// Re-exported so callers keep their `import { USERS_QUERY_KEY } from './user-list.js'` path;
// the key itself lives in its own module so the list and the screen can both read it
// without a cycle.
export { USERS_QUERY_KEY }

// The roster, recut to The Counter (round 8, 2026-08-14): one flat table on desktop —
// Person / Role / Branch / Open tasks / row menu, the columns a manager acts on — and card
// rows on the phone. The invited/active/deactivated sections are gone with the recut; a
// pending or deactivated row says so on its own line instead (the phone mock's
// "Employee · Florentin · Invited"), and a deactivated row dims. Filtering lives in the
// screen's toolbar (branch + role); this renders exactly what it is given.

// The role badge (the artifact's rbadge): admin in the gold wash with a gold edge, manager
// on the brand black, employee as a quiet outline.
const ROLE_BADGE: Record<Role, string> = {
  // The owner wears the brand black the rail wears; an admin keeps the gold outline, so the
  // two admin roles read as a pair without either being mistaken for the other.
  super_admin: 'border border-transparent bg-nav-surface text-nav-ink',
  admin: 'border border-gold bg-accent text-accent-foreground',
  manager: 'border border-border-strong bg-muted text-foreground',
  employee: 'border border-border-strong text-muted-foreground',
}

function RoleBadge({ role }: { role: Role }) {
  const t = useTranslations()
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-[2.5px] text-caption font-bold',
        ROLE_BADGE[role],
      )}
    >
      {t(roleLabelKey(role))}
    </span>
  )
}

// The secondary line's status note: nothing while active, the status word otherwise.
function statusNote(user: UserSummary, t: ReturnType<typeof useTranslations>) {
  return user.status === 'active' ? null : t(statusLabelKey(user.status))
}

export function UserList({
  users,
  openTasks,
  isAdmin,
  selfId,
}: {
  // Already filtered by the screen's branch/role toolbar.
  users: UserSummary[]
  // Open (not-done) task count per user id, joined client-side from the board read the
  // writer already holds; a user with none shows the quiet em dash.
  openTasks: Map<string, number>
  isAdmin: boolean
  selfId: string
}) {
  const t = useTranslations()
  const [actionFailed, setActionFailed] = useState(false)

  const cellFor = (user: UserSummary) => openTasks.get(user.id) ?? 0

  return (
    <div className="flex flex-col gap-3">
      {actionFailed ? <Alert tone="error">{t('users.actionFailed')}</Alert> : null}

      {/* Desktop: the data table, one bordered card surface. */}
      <div className="hidden overflow-x-auto rounded-xl border border-border bg-card shadow-sm md:block">
        <table className="w-full text-body">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="w-[34%] px-4 py-[11px] text-start text-caption font-bold tracking-wider text-muted-foreground">
                {t('users.person')}
              </th>
              <th className="px-4 py-[11px] text-start text-caption font-bold tracking-wider text-muted-foreground">
                {t('users.role')}
              </th>
              <th className="px-4 py-[11px] text-start text-caption font-bold tracking-wider text-muted-foreground">
                {t('users.branch')}
              </th>
              <th className="px-4 py-[11px] text-start text-caption font-bold tracking-wider text-muted-foreground">
                {t('users.openTasks')}
              </th>
              <th className="px-4 py-[11px]" />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const note = statusNote(user, t)
              return (
                <tr
                  key={user.id}
                  className={cn(
                    // The row lights on hover: once the frame gives the table the full
                    // monitor (2026-08-16), a wide row needs something to hold the eye
                    // across it from the name to the open-task count.
                    'border-b border-border last:border-b-0 hover:bg-muted/40',
                    user.status === 'deactivated' && 'opacity-60',
                  )}
                >
                  <td className="px-4 py-[11px]">
                    <div className="flex items-center gap-[11px]">
                      <Avatar
                        name={user.displayName}
                        className={cn(
                          'size-8',
                          user.id === selfId && 'bg-primary text-primary-foreground',
                        )}
                      />
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-foreground" dir="auto">
                          {user.displayName}
                        </p>
                        <p className="truncate text-caption text-muted-foreground" dir="auto">
                          {user.email}
                          {note ? ` · ${note}` : ''}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-[11px]">
                    <RoleBadge role={user.role} />
                  </td>
                  <td className="px-4 py-[11px]" dir="auto">
                    {user.locationName ?? t('users.locationChainWide')}
                  </td>
                  <td className="px-4 py-[11px] tabular-nums">
                    {cellFor(user) > 0 ? (
                      cellFor(user)
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-[11px] text-end">
                    <PersonActions
                      user={user}
                      isAdmin={isAdmin}
                      isSelf={user.id === selfId}
                      onError={() => setActionFailed(true)}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Phone: the roster as card rows — avatar, name, "Role · Branch · Invited", menu. */}
      <ul className="flex flex-col gap-2.5 md:hidden">
        {users.map((user) => {
          const note = statusNote(user, t)
          const sub = [
            t(roleLabelKey(user.role)),
            user.locationName ?? t('users.locationChainWide'),
            note,
          ]
            .filter(Boolean)
            .join(' · ')
          return (
            <li
              key={user.id}
              className={cn(
                'flex items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-[11px] shadow-sm',
                user.status === 'deactivated' && 'opacity-60',
              )}
            >
              <Avatar
                name={user.displayName}
                className={cn('size-9', user.id === selfId && 'bg-primary text-primary-foreground')}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-semibold text-foreground" dir="auto">
                  {user.displayName}
                </p>
                <p className="truncate text-caption text-muted-foreground" dir="auto">
                  {sub}
                </p>
              </div>
              <PersonActions
                user={user}
                isAdmin={isAdmin}
                isSelf={user.id === selfId}
                onError={() => setActionFailed(true)}
              />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
