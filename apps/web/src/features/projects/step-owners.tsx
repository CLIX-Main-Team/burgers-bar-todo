import type { ProjectCandidate } from '@burgers/shared'
import { useMemo, useState } from 'react'
import { useTranslations } from 'use-intl'
import { Avatar, AvatarStack } from '../../components/ui/avatar.js'
import { DropdownMenu, DropdownMenuCheckboxItem } from '../../components/ui/dropdown-menu.js'
import { Icon } from '../../components/ui/icon.js'
import { Input } from '../../components/ui/input.js'
import { cn } from '../../lib/cn.js'

// Who owns one line of a project's checklist (owner call 2026-08-28).
//
// The TRIGGER is the task sheet's, deliberately unchanged: an avatar stack when the step has
// owners, a dashed empty seat when it does not. A step is a line in a list, and a full labelled
// picker per line would turn a five-step checklist into five forms. Two screens, one gesture.
//
// The MENU is not the task sheet's, and this is where the two part company. A task's assignee
// list is one branch's shift — fifteen names on a busy day, and a plain scroll list is right for
// it. A chain-wide project reaching every manager is forty-six branches' worth of people, where a
// flat list of first names is not a list, it is a haystack. So: a filter above, and headings that
// say which branch each run of names belongs to.
//
// Below the grouping threshold the headings are left off entirely rather than drawn once with
// everything under them, so a one-branch project reads exactly as the task sheet does.

// Names above this and the menu starts grouping and offering its filter. Two-branch projects and
// single shifts stay a plain list; the chrome appears when the list is long enough to need it.
const GROUPING_THRESHOLD = 12

// Cap on the trigger's discs, so a step held by nine people does not draw nine circles across a
// row that also has to hold the step's own text.
const STACK_CAP = 3

// The candidates, in reading order, split by the branch they work at. Branch-less HQ people get a
// group of their own rather than being filed under a blank heading — they answer to the chain,
// which is a real answer and not a missing one.
export interface CandidateGroup {
  key: string
  // Null for the HQ group; the caller names it, since only it holds the translation.
  locationName: string | null
  members: ProjectCandidate[]
}

export function groupCandidates(candidates: ProjectCandidate[]): CandidateGroup[] {
  const groups = new Map<string, CandidateGroup>()
  for (const candidate of candidates) {
    const key = candidate.locationId ?? ''
    const group = groups.get(key)
    if (group) group.members.push(candidate)
    else groups.set(key, { key, locationName: candidate.locationName, members: [candidate] })
  }
  return [...groups.values()].sort((a, b) => {
    // The chain group sorts last: it is the exception on a page about branches, and a heading
    // with no branch name in it reads better after the ones that have one than before them.
    if (a.locationName === null) return 1
    if (b.locationName === null) return -1
    return a.locationName.localeCompare(b.locationName)
  })
}

// Case- and accent-insensitive, and matched on any word of the name rather than only its start:
// somebody looking for "Cohen" types Cohen, not the given name they may not remember.
export function matchesQuery(name: string, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return true
  return name.toLocaleLowerCase().includes(needle)
}

