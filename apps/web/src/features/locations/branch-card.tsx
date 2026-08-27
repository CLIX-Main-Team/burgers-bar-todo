import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { AvatarStack } from '../../components/ui/avatar.js'
import { Icon } from '../../components/ui/icon.js'
import { BranchDisc } from './branch-disc.js'

// One branch as a box (owner ask 2026-08-26, round 13, naming the Access page as the reference).
// It replaces BOTH shells the list used to carry — the desktop table and the phone card rows —
// with one grid that reflows, so there is a single answer to "what does a branch look like"
// instead of two that had to be kept in step by hand.
//
// Five rows of one kind under the branch's name: admin, manager, people, open tasks, projects.
// The word at the start, its answer at the end, every line the same shape. Two other cuts were
// built first — the numbers stacked in a footer, then the numbers in their own column beside the
// names — and both read as two things stapled together rather than one branch (owner calls, same
// day). A list somebody reads straight down beat both of them.
//
// Faces rather than names (owner ask, same day, pointing at the task card's assignee stack): the
// stack caps at three and rolls the rest into a +N, and every disc names its person on hover and
// on press-and-hold, so a phone reaches the names too. The trade is real and deliberate — the old
// table printed the admin's name outright and a face has to be hovered — but it is what keeps
// every box one height whether a branch has one manager or five.

export interface BranchCardProps {
  id: string
  name: string
  number: number | null
  city: string | null
  adminNames: string[]
  managerNames: string[]
  peopleNames: string[]
  openTasks: number
  overdueTasks: number
  projects: number
}

// One line of the box: the word at the start, its answer at the end. Every one of the five is
// this shape (owner call 2026-08-26, after two other cuts were tried and rejected) — the number
// beside its label, never stacked above it, so the five read as one list rather than as a list
// with a scoreboard bolted to it.
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[26px] items-center justify-between gap-3">
      <span className="text-label text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

// The people rows. `Unassigned` fills the gap for a branch with no admin, which since the role
// split is not a tidy blank but a branch nobody is accountable for — the one absence on this
// card worth stating in words.
function PeopleRow({
  label,
  names,
  srLabel,
  overflowLabel,
}: {
  label: string
  names: string[]
  srLabel: string
  overflowLabel: string
}) {
  const t = useTranslations()

  return (
    <Row label={label}>
      {names.length === 0 ? (
        <span className="text-label text-muted-foreground/70">{t('locations.unassigned')}</span>
      ) : (
        <AvatarStack names={names} label={srLabel} max={3} overflowLabel={overflowLabel} />
      )}
    </Row>
  )
}

export function BranchCard({
  id,
  name,
  number,
  city,
  adminNames,
  managerNames,
  peopleNames,
  openTasks,
  overdueTasks,
  projects,
}: BranchCardProps) {
  const t = useTranslations()

  return (
    // `relative` + the Link's inset overlay makes the whole box one link and one tab stop, the
    // same technique the table row used. h-full so a card fills its grid track: `auto-rows-fr`
    // gives every track the tallest card's height, and without this the short ones would sit in
    // the top of theirs with a gap under them.
    <li className="relative flex h-full flex-col rounded-xl border border-border bg-card p-3.5 shadow-sm transition-colors hover:border-muted-foreground/40 hover:bg-muted/30 has-[a:focus-visible]:border-muted-foreground/40 motion-reduce:transition-none">
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
          {/* The chain's branch number leads the caption — it is how the client's own sheet
              names a branch — with the city after it when there is one. */}
          {number !== null || city ? (
            <span className="block truncate text-caption text-muted-foreground" dir="auto">
              {[number !== null ? `#${number}` : null, city].filter(Boolean).join(' · ')}
            </span>
          ) : null}
        </div>
        {/* Decorative: the branch name already labels the link this chevron belongs to. */}
        <Icon name="row-forward" size="sm" className="flex-none text-muted-foreground" />
      </div>

      {/* Five rows of one kind. The work numbers were tried under the names and then beside them
          in a column of their own; both cuts made the box read as two things stapled together
          (owner calls, 2026-08-26). As rows they are the same shape the names already use — the
          word at the start, the answer at the end — and the box is one list, read straight down. */}
      <div className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
        <PeopleRow
          label={t('locations.colAdmin')}
          names={adminNames}
          srLabel={t('locations.colAdmin')}
          overflowLabel={t('locations.morePeople', { count: Math.max(adminNames.length - 3, 0) })}
        />
        <PeopleRow
          label={t('locations.colManager')}
          names={managerNames}
          srLabel={t('locations.colManager')}
          overflowLabel={t('locations.morePeople', {
            count: Math.max(managerNames.length - 3, 0),
          })}
        />
        <PeopleRow
          label={t('locations.colPeople')}
          names={peopleNames}
          srLabel={t('locations.colPeople')}
          overflowLabel={t('locations.morePeople', {
            count: Math.max(peopleNames.length - 3, 0),
          })}
        />
        <Row label={t('locations.colOpenTasks')}>
          <span className="flex items-center gap-2 text-label font-semibold text-foreground">
            {openTasks}
            {/* The only colour on the box, and the only reason an owner opens this page at all:
                a branch that is behind says so from across the grid. Never colour alone — the
                flag and the screen-reader word carry it too. */}
            {overdueTasks > 0 ? (
              <span className="inline-flex items-center gap-1 text-destructive">
                <Icon name="overdue" size="sm" className="size-4" />
                {overdueTasks}
                <span className="sr-only">{t('locations.colOverdue')}</span>
              </span>
            ) : null}
          </span>
        </Row>
        <Row label={t('locations.colProjects')}>
          <span className="text-label font-semibold text-foreground">{projects}</span>
        </Row>
      </div>
    </li>
  )
}
