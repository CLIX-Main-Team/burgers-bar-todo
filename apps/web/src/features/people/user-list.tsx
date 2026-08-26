import type { Role, Task, UserSummary } from '@burgers/shared'
import { useLocale, useTranslations } from 'use-intl'
import { Avatar } from '../../components/ui/avatar.js'
import { roleLabelKey, statusLabelKey } from '../../i18n/labels.js'
import { cn } from '../../lib/cn.js'
import { PersonActions } from './person-actions.js'
import { type Presence, formatAgo, presenceOf } from './presence.js'
import { USERS_QUERY_KEY } from './users-query.js'

// Re-exported so callers keep their `import { USERS_QUERY_KEY } from './user-list.js'` path;
// the key itself lives in its own module so the list and the screen can both read it
// without a cycle.
export { USERS_QUERY_KEY }

// The roster, recut to The Counter (round 8, 2026-08-14): one flat table on desktop —
// Person / Role / Branch / Open tasks / Last active / row menu, the columns a manager acts
// on — and card rows on the phone. The invited/active/deactivated sections are gone with the
// recut; a pending or deactivated row says so on its own line instead (the phone mock's
// "Employee · Florentin · Invited"), and a deactivated row dims. Filtering lives in the
// screen's toolbar (branch + role); this renders exactly what it is given.
//
// Round 12 (2026-08-24) adds presence. It reads on two levels, because the roster answers two
// different questions at two different speeds: a green dot on the avatar for "who is here
// right now", answerable by scanning one vertical line of faces, and a words column for "and
// when was everyone else last around". The dot is deliberately the ONLY thing carried by
// colour alone, and it never travels alone — the same row always spells the state out in the
// Last active column, so the roster is readable without colour vision.

