import { Link } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { type AvatarPerson, AvatarStack } from '../../components/ui/avatar.js'
import { Icon } from '../../components/ui/icon.js'
import { BranchDisc } from './branch-disc.js'

// The head office as a box of its own (owner ask 2026-09-21, ADR-0029), drawn ABOVE the branch
// grid rather than inside it: "not literally a branch, but a branch for this system". It wears
// the branch box's grammar — the disc, the name, rows of one kind read straight down — so the
// eye knows what it is looking at, and drops what a branch has and an office does not: the
// chain's branch number, the admin and manager ranks (the office has every role but a branch
// admin, and the owner runs it), and the projects count, which is a branch's own. Two rows
// stay: who sits here, and how much of their work is open.
export interface HeadOfficeCardProps {
  id: string
  name: string
  people: AvatarPerson[]
  openTasks: number
  overdueTasks: number
}

export function HeadOfficeCard({ id, name, people, openTasks, overdueTasks }: HeadOfficeCardProps) {
  const t = useTranslations()

  return (
    // The same overlay-link technique as the branch box: one link, one tab stop, the whole
    // card the target. A section rather than a list item because it is not one of the grid.
    <section
      aria-label={name}
      className="relative flex flex-col rounded-xl border border-border bg-card p-3.5 shadow-sm transition-colors hover:border-muted-foreground/40 hover:bg-muted/30 has-[a:focus-visible]:border-muted-foreground/40 motion-safe:animate-rise motion-reduce:transition-none sm:max-w-[26rem]"
    >
      <div className="flex items-center gap-3">
        <BranchDisc name={name} className="size-9" />
        <div className="min-w-0 flex-1">
          <Link
            to={`/locations/${id}`}
            aria-label={t('locations.rowMenu', { name })}
            className="block truncate text-body font-semibold text-foreground after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            dir="auto"
          >
            {name}
          </Link>
          {/* Where the branch box prints "#15 · Tel Aviv", this says what the row is. */}
          <span className="block truncate text-caption text-muted-foreground">
            {t('locations.headOfficeKind')}
          </span>
        </div>
        <Icon name="row-forward" size="sm" className="flex-none text-muted-foreground" />
      </div>

      <div className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
        <div className="flex min-h-[26px] items-center justify-between gap-3">
          <span className="text-label text-muted-foreground">{t('locations.colPeople')}</span>
          {people.length === 0 ? (
            <span className="text-label text-muted-foreground/70">{t('locations.unassigned')}</span>
          ) : (
            <AvatarStack
              people={people}
              label={t('locations.colPeople')}
              max={3}
              overflowLabel={t('locations.morePeople', {
                count: Math.max(people.length - 3, 0),
              })}
            />
          )}
        </div>
        <div className="flex min-h-[26px] items-center justify-between gap-3">
          <span className="text-label text-muted-foreground">{t('locations.colOpenTasks')}</span>
          <span className="flex items-center gap-2 text-label font-semibold text-foreground">
            {openTasks}
            {overdueTasks > 0 ? (
              <span className="inline-flex items-center gap-1 text-destructive">
                <Icon name="overdue" size="sm" className="size-4" />
                {overdueTasks}
                <span className="sr-only">{t('locations.colOverdue')}</span>
              </span>
            ) : null}
          </span>
        </div>
      </div>
    </section>
  )
}
