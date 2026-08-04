import { useTranslations } from 'use-intl'
import { Button } from '../../components/ui/button.js'
import { Icon } from '../../components/ui/icon.js'
import { Skeleton } from '../../components/ui/skeleton.js'

// The board's own display states (#213, task-board mockup §Display states, components.md
// §TaskBoard). Each is a state screen, not a bare line of text: loading is Skeleton cards
// shaped like the real ones (never a spinner on a blank screen), empty is a warm invitation
// with a create call to action, and error says what to do next without apology (principle 4).

// One skeleton shaped like a TaskCard: a title bar, then a meta line of a chip and a short
// run — the same silhouette real cards land in, so the layout does not jump when data arrives.
function SkeletonCard() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <Skeleton className="h-4 w-2/3" />
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-4 w-16" />
      </div>
    </div>
  )
}

// The region carries aria-busy and the accessible name, so assistive tech announces the board
// as loading once, rather than reading three silhouettes.
export function BoardLoading() {
  const t = useTranslations()
  return (
    <div aria-busy="true" aria-label={t('tasks.loadingBoard')} className="flex flex-col gap-3">
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
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
  icon: 'board-empty' | 'board-error'
  title: string
  body: string
  action: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-10 text-center">
      <Icon name={icon} size="lg" className="size-10 text-muted-foreground" />
      <p className="text-heading-sm font-semibold text-foreground">{title}</p>
      <p className="max-w-[22ch] text-sm text-muted-foreground">{body}</p>
      {action}
    </div>
  )
}

export function BoardEmpty({ canCreate, onCreate }: { canCreate: boolean; onCreate: () => void }) {
  const t = useTranslations()
  // The empty board reads differently by role. A manager or admin is invited to create the first
  // task (a create call to action). An employee cannot create tasks, so their empty state is a
  // warm line only — "nothing's assigned to you right now" — with no dead-end CTA (principle 4).
  return (
    <StatePanel
      icon="board-empty"
      title={canCreate ? t('tasks.emptyTitle') : t('tasks.emptyTitleEmployee')}
      body={canCreate ? t('tasks.emptyBody') : t('tasks.emptyBodyEmployee')}
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