// The role badge (the artifact's rbadge): admin in the gold wash with a gold edge, manager
// on the brand black, employee as a quiet outline.
const ROLE_BADGE: Record<Role, string> = {
  // The super admin wears the brand black the rail wears; an admin keeps the gold outline, so
  // the two admin roles read as a pair without either being mistaken for the other.
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

// The face, with presence hung off it. The dot only appears for someone who is actually
// here: a grey "away" dot on every other row would be a wall of punctuation that says
// nothing, and would make the one state worth spotting harder to spot, not easier. It sits
// on the bottom inline-end corner via logical properties, so it mirrors with the rest of the
// chrome in Hebrew, and wears a ring in the surface colour so it reads as a separate mark
// rather than a bite taken out of the disc.
function PersonAvatar({
  user,
  presence,
  isSelf,
  size,
}: {
  user: UserSummary
  presence: Presence
  isSelf: boolean
  size: string
}) {
  return (
    <span className="relative inline-flex shrink-0">
      <Avatar
        name={user.displayName}
        // Your own row is marked with a ring, not by repainting the disc: since 2026-08-21
        // the colour IS the person, so overriding it here would give you a different face on
        // this one screen.
        className={cn(size, isSelf && 'ring-2 ring-primary ring-offset-1 ring-offset-card')}
      />
      {presence.kind === 'online' ? (
        <span
          aria-hidden
          className="absolute -bottom-px -end-px size-2.5 rounded-full bg-success ring-2 ring-card"
        />
      ) : null}
    </span>
  )
}

// The words half of presence — the accessible half. "Online" carries the success tone so the
// column has the same anchor the dot gives the avatar; everything else is a quiet relative
// time, because how long ago is a detail you read, not one you scan.
function PresenceLabel({ presence }: { presence: Presence }) {
  const t = useTranslations()
  // use-intl's own locale, not the app's LocaleProvider: this component needs nothing but the
  // language tag to format with, and IntlProvider already carries it wherever the roster can
  // render — so the row does not drag a second context in behind it.
  const locale = useLocale()

  if (presence.kind === 'online') {
    return <span className="font-semibold text-success">{t('users.online')}</span>
  }
  if (presence.kind === 'never') {
    // The dash is for the eye only — read aloud it is silence, and a `title` is a hover
    // affordance a keyboard never reaches. The words ride along for anyone not looking at
    // the column, which is the same bargain the dot makes with the "Online" label.
    return (
      <span className="text-muted-foreground" title={t('users.neverSignedIn')}>
        <span aria-hidden>{t('users.lastActiveNever')}</span>
        <span className="sr-only">{t('users.neverSignedIn')}</span>
      </span>
    )
  }
  return <span className="text-muted-foreground">{formatAgo(presence, locale)}</span>
}

export function UserList({
  users,
  openTasks,
  isAdmin,
  canInvite,
  selfId,
  onOpen,
  onActionError,
  // The instant the roster is being read against, passed in rather than read from the clock
  // here so a test can pin it and so every row in one render agrees on "now" — rows resolved
  // against slightly different clocks could show two people as online at the same boundary
  // and disagree about which.
  now,
}: {
  // Already filtered by the screen's branch/role toolbar.
  users: UserSummary[]
  // The open (not-done) tasks each user carries, joined client-side from the board read the
  // writer already holds; a user with none shows the quiet em dash. The list rather than a
  // tally, so the count here and the count on the person dialog's tab are the same number
  // read the same way.
  openTasks: Map<string, Task[]>
  isAdmin: boolean
  // Whether this viewer may chase a pending invite — people.invite, which a manager holds
  // since 2026-08-26. Kept apart from isAdmin because deactivation did not move with it.
  canInvite: boolean
  selfId: string
  now: number
  onOpen: (user: UserSummary) => void
  // Reported up rather than shown here: a failed write can come from a row's menu OR from the
  // person dialog's, and one notice above the roster is the honest number of places to say so.
  onActionError: () => void
}) {
  const t = useTranslations()

  const cellFor = (user: UserSummary) => openTasks.get(user.id)?.length ?? 0

  return (
    <div className="flex flex-col gap-3">
      {/* Desktop: the data table, one bordered card surface. */}
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-card shadow-sm md:block">
        <table className="w-full text-body">
          <thead>
            {/* `bg-lane` and the caption weight are the board table's head grammar
                (tasks/task-list.tsx) — the app has two tables and they should read as two
                views of one system, not two house styles. */}
            <tr className="border-b border-border bg-lane">
              <th className="w-[32%] px-4 py-[11px] text-start text-caption font-semibold tracking-wider text-muted-foreground">
                {t('users.person')}
              </th>
              <th className="px-4 py-[11px] text-start text-caption font-semibold tracking-wider text-muted-foreground">
                {t('users.role')}
              </th>
              <th className="px-4 py-[11px] text-start text-caption font-semibold tracking-wider text-muted-foreground">
                {t('users.branch')}
              </th>
              <th className="px-4 py-[11px] text-start text-caption font-semibold tracking-wider text-muted-foreground">
                {t('users.openTasks')}
              </th>
              <th className="px-4 py-[11px] text-start text-caption font-semibold tracking-wider text-muted-foreground">
                {t('users.lastActive')}
              </th>
              <th className="px-4 py-[11px]" />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const note = statusNote(user, t)
              const presence = presenceOf(user, now)
              return (
                <tr
                  key={user.id}
                  className={cn(
                    // The row lights on hover: once the frame gives the table the full
                    // monitor (2026-08-16), a wide row needs something to hold the eye
                    // across it from the name to the open-task count. It lights on
                    // keyboard focus too, so tabbing through the roster shows the same
                    // row a pointer would.
                    'relative border-b border-border last:border-b-0 hover:bg-muted/40',
                    'has-[button:focus-visible]:bg-muted/40',
                    user.status === 'deactivated' && 'opacity-60',
                  )}
                >
                  <td className="px-4 py-[11px]">
                    <div className="flex items-center gap-[11px]">
                      <PersonAvatar
                        user={user}
                        presence={presence}
                        isSelf={user.id === selfId}
                        size="size-8"
                      />
                      <div className="min-w-0">
                        {/* The row's target is this button, not a click handler on the <tr>
                            — the branch table's pattern (locations, round 9). Its `after`
                            pseudo-element stretches over the whole positioned row, so a
                            pointer can press anywhere while the thing being pressed is a
                            real button a keyboard can reach and Enter can fire. A <tr>
                            with an onClick would be neither. */}
                        <button
                          type="button"
                          onClick={() => onOpen(user)}
                          aria-label={t('users.openPerson', { name: user.displayName })}
                          className="block max-w-full truncate rounded-sm text-start font-semibold text-foreground after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <bdi>{user.displayName}</bdi>
                        </button>
                        <p className="truncate text-caption text-muted-foreground">
                          <bdi>{user.email}</bdi>
                          {note ? <> · {note}</> : null}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-[11px]">
                    <RoleBadge role={user.role} />
                  </td>
                  {/* The value is bidi-ISOLATED rather than direction-AUTO. `dir="auto"` on the
                      cell resolves the cell's own direction from its text, so a Hebrew branch
                      name flipped that one cell to RTL and pushed it to the far edge while the
                      English rows stayed put — a column that reads as ragged, with a gap down
                      the middle. <bdi> renders the Hebrew correctly without touching how the
                      cell is aligned, so every row lines up on the same edge and the column
                      follows the UI language rather than each value's script. */}
                  <td className="px-4 py-[11px]">
                    <bdi>{user.locationName ?? t('users.locationChainWide')}</bdi>
                  </td>
                  <td className="px-4 py-[11px] tabular-nums">
                    {cellFor(user) > 0 ? (
                      cellFor(user)
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-[11px] text-label tabular-nums">
                    <PresenceLabel presence={presence} />
                  </td>
                  {/* Lifted above the row-wide target the name casts. Without this the
                      overlay would sit on top of the ⋯ and swallow every press meant for
                      it, so the menu would be visible and completely dead. */}
                  <td className="relative z-10 px-4 py-[11px] text-end">
                    <PersonActions
                      user={user}
                      isAdmin={isAdmin}
                      canInvite={canInvite}
                      isSelf={user.id === selfId}
                      onError={onActionError}
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
          const presence = presenceOf(user, now)
          // Presence is the last segment rather than a fourth line: the phone row is one
          // glanceable line by design, and presence is the freshest thing on it, so it reads
          // last and keeps its own tone while the rest of the line stays quiet.
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
                'relative flex items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-[11px] shadow-sm',
                'has-[button:focus-visible]:bg-muted/40',
                user.status === 'deactivated' && 'opacity-60',
              )}
            >
              <PersonAvatar
                user={user}
                presence={presence}
                isSelf={user.id === selfId}
                size="size-9"
              />
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => onOpen(user)}
                  aria-label={t('users.openPerson', { name: user.displayName })}
                  className="block max-w-full truncate rounded-sm text-start text-body font-semibold text-foreground after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <bdi>{user.displayName}</bdi>
                </button>
                <p className="truncate text-caption text-muted-foreground">
                  <bdi>{sub}</bdi>
                  {presence.kind === 'never' ? null : (
                    <>
                      {' · '}
                      <PresenceLabel presence={presence} />
                    </>
                  )}
                </p>
              </div>
              <div className="relative z-10">
                <PersonActions
                  user={user}
                  isAdmin={isAdmin}
                  canInvite={canInvite}
                  isSelf={user.id === selfId}
                  onError={onActionError}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