export function StepOwners({
  candidates,
  picked,
  onToggle,
  label,
  disabled,
  busy,
}: {
  candidates: ProjectCandidate[]
  picked: string[]
  onToggle: (id: string) => void
  label: string
  disabled?: boolean
  // A write is in flight. The trigger being disabled is not enough: the menu it opened is still
  // on screen, and a second press before the first answer lands would compute its new set from
  // the same stale one, so toggling a name twice quickly left the name ON.
  busy?: boolean
}) {
  const t = useTranslations()
  const [query, setQuery] = useState('')

  // Whoever is already on the step, in the candidate list's own order, so the trigger and the
  // menu name people the same way round.
  const chosen = candidates.filter((candidate) => picked.includes(candidate.id))
  const grouping = candidates.length > GROUPING_THRESHOLD

  const groups = useMemo(() => {
    const visible = candidates.filter((candidate) => matchesQuery(candidate.displayName, query))
    return grouping
      ? groupCandidates(visible)
      : // One unnamed group is the flat list: same rendering path, no headings drawn.
        [{ key: '', locationName: null, members: visible }]
  }, [candidates, query, grouping])

  const empty = groups.every((group) => group.members.length === 0)

  return (
    <DropdownMenu
      label={label}
      align="end"
      filter={
        grouping ? (
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('projects.stepOwnerFilter')}
            aria-label={t('projects.stepOwnerFilter')}
            className="h-9"
          />
        ) : undefined
      }
      trigger={(props) => (
        <button
          {...props}
          type="button"
          disabled={disabled}
          // Named for the property, not for its value: a control findable only by whoever is
          // currently on it is not findable at all.
          aria-label={label}
          // No fixed height: an avatar disc is 23px and wears a 2px ring, so a 24px box left the
          // stack hanging out of the bottom of its own focus ring. The content sets the height.
          className="flex flex-none items-center rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          {chosen.length > 0 ? (
            <AvatarStack
              names={chosen.map((candidate) => candidate.displayName)}
              label={label}
              max={STACK_CAP}
              overflowLabel={t('projects.stepOwnerMore', {
                count: Math.max(0, chosen.length - STACK_CAP),
              })}
              // A 23px disc is inline-grid on the baseline of an inherited 27px line box, so it
              // carries 4.5px of dead leading above it and none below. Centring then centres the
              // LINE, not the disc, and the stack sat visibly low inside its own focus ring; the
              // same phantom height made a row grow 5px the moment it got its first name.
              // Collapsed here rather than inside AvatarStack, which the task cards and the
              // branch boxes are laid out around.
              className="leading-none"
            />
          ) : (
            /* A dashed ring, the empty-seat convention: it reads as a slot waiting for somebody
               rather than as a button that does something to the line. Sized 23px, the avatar
               disc's own size: the seat is replaced BY a disc the moment somebody is picked, and a
               control that changes size when it gains a value makes the whole row step. */
            <span className="flex size-[23px] items-center justify-center rounded-full border border-dashed border-border-strong">
              <Icon name="create" size="sm" />
            </span>
          )}
        </button>
      )}
    >
      <div
        className={cn(
          // pb keeps the last row off the panel's rounded bottom edge; without it the final
          // name sat flush in the corner.
          'max-h-[15rem] overflow-y-auto pb-1',
          // Wider once the rows carry a branch heading, so a Hebrew branch name and a person's
          // name are not both fighting for the same fourteen characters.
          grouping ? 'w-[16.5rem]' : 'w-[13rem]',
          'max-w-[calc(100vw-2.5rem)]',
        )}
      >
        {empty ? (
          <p className="px-2 py-3 text-center text-caption text-muted-foreground">
            {t('projects.stepOwnerNoMatch')}
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.key}>
              {grouping && group.members.length > 0 ? (
                // Not a menuitem, so roving focus steps over it — a heading is not somewhere the
                // arrow keys should be able to land.
                // `dir` goes on a <bdi> around the VALUE, never on the paragraph. On the
                // paragraph it sets the whole block's direction from the branch name, and a
                // Latin branch heading under a Hebrew UI flushed itself to the opposite edge
                // from the Hebrew heading right below it (the recorded dir="auto" column trap).
                // A bdi resolves the name's own bidi while the line stays where its neighbours are.
                <p className="truncate px-2 pb-0.5 pt-2 text-caption font-bold uppercase tracking-[0.06em] text-muted-foreground">
                  <bdi>{group.locationName ?? t('projects.stepOwnerChainGroup')}</bdi>
                </p>
              ) : null}
              {group.members.map((candidate) => (
                <DropdownMenuCheckboxItem
                  key={candidate.id}
                  checked={picked.includes(candidate.id)}
                  // Dropped rather than queued: the row stays focusable (a menu of disabled rows
                  // strands the keyboard), and the next press reads a settled set.
                  onToggle={() => {
                    if (!busy) onToggle(candidate.id)
                  }}
                >
                  <Avatar
                    name={candidate.displayName}
                    className="size-[22px] flex-none text-[0.5625rem]"
                  />
                  <span dir="auto" className="min-w-0 truncate">
                    {candidate.displayName}
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
            </div>
          ))
        )}
      </div>
    </DropdownMenu>
  )
}
