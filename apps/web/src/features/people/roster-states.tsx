import { useTranslations } from 'use-intl'
import { Button } from '../../components/ui/button.js'
import { Icon } from '../../components/ui/icon.js'
import { Skeleton } from '../../components/ui/skeleton.js'

// The roster's own display states (people build, mockup #179), matching the flagship board's
// set (features/tasks/board-states.tsx): loading is Skeleton rows shaped like real person
// cards (never a bare spinner), empty is a warm invitation with a create call to action, and
// error says what to do next without apology (principle 4). Kept in one file so the three
// states read together and share the state-panel shape.

// One skeleton shaped like a PersonCard: an avatar circle beside a name line over a shorter
// email line — the same silhouette a real card lands in, so the layout does not jump when
// data arrives.
function SkeletonPersonCard() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
      <Skeleton className="size-9 rounded-full" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  )
}

// The region carries aria-busy and the accessible name, so assistive tech announces the
// roster as loading once, rather than reading three silhouettes.
export function RosterLoading() {
  const t = useTranslations()
  return (
    <div aria-busy="true" aria-label={t('users.loading')} className="flex flex-col gap-3">
      <SkeletonPersonCard />
      <SkeletonPersonCard />
      <SkeletonPersonCard />
    </div>
  )
}

// A shared panel for the empty and error states: a centred glyph, a short title, a warm line,
// and one action.
function StatePanel({
  icon,
  title,
  body,
  action,
}: {
  icon: 'manage-users' | 'board-error'
  title: string
  body: string
  action: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-10 text-center">
      <Icon name={icon} size="lg" className="size-10 text-muted-foreground" />
      <p className="text-heading-sm font-semibold text-foreground">{title}</p>
      <p className="max-w-[24ch] text-body text-muted-foreground">{body}</p>
      {action}
    </div>
  )
}

// The empty roster: a warm invitation to add the first person, with a primary Invite call to
// action. In practice the acting principal is always in their own list, so this is a
// defensive state; it renders per spec so the roster never falls to a bare blank frame.
export function RosterEmpty({ onInvite }: { onInvite?: () => void }) {
  const t = useTranslations()
  return (
    <StatePanel
      icon="manage-users"
      title={t('users.emptyTitle')}
      body={t('users.emptyBody')}
      action={
        onInvite ? (
          <Button size="sm" onClick={onInvite}>
            <Icon name="create" size="sm" />
            {t('users.inviteCta')}
          </Button>
        ) : null
      }
    />
  )
}

export function RosterError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations()
  return (
    <StatePanel
      icon="board-error"
      title={t('users.errorTitle')}
      body={t('users.errorBody')}
      action={
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t('users.tryAgain')}
        </Button>
      }
    />
  )
}
