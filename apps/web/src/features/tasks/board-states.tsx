import { useTranslations } from 'use-intl'
import { Button } from '../../components/ui/button.js'
import { Icon } from '../../components/ui/icon.js'
import { Skeleton } from '../../components/ui/skeleton.js'
import { CARD_SURFACE, TILE_SURFACE } from '../../components/ui/surfaces.js'
import { cn } from '../../lib/cn.js'

// The board's own display states (#213, task-board mockup §Display states, components.md
// §TaskBoard). Each is a state screen, not a bare line of text: loading is Skeleton cards
// shaped like the real ones (never a spinner on a blank screen), empty is a warm invitation
// with a create call to action, and error says what to do next without apology (principle 4).

// One skeleton shaped like a task tile: a title bar, then a meta line of a face and a short
// run, the same silhouette real tiles land in, so the layout does not jump when data arrives.
function SkeletonTile() {
  return (
    <div className={cn(TILE_SURFACE, 'flex flex-col gap-3 p-3.5')}>
      <Skeleton className="h-4 w-2/3" />
      <div className="flex items-center gap-2">
        <Skeleton className="size-[23px] rounded-full" />
        <Skeleton className="h-4 w-16" />
      </div>
    </div>
  )
}

// A lane's card holding three tiles. The region carries aria-busy and the accessible name, so
// assistive tech announces the board as loading once, rather than reading the silhouettes.
export function BoardLoading() {
  const t = useTranslations()
  return (
    <div
      aria-busy="true"
      aria-label={t('tasks.loadingBoard')}
      className={cn(CARD_SURFACE, 'flex flex-col gap-2.5 p-3 lg:max-w-[calc((100%-2.25rem)/3)]')}
    >
      <Skeleton className="mx-1.5 mb-1.5 mt-1 h-5 w-24" />
      <SkeletonTile />
      <SkeletonTile />
      <SkeletonTile />
    </div>
  )
}

// A shared panel for the empty and error states: a glyph in its sunken well, a short title, a
// warm line, and one action. `framed` gives it a card of its own for where it stands on the page
// in place of one (Tasks redesign 2026-09-22: the dashed outline it used to wear was the one
// dashed line left on the page); without it, it sits bare inside a card that is already there.
export function StatePanel({
  icon,
  title,
  body,
  action,
  framed = false,
}: {
  icon: 'board-empty' | 'board-error'
  title: string
  body: string
  action: React.ReactNode
  framed?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 px-4 py-10 text-center',
        framed && CARD_SURFACE,
      )}
    >
      <span className="mb-1 inline-grid size-14 place-items-center rounded-2xl bg-surface-sunken text-muted-foreground">
        <Icon name={icon} size="lg" className="size-7" />
      </span>
      <p className="text-heading-sm font-semibold text-foreground">{title}</p>
      <p className="max-w-[22ch] text-body text-muted-foreground">{body}</p>
      {action}
    </div>
  )
}

export function BoardEmpty({
  canCreate,
  onCreate,
  inSubject = false,
  inPersonal = false,
}: {
  canCreate: boolean
  onCreate: () => void
  // A subject's board (2026-09-20) invites the subject's first task, not the branch's.
  inSubject?: boolean
  // The private list says whose it is, not which branch it is for.
  inPersonal?: boolean
}) {
  const t = useTranslations()
  // The empty board reads differently by role. A manager or admin is invited to create the first
  // task (a create call to action). An employee cannot create tasks, so their empty state is a
  // warm line only — "nothing's assigned to you right now" — with no dead-end CTA (principle 4).
  return (
    <StatePanel
      framed
      icon="board-empty"
      title={canCreate ? t('tasks.emptyTitle') : t('tasks.emptyTitleEmployee')}
      body={
        inPersonal
          ? t('tasks.personalEmpty')
          : canCreate
            ? t(inSubject ? 'tasks.emptyBodySubject' : 'tasks.emptyBody')
            : t('tasks.emptyBodyEmployee')
      }
      action={
        canCreate ? (
          <Button size="sm" onClick={onCreate}>
            <Icon name="create" size="sm" />
            {t('tasks.newTask')}
          </Button>
        ) : null
      }
    />
  )
}

export function BoardError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations()
  return (
    <StatePanel
      framed
      icon="board-error"
      title={t('tasks.errorTitle')}
      body={t('tasks.errorBody')}
      action={
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t('tasks.tryAgain')}
        </Button>
      }
    />
  )
}
