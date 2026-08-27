import {
  type CreateTaskRequest,
  type PrincipalResponse,
  type Role,
  type Task,
  type TaskPriority,
  type TaskStatus,
  type UpdateTaskRequest,
  type UserSummary,
  hasAdminAuthority,
  isSuperAdmin,
} from '@burgers/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type ComponentPropsWithRef, type ReactNode, useId, useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslations } from 'use-intl'
import { AlertDialog } from '../../components/ui/alert-dialog.js'
import { Alert } from '../../components/ui/alert.js'
import { Avatar, AvatarStack } from '../../components/ui/avatar.js'
import { Button } from '../../components/ui/button.js'
import { DateField } from '../../components/ui/date-field.js'
import { Dialog } from '../../components/ui/dialog.js'
import { DropdownMenu, DropdownMenuCheckboxItem } from '../../components/ui/dropdown-menu.js'
import type { IconRole } from '../../components/ui/icon-registry.js'
import { Icon } from '../../components/ui/icon.js'
import { Input } from '../../components/ui/input.js'
import { Select, type SelectOption } from '../../components/ui/select.js'
import { StatusControl } from '../../components/ui/status-control.js'
import { Textarea } from '../../components/ui/textarea.js'
import { Tooltip } from '../../components/ui/tooltip.js'
import { taskPriorityLabelKey } from '../../i18n/labels.js'
import { useLocale } from '../../i18n/locale.js'
import { ApiError, tasksApi } from '../../lib/api.js'
import { cn } from '../../lib/cn.js'
import { useLocations } from '../locations/use-locations.js'
import { STATUS_ICON } from './board-columns.js'
import { TASKS_QUERY_KEY } from './board-stream.js'
import { PRIORITY_INK } from './priority.js'

// The create / edit task dialog (#133/#134), recut to v2 (round 10) from the drawer it used
// to be. The change is what the surface leads with: a task is its title, so the title is now
// a large borderless input at the top of the card rather than the fourth labelled row down,
// and everything that describes the task — status, priority, due date, branch — sits under
// it as one compact property grid, each row an icon, a quiet label, and the control itself.
// The description follows below a rule, and the footer holds the two decisions.
//
// Recut again on the owner's review (2026-08-21), which asked what this surface is actually
// for. The answer that came out of it: every row in here was something you WRITE, and the one
// fact in the whole dialog — who made the task — was sitting in the property grid wearing the
// same shape as the controls. So the grid now holds only what you set, and everything that
// merely happened (who made it, at which branch, when it was edited, when it was finished)
// dropped to one quiet line above the footer. Three controls were redrawn with it: the due
// date is the app's own DateField rather than the browser's date input, the people are the
// coloured discs they are everywhere else in the app rather than bare checkboxes, and the
// description sits in a panel of its own instead of floating with a drag grip hanging off it.
//
// It is a centred Dialog now, not the inline-end Sheet: the drawer's shape said "a panel
// beside the board", which was never true of a form that owns the screen while it is open.
// The Dialog's own heading is hidden (`hideTitle`) but still announced, because the title
// input directly under it would otherwise say the same word twice.
//
// Everything behind the glass is unchanged. Rendered only for a manager or admin, and, like
// every write surface, it mirrors what the acting principal may do so a user is never shown
// a choice the API will reject (ADR-0007): the assignee options are exactly the active people
// at the task's own location, and a super_admin, who holds no location of their own, picks the
// board first (switching it clears the picked assignees, the assignee-location invariant). A
// branch admin, like a manager, has that location implicit and never picks. The API stays the
// sole authority regardless: it re-derives the location from the principal and re-checks the
// invariant on every write.

interface TaskFormFields {
  title: string
  description: string
  priority: TaskPriority
  // The task's status, editable through the full-update path (#134). Only shown and sent on edit
  // — a new task always starts not_started server-side, so create never offers this.
  status: TaskStatus
  // An <input type="date"> value: 'YYYY-MM-DD', or '' for no due date.
  dueDate: string
  assigneeIds: string[]
  // The board an admin is creating on; unused for a manager (their own is implied) and for edit (a
  // task never moves location).
  locationId: string
}

// One line as this sheet holds it: an id when the line is already saved on the task (so the save
// reconciles rather than rewrites), null when somebody typed it a moment ago.
interface ChecklistLine {
  id: string | null
  title: string
  done: boolean
  // Who owns this step. Naming somebody here also puts them on the TASK — the API does it on the
  // way in — so a step is never work its owner cannot see on their own board.
  assigneeIds: string[]
}

// One step the knowledge scan proposed (owner ask 2026-08-27), and whether it is still wanted.
// A separate shape from ChecklistLine on purpose: nothing here has an id or an owner yet, because
// nothing here is on the task. It becomes a ChecklistLine only when the owner presses Add.
interface ScannedStep {
  title: string
  picked: boolean
}

// The per-step owner control: an avatar stack when the step has owners, a bare plus when it does
// not. Deliberately smaller and quieter than the task's own assignee row — a step is a line in a
// list, and a full labelled picker per line would turn a five-step checklist into five forms.
function StepOwners({
  candidates,
  picked,
  onToggle,
  label,
  disabled,
}: {
  candidates: { id: string; displayName: string }[]
  picked: string[]
  onToggle: (id: string) => void
  label: string
  disabled?: boolean
}) {
  const chosen = candidates.filter((candidate) => picked.includes(candidate.id))

  return (
    <DropdownMenu
      label={label}
      align="end"
      trigger={(props) => (
        <button
          {...props}
          type="button"
          disabled={disabled}
          aria-label={label}
          className="flex h-6 flex-none items-center rounded-md px-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          {chosen.length > 0 ? (
            <AvatarStack names={chosen.map((candidate) => candidate.displayName)} label={label} />
          ) : (
            /* A dashed ring, the empty-seat convention: it reads as a slot waiting for somebody
               rather than as a button that does something to the line. */
            <span className="flex size-[22px] items-center justify-center rounded-full border border-dashed border-border-strong">
              <Icon name="create" size="sm" />
            </span>
          )}
        </button>
      )}
    >
      <div className="max-h-[15rem] w-[13rem] max-w-[calc(100vw-2.5rem)] overflow-y-auto">
        {candidates.map((candidate) => (
          <DropdownMenuCheckboxItem
            key={candidate.id}
            checked={picked.includes(candidate.id)}
            onToggle={() => onToggle(candidate.id)}
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
    </DropdownMenu>
  )
}

interface TaskFormDialogProps {
  mode: 'create' | 'edit'
  principal: PrincipalResponse
  // The already-scoped people list (GET /users): a manager's own location, an admin's whole chain.
  // The form narrows it to the task's location for the assignee choices.
  users: UserSummary[]
  // The task under edit; absent in create mode.
  task?: Task
  onClose(): void
}

// The compact trigger every property control wears inside the grid: no border, no fill, no
// caret, the value carrying full ink. The row's own label is the border here, so a boxed control
// would draw four lines around something already framed by the grid, and a caret on every row
// says "editable" three times over (owner call 2026-08-23). What is left is the value, and a
// ground that answers the pointer — which is how a property sheet reads.
// w-auto so the control ends with its own value rather than stretching to the far edge of the
// column: stretched, it looked like a field somebody had left half filled.
const BARE_CONTROL =
  'h-8 w-auto rounded-md border-0 bg-transparent px-1.5 text-body font-semibold shadow-none hover:bg-muted'

// One row of the property grid: the icon and label name the property, the control sets it.
// The label column is fixed so the controls line up down both columns of the grid.
function PropertyRow({
  icon,
  label,
  htmlFor,
  children,
}: { icon: IconRole; label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid min-h-[38px] grid-cols-[6.625rem_minmax(0,1fr)] items-center gap-2.5">
      {/* A plain <span> when the control is not a single labelable element (the status chip
          is a menu button, the assignee block a group), so the label never points nowhere. */}
      {htmlFor ? (
        <label
          htmlFor={htmlFor}
          className="inline-flex items-center gap-[7px] text-label text-muted-foreground"
        >
          <Icon name={icon} size="sm" />
          {label}
        </label>
      ) : (
        <span className="inline-flex items-center gap-[7px] text-label text-muted-foreground">
          <Icon name={icon} size="sm" />
          {label}
        </span>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  )
}

// The assignee picker: one dropdown, like the three properties around it (owner call
// 2026-08-21). It used to be a wrap of chips, which meant the Assignees row was two lines tall
// on a shift of five people and pushed Due date and Location out of the column the other rows
// were aligned in. A menu keeps every property row one line high and the same shape.
//
// It is a MULTIPLE choice — several people can carry one task — so the menu does not close when
// a row is pressed. The trigger names who is on the task, with their own coloured discs; empty,
// it says the task is unassigned, which is a real state on this board (the backlog) rather than
// a blank waiting to be filled.
function AssigneePicker({
  candidates,
  picked,
  onToggle,
  showBranch,
  label,
  emptyLabel,
  disabled,
}: {
  candidates: {
    id: string
    displayName: string
    locationId: string | null
    locationName: string | null
  }[]
  picked: string[]
  onToggle: (candidate: { id: string; locationId: string | null }) => void
  // Their branch is worth showing only while the task has none; once it does, every person here
  // works at that one branch and repeating its name on each row would say nothing.
  showBranch: boolean
  label: string
  emptyLabel: string
  disabled?: boolean
}) {
  const chosen = candidates.filter((candidate) => picked.includes(candidate.id))

  return (
    <DropdownMenu
      label={label}
      align="start"
      trigger={(props) => (
        <button
          {...props}
          type="button"
          disabled={disabled}
          // Named for the PROPERTY, the same way the Select trigger is: the visible text is
          // whoever is on the task, which changes, and a control findable only by its current
          // value is not findable at all.
          aria-label={label}
          className={cn(
            'flex h-8 min-w-0 items-center gap-2 rounded-md px-1 text-start text-body font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
            chosen.length > 0 ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {chosen.length > 0 ? (
            <>
              <AvatarStack
                names={chosen.map((candidate) => candidate.displayName)}
                label={label}
                className="flex-none"
              />
              <span dir="auto" className="truncate">
                {chosen.map((candidate) => candidate.displayName).join(', ')}
              </span>
            </>
          ) : (
            <span className="truncate">{emptyLabel}</span>
          )}
        </button>
      )}
    >
      <div className="max-h-[15rem] w-[15.5rem] max-w-[calc(100vw-2.5rem)] overflow-y-auto">
        {candidates.map((candidate) => (
          <DropdownMenuCheckboxItem
            key={candidate.id}
            checked={picked.includes(candidate.id)}
            onToggle={() => onToggle(candidate)}
          >
            <Avatar
              name={candidate.displayName}
              className="size-[22px] flex-none text-[0.5625rem]"
            />
            <span dir="auto" className="min-w-0 truncate">
              {candidate.displayName}
            </span>
            {showBranch && candidate.locationName ? (
              <span dir="auto" className="truncate ps-1 text-caption text-muted-foreground">
                {candidate.locationName}
              </span>
            ) : null}
          </DropdownMenuCheckboxItem>
        ))}
      </div>
    </DropdownMenu>
  )
}

export function TaskFormDialog({ mode, principal, users, task, onClose }: TaskFormDialogProps) {
  const t = useTranslations()
  const { locale } = useLocale()
  const queryClient = useQueryClient()
  // Picking a target board is a chain-wide act: a branch admin holds one branch, like a
  // manager, so only a super_admin, who holds none, needs the picker at all.
  const isAdmin = isSuperAdmin(principal.role)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // The assignee group is a set of checkboxes, not one labelable control, so its label points
  // at it by id rather than through htmlFor.
  const assigneeLabelId = useId()

  // The checklist as this sheet is holding it. Kept in local state rather than in the form because
  // it is a list somebody builds by gesture — type, Enter, tick, remove — not a field with a value,
  // and react-hook-form's Controller buys nothing for it.
  //
  // An item already on the task keeps its id, which is what lets the save reconcile rather than
  // clear and rewrite: renaming line three must not untick lines one and two.
  const [checklist, setChecklist] = useState<ChecklistLine[]>(
    () =>
      task?.checklist.map((item) => ({
        id: item.id,
        title: item.title,
        done: item.done,
        assigneeIds: item.assignees.map((owner) => owner.id),
      })) ?? [],
  )
  const [draftItem, setDraftItem] = useState('')
  // Whether the checklist section is open at all. Closed with nothing in it is the "+ Add checklist"
  // button; a task that already HAS one is never asked to be opened.
  const [checklistOpen, setChecklistOpen] = useState(() => (task?.checklist.length ?? 0) > 0)

  // The checklist saves itself (owner call 2026-08-26): adding, removing and ticking write through
  // on the gesture, while the title and the properties beside them still land on Save. A list is
  // built by repetition — type, Enter, type, Enter — and a run of small gestures that all need one
  // more click at the end is the shape people forget to finish.
  //
  // Create mode has no task to write to yet, so there the same gestures stage and land with Create.
  const [checklistFailed, setChecklistFailed] = useState(false)
  const checklistMutation = useMutation({
    mutationFn: (next: ChecklistLine[]) => tasksApi.setChecklist(task?.id ?? '', next),
    onSuccess: (updated) => {
      setChecklistFailed(false)
      // Re-seed from what the server stored so the new lines pick up their real ids — without this
      // the next gesture would send them back with no id and insert duplicates.
      setChecklist(
        updated.checklist.map((item) => ({
          id: item.id,
          title: item.title,
          done: item.done,
          assigneeIds: item.assignees.map((owner) => owner.id),
        })),
      )
      queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY })
    },
    // The list on screen is left exactly as the person left it. Re-reading the server's version
    // under them would silently discard the line they just typed, which is worse than a stale row
    // beside a message telling them it did not save.
    onError: () => setChecklistFailed(true),
  })
  const toggleMutation = useMutation({
    mutationFn: (input: { itemId: string; done: boolean }) =>
      tasksApi.toggleChecklistItem(task?.id ?? '', input.itemId, input.done),
    onSuccess: () => {
      setChecklistFailed(false)
      queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY })
    },
    onError: () => setChecklistFailed(true),
  })

  // The knowledge scan (owner ask 2026-08-27). The chain owner can ask the company's own documents
  // whether this task already has a written procedure, and the steps come back as a PROPOSAL: they
  // sit in a panel he ticks through and then adds, rather than landing on the task. That is not
  // caution for its own sake — on an existing task the checklist saves itself, so an automatic add
  // would write forty lines into live work with no way back.
  //
  // Only the owner sees the button, and the route refuses everyone else. The gate is by role rather
  // than by an Access-page switch: what a role may do with tasks is his to hand out, but who may
  // spend the chain's model budget reading the whole corpus is a different question.
  const [scanned, setScanned] = useState<ScannedStep[] | null>(null)
  const [scanSource, setScanSource] = useState<string | null>(null)
  // Told apart from `scanned === null` (never scanned) so the empty answer can say so out loud.
  // Finding nothing is the ordinary outcome, not a failure, and it reads as one.
  const [scanEmpty, setScanEmpty] = useState(false)
  const [scanFailed, setScanFailed] = useState(false)
  const scanMutation = useMutation({
    mutationFn: (title: string) => tasksApi.scanChecklist(title),
    onSuccess: (result) => {
      setScanFailed(false)
      setScanEmpty(result.steps.length === 0)
      setScanSource(result.sourceTitle)
      // Every step arrives ticked. The corpus is the company's own writing, so the common case is
      // that all of it belongs; unticking the two that do not is less work than picking twelve.
      setScanned(
        result.steps.length > 0 ? result.steps.map((title) => ({ title, picked: true })) : null,
      )
    },
    onError: () => {
      setScanFailed(true)
      setScanned(null)
      setScanEmpty(false)
    },
  })

  const scanning = scanMutation.isPending

  const dismissScan = () => {
    setScanned(null)
    setScanSource(null)
    setScanEmpty(false)
    setScanFailed(false)
  }

  const runScan = () => {
    const title = watchedTitle.trim()
    if (!title) return
    // Clear the previous proposal, not just the previous message. Rewording the title and
    // scanning again otherwise left the old steps sitting under a line saying the documents were
    // being read — a stale answer presented as a fresh one.
    dismissScan()
    scanMutation.mutate(title)
  }

  // Apply a change to the list on screen, then persist it when there is a task to persist it to.
  const commitChecklist = (next: ChecklistLine[]) => {
    setChecklist(next)
    if (mode === 'edit' && task) checklistMutation.mutate(next)
  }

  const addDraftItem = () => {
    const title = draftItem.trim()
    if (!title) return
    commitChecklist([...checklist, { id: null, title, done: false, assigneeIds: [] }])
    setDraftItem('')
  }

  // Land the ticked steps on the task. They join the end of the checklist as ordinary unticked
  // lines with no owners — who does each step is a decision about people, and the documents have
  // no opinion on it. On an edit this writes through like any other checklist gesture, so the
  // panel closing IS the confirmation that they saved.
  const addScannedSteps = () => {
    const picked = (scanned ?? []).filter((step) => step.picked)
    if (picked.length === 0) return
    setChecklistOpen(true)
    commitChecklist([
      ...checklist,
      ...picked.map((step) => ({ id: null, title: step.title, done: false, assigneeIds: [] })),
    ])
    dismissScan()
  }

  const tickItem = (index: number, done: boolean) => {
    const line = checklist[index]
    if (!line) return
    const next = checklist.map((item, i) => (i === index ? { ...item, done } : item))
    setChecklist(next)
    if (mode !== 'edit' || !task) return
    // A line already stored ticks through its own light path; one added a moment ago and not yet
    // saved has no id to tick by, so it rides the whole-list write instead.
    if (line.id) toggleMutation.mutate({ itemId: line.id, done })
    else checklistMutation.mutate(next)
  }

  const form = useForm<TaskFormFields>({
    defaultValues: {
      title: task?.title ?? '',
      description: task?.description ?? '',
      priority: task?.priority ?? 'normal',
      status: task?.status ?? 'not_started',
      // The stored due date is an ISO timestamp; the date input wants the calendar day alone.
      dueDate: task?.dueDate ? task.dueDate.slice(0, 10) : '',
      assigneeIds: task?.assignees.map((assignee) => assignee.id) ?? [],
      locationId: task?.locationId ?? (isAdmin ? '' : (principal.locationId ?? '')),
    },
  })

  // The priority options, labelled in the active language, in the order a person picks from:
  // the default first, then the one that changes a shift, then the one that defers it.
  const priorityOptions: SelectOption[] = useMemo(
    () =>
      // Listed as the ladder reads, floor first: normal, then medium, then high.
      (['normal', 'medium', 'high'] as const).map((priority) => ({
        value: priority,
        label: t(taskPriorityLabelKey(priority)),
        // The flag rides beside the word in the trigger and in every row, so the colour is
        // never the only thing saying which priority this is. High is filled as well as
        // coloured: the one that changes a shift should still stand out in greyscale.
        lead: (
          <Icon
            name="priority"
            size="sm"
            active={priority === 'high'}
            className={cn('flex-none', PRIORITY_INK[priority])}
          />
        ),
      })),
    [t],
  )

  // The location the assignee choices are drawn from: fixed to the task's own location on edit and
  // for a manager (their location); an admin picks it, so it follows the chosen board.
  const watchedLocationId = form.watch('locationId')
  // The picked people, watched so each chip can paint its own on/off state — the checkbox
  // inside it is visually hidden, so the chip cannot read the state off the DOM with :checked.
  const watchedAssigneeIds = form.watch('assigneeIds')
  // dir="auto" reads the direction off the CONTENT, which is what an authored title needs: a
  // Hebrew title lays out right to left inside an English UI and the reverse. Empty, though, it
  // has nothing to read and falls back to left-to-right — so a Hebrew placeholder sat on the
  // wrong edge of an otherwise right-to-left form. Empty fields therefore inherit the UI's own
  // direction and only switch to auto once somebody has typed.
  const watchedTitle = form.watch('title')
  const titleDir = watchedTitle === '' ? undefined : 'auto'
  const descriptionDir = form.watch('description') === '' ? undefined : 'auto'
  // The provenance line's dates: the day alone, in the reader's language. A task's history is
  // read at a glance, and a minute-precise timestamp is precision nobody asked for.
  const formatStamp = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(
      new Date(iso),
    )
  const targetLocationId =
    mode === 'edit'
      ? (task?.locationId ?? '')
      : isAdmin
        ? watchedLocationId
        : (principal.locationId ?? '')

  // Whether the form is still waiting to be told which branch this task belongs to. Only an
  // admin creating a task is ever in this state — a manager's branch is their own, and a task
  // under edit already has one.
  const branchUnchosen = targetLocationId === ''

  // The people who may be assigned: active users at the task's location.
  //
  // With no branch chosen yet, the whole chain's staff is offered instead of an empty list
  // (owner ask 2026-08-21). Picking a person is often how somebody DECIDES which branch a task
  // is for, and making them name the branch first inverts the order they were thinking in.
  // Their branch is then filled in from them, below.
  //
  // Chain-wide accounts are left out of that wider pool on purpose. They belong to no branch,
  // so they can name none, and the moment a branch was chosen they would drop out of the list
  // again — a choice that can only ever be taken back is not a choice worth offering.
  //
  // On edit, keep any current assignee in the list even if they are no longer an active
  // location user, so a plain edit does not silently drop them (they were already validated
  // onto the task).
  // A manager tasks their own level and down (owner call 2026-08-25) — the same ladder the API
  // enforces, mirrored here so the picker never offers a name the save would refuse.
  const assignableRoles: Role[] = hasAdminAuthority(principal.role)
    ? ['super_admin', 'admin', 'manager', 'employee']
    : ['manager', 'employee']
  const assigneeCandidates = useMemo(() => {
    const active = users.filter(
      (user) => user.status === 'active' && assignableRoles.includes(user.role),
    )
    const pool = (
      branchUnchosen
        ? active.filter((user) => user.locationId !== null)
        : active.filter((user) => user.locationId === targetLocationId)
    ).map((user) => ({
      id: user.id,
      displayName: user.displayName,
      locationId: user.locationId,
      locationName: user.locationName,
    }))
    if (mode === 'edit' && task) {
      const known = new Set(pool.map((candidate) => candidate.id))
      const stillAssigned = task.assignees
        .filter((assignee) => !known.has(assignee.id))
        .map((assignee) => ({ ...assignee, locationId: null, locationName: null }))
      return [...pool, ...stillAssigned]
    }
    return pool
  }, [users, targetLocationId, branchUnchosen, mode, task, assignableRoles])

  // Toggling one person on or off. Picking somebody while no branch is set NAMES the branch: it
  // is theirs. Only on the way in, and never over a branch already chosen — this fills a blank,
  // it does not overrule a decision. Anyone already picked from a different branch is released
  // at the same moment, the same assignee-location invariant the manual branch picker enforces,
  // so the form can never hold a pair the API would reject.
  const toggleAssignee = (candidate: { id: string; locationId: string | null }) => {
    const current = form.getValues('assigneeIds')
    const wasOn = current.includes(candidate.id)
    const next = wasOn ? current.filter((id) => id !== candidate.id) : [...current, candidate.id]
    const adoptBranch =
      !wasOn && mode === 'create' && branchUnchosen && candidate.locationId !== null
    if (!adoptBranch) {
      form.setValue('assigneeIds', next, { shouldDirty: true })
      return
    }
    const branch = candidate.locationId as string
    form.setValue('locationId', branch, { shouldDirty: true })
    form.setValue(
      'assigneeIds',
      next.filter((id) => users.some((user) => user.id === id && user.locationId === branch)),
      { shouldDirty: true },
    )
  }

  // The boards an admin may create on, read from the authoritative Location list (GET /locations,
  // #164) rather than the distinct locations in the people list — so an admin can create the first
  // task on a brand-new, unstaffed branch. Admin-only server-side; on an admin's create form it
  // feeds the board picker, and on their edit dialog it resolves the task's own board to a name for
  // the provenance line (a task never changes location in v1, so edit shows it, never picks it).
  const locationsQuery = useLocations({ enabled: isAdmin })
  const locationOptions: SelectOption[] = (locationsQuery.data ?? []).map((location) => ({
    value: location.id,
    label: location.name,
  }))
  // The edited task's branch name for the admin provenance line; null while loading or for the
  // non-admin viewers whose location is implicit, so the line simply doesn't render.
  const editedLocationName =
    isAdmin && mode === 'edit' && task
      ? (locationsQuery.data?.find((location) => location.id === task.locationId)?.name ?? null)
      : null

  const onSuccess = async (): Promise<void> => {
    // Refetch the acting user's board so their own view reflects the write at once; other viewers
    // get it over the live channel. The board query has refetchOnWindowFocus off, so this explicit
    // invalidation is what refreshes it.
    await queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY })
    onClose()
  }
  const onError = (error: unknown): void => {
    if (error instanceof ApiError && error.status === 403) {
      form.setError('root', { message: t('tasks.writeForbidden') })
      return
    }
    form.setError('root', { message: t('tasks.writeFailed') })
  }

  const createMutation = useMutation({
    mutationFn: (body: CreateTaskRequest) => tasksApi.createTask(body),
    onSuccess,
    onError,
  })
  const updateMutation = useMutation({
    mutationFn: (body: UpdateTaskRequest) => tasksApi.updateTask(task?.id ?? '', body),
    onSuccess,
    onError,
  })
  const deleteMutation = useMutation({
    mutationFn: () => tasksApi.deleteTask(task?.id ?? ''),
    onSuccess,
    onError: () => {
      setConfirmingDelete(false)
      form.setError('root', { message: t('tasks.deleteFailed') })
    },
  })
  const pending = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending

  const onSubmit = form.handleSubmit(
    (values) => {
      form.clearErrors('root')
      // An empty note is stored as null, never a blank string; the due date rides the wire as an ISO
      // timestamp at the start of the chosen day.
      const description = values.description.trim() === '' ? null : values.description.trim()
      const dueDate = values.dueDate === '' ? null : new Date(values.dueDate).toISOString()

      if (mode === 'create') {
        createMutation.mutate({
          title: values.title,
          description,
          priority: values.priority,
          dueDate,
          assigneeIds: values.assigneeIds,
          // A manager sends no location — the API uses their own; an admin sends the chosen board.
          locationId: isAdmin ? values.locationId : null,
          // This sheet writes the shared board; the private one has its own small dialog.
          personal: false,
          // A line half-typed in the add field is work somebody meant to include, so it goes in
          // rather than being dropped for want of one more keystroke — the same call the project
          // sheet makes with its own checklist.
          checklist: [
            ...checklist,
            ...(draftItem.trim()
              ? [{ id: null, title: draftItem.trim(), done: false, assigneeIds: [] }]
              : []),
          ],
        })
        return
      }
      updateMutation.mutate({
        title: values.title,
        description,
        priority: values.priority,
        dueDate,
        assigneeIds: values.assigneeIds,
        // A manager/admin may move status through this full edit (#134); the employee's status path
        // is separate. Create never sends it — a new task always starts not_started.
        status: values.status,
        // Sent wholesale, ids and all, so the server reconciles instead of rewriting. The
        // half-typed line rides along here too.
        checklist: [
          ...checklist,
          ...(draftItem.trim()
            ? [{ id: null, title: draftItem.trim(), done: false, assigneeIds: [] }]
            : []),
        ],
      })
    },
    // react-hook-form focuses the first invalid field, which is why a missing title lands you in
    // the title box. The Location Select has nothing to focus: it is a Controller around a custom
    // control, not a native input. So an admin who never picked a branch got no focus, no message
    // and no request, and the Create button read as dead (owner report 2026-08-24). Name the
    // blocker in the sheet's own error slot, which sits directly under the title.
    (errors) => {
      if (errors.locationId) form.setError('root', { message: t('tasks.locationRequired') })
    },
  )

  const rootError = form.formState.errors.root?.message
  const heading = t(mode === 'create' ? 'tasks.createHeading' : 'tasks.editHeading')

  return (
    <Dialog open onClose={onClose} title={heading} hideTitle className="max-w-[40rem]">
      <form className="flex flex-col gap-3.5" onSubmit={onSubmit}>
        {/* The eyebrow names the surface without spending a heading line on it. Status used to
            stand here as a pill; it is a property of the task like the three under it, so it
            reads as the first ROW of the sheet instead (owner call 2026-08-23) — first, because
            "is this done?" is the question most people open a task to answer. */}
        <div className="flex flex-col items-start gap-2 pe-9">
          <span className="text-caption font-bold uppercase tracking-[0.06em] text-muted-foreground">
            {heading}
          </span>
        </div>

        {/* The task IS its title, so the title leads and wears the dialog's own heading size.
            dir="auto" so an authored title lays out by its own script — Hebrew RTL, English
            LTR. The visible heading is hidden above, so this input carries the aria-label.
            Focus tints the ground rather than drawing the standard blue ring: on a borderless
            input that spans the card, the ring read as a stray empty field somebody had
            outlined, which is exactly what the owner saw first (2026-08-21). The tint is a
            visible focus state, so the keyboard is no worse off. */}
        <div className="flex items-center gap-2">
          <Input
            dir={titleDir}
            aria-label={t('tasks.fieldTitle')}
            placeholder={t('tasks.titlePlaceholder')}
            // The md: size is repeated deliberately. Input carries `text-base md:text-body`, and a
            // bare `text-heading-lg` only replaces the unprefixed half — from md the input's own
            // md: rule won and the title had been rendering at body size all along, which is what
            // the owner was seeing when he asked for a bigger title (2026-08-23).
            className="h-auto min-w-0 flex-1 rounded-md border-0 bg-transparent px-2.5 py-2.5 text-heading-lg font-extrabold shadow-none focus-visible:bg-muted focus-visible:ring-0 focus-visible:ring-offset-0 md:text-heading-lg"
            {...form.register('title', { required: true })}
          />
          {/* The knowledge scan sits ON the title, because the title is what it reads. Chain
              owner only. `title` carries the hover line as well as the label: this is one icon
              with no word beside it, and "what will this do" is a question a plain glyph cannot
              answer on its own. Disabled until something is typed — there is nothing to search
              for otherwise, and a button that fires and finds nothing reads as broken. */}
          {isAdmin ? (
            // The hover line rides the WRAPPER, not the button. A disabled button carries
            // `pointer-events: none`, so it is never hit-tested and its own line never fires —
            // which withheld the explanation at the one moment it was needed, in front of a dimmed
            // glyph nobody had a name for. The wrapper is always hit-testable, so the line shows
            // in both states.
            <Tooltip label={t('tasks.scanChecklist')} className="flex-none">
              <button
                type="button"
                onClick={runScan}
                disabled={!watchedTitle.trim() || scanning}
                aria-label={t('tasks.scanChecklist')}
                className={cn(
                  'block rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none',
                  // Dimmed when there is nothing to search for, but NOT while a scan is running.
                  // The button is disabled in both states, and one blanket fade would take the
                  // arc below — the thing saying anything is happening — down with it.
                  !scanning && 'disabled:opacity-40',
                )}
              >
                <Icon name="checklist-scan" size="md" />
              </button>
              {/* The scan is the assistant's own retrieval, so it waits in the assistant's own
                  way: the thin gold arc that orbits the mark while an answer is on its way (owner
                  call 2026-08-16, kept after two rejected alternatives). The glyph inside holds
                  still and the halo turns.
                  The arc is DRAWN in every case and only SPINS under motion-safe. Hiding it
                  outright under reduced motion left the button pixel-identical to its idle state
                  for the whole wait — and paired with a keyboard press, which used to leave the
                  hover line sitting over the status text, a running scan was indistinguishable
                  from a dead one. Still is a fine thing for it to be; absent is not. */}
              {scanning ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0.5 rounded-full border-2 border-transparent border-t-nav-gold motion-safe:animate-[spin_1.4s_linear_infinite]"
                />
              ) : null}
            </Tooltip>
          ) : null}
        </div>

        {/* The scan takes ten to twenty-five seconds, which is a long time to watch one arc turn,
            and the whole result arrives silently for anybody not watching it at all. One
            polite live region carries the wait and then what came back, and it sits directly under
            the button that started it — the panel it produces lands further down, beside the
            checklist it will join, but the person is still looking up here when they press it. */}
        {scanning || scanEmpty || scanned ? (
          <p
            aria-live="polite"
            // Justified to the row's END, under the button that started it, rather than running
            // full width from the opposite edge — with a Hebrew title the two sat diagonally
            // apart, a spinner at one corner and its own caption at the other. And no glyph of
            // its own: the scan icon is already on screen forty pixels above, turning.
            className="-mt-1 flex items-center justify-end gap-1.5 px-2.5 text-caption text-muted-foreground"
          >
            {scanning
              ? t('tasks.scanRunning')
              : scanEmpty
                ? t('tasks.scanEmpty')
                : t('tasks.scanFound', { count: scanned?.length ?? 0 })}
            {/* The assistant's dot wave, 140ms apart, so a scan waits the way the assistant
                waits. The wave says "working through it" where three dots blinking in place say
                nothing; reduced motion holds them still at rest. */}
            {scanning
              ? [0, 1, 2].map((i) => (
                  <span
                    key={i}
                    aria-hidden="true"
                    className="size-1 rounded-full bg-muted-foreground motion-safe:animate-[bb-dot-bounce_1.1s_ease-in-out_infinite] motion-reduce:opacity-60"
                    style={{ animationDelay: `${i * 140}ms` }}
                  />
                ))
              : null}
          </p>
        ) : null}

        {scanFailed ? <Alert tone="error">{t('tasks.scanFailed')}</Alert> : null}

        {rootError ? <Alert tone="error">{rootError}</Alert> : null}

        {/* The property grid: ONE column at every width (owner call 2026-08-21). Two columns
            put Priority and Due date side by side and their values landed at two different
            distances from the card's edge, so the four things you set never lined up as a
            list. Stacked, every label starts on the same line and every value starts on the
            same line under it, which is what makes a property sheet scannable. */}
        <div className="grid grid-cols-1 gap-y-0.5">
          {/* Status leads the sheet on edit. It wears the bare control, like every other value
              here: in a column of properties the outlined pill was the one boxed thing, and the
              box said nothing the label had not already said. */}
          {mode === 'edit' ? (
            <Controller
              control={form.control}
              name="status"
              render={({ field }) => (
                <PropertyRow icon={STATUS_ICON[field.value]} label={t('tasks.fieldStatus')}>
                  <StatusControl
                    status={field.value}
                    onSelect={field.onChange}
                    label={t('tasks.fieldStatus')}
                    disabled={pending}
                    variant="bare"
                    size="body"
                  />
                </PropertyRow>
              )}
            />
          ) : null}

          <Controller
            control={form.control}
            name="priority"
            render={({ field }) => (
              <PropertyRow icon="priority" label={t('tasks.fieldPriority')}>
                {/* Here the priority is a VALUE in a sheet, not a tag on a board: the soft
                    ground comes off and the flag alone carries the colour (owner call
                    2026-08-23), so the four rows of the sheet read as one column of plain
                    values. The pill stays where a task is scanned among others — the card and
                    the list — which is where a colour block earns its keep. */}
                <Select
                  label={t('tasks.fieldPriority')}
                  value={field.value}
                  onValueChange={field.onChange}
                  options={priorityOptions}
                  hideChevron
                  triggerClassName={cn(BARE_CONTROL, 'gap-1.5')}
                />
              </PropertyRow>
            )}
          />

          {/* Assignees is a property like the rest of them, so it sits in the same column with
              the same label beside it, and it is a dropdown for the same reason the other three
              are: one row, one line, one shape. */}
          <PropertyRow icon="account" label={t('tasks.fieldAssignees')}>
            {assigneeCandidates.length === 0 ? (
              <p className="flex min-h-8 items-center text-body text-muted-foreground">
                {t(branchUnchosen ? 'tasks.assigneesNoStaff' : 'tasks.assigneesEmpty')}
              </p>
            ) : (
              <AssigneePicker
                candidates={assigneeCandidates}
                picked={watchedAssigneeIds}
                onToggle={toggleAssignee}
                showBranch={branchUnchosen}
                label={t('tasks.fieldAssignees')}
                emptyLabel={t('tasks.filterBacklog')}
                disabled={pending}
              />
            )}
          </PropertyRow>

          <Controller
            control={form.control}
            name="dueDate"
            render={({ field }) => (
              <PropertyRow icon="due-date" label={t('tasks.fieldDueDate')}>
                <DateField
                  label={t('tasks.fieldDueDate')}
                  value={field.value}
                  onChange={field.onChange}
                  disabled={pending}
                />
              </PropertyRow>
            )}
          />

          {/* The board an admin creates on, from the authoritative Location list. Loading and a
              load failure are surfaced plainly rather than collapsing to a bare placeholder the
              required rule would then silently block. */}
          {mode === 'create' && isAdmin ? (
            <PropertyRow icon="location" label={t('tasks.fieldLocation')}>
              {locationsQuery.isPending ? (
                <p className="text-label text-muted-foreground">{t('common.working')}</p>
              ) : locationsQuery.isError ? (
                <p className="text-label text-destructive">{t('tasks.locationsLoadFailed')}</p>
              ) : (
                <Controller
                  control={form.control}
                  name="locationId"
                  rules={{ required: true }}
                  render={({ field }) => (
                    <Select
                      label={t('tasks.fieldLocation')}
                      placeholder={t('tasks.locationPlaceholder')}
                      value={field.value}
                      // Switching boards invalidates people picked at the previous one, so clear
                      // the checked assignees; a stale cross-location id is rejected by the
                      // invariant.
                      onValueChange={(value) => {
                        field.onChange(value)
                        form.setValue('assigneeIds', [])
                        // The complaint clears the moment it is answered, rather than sitting
                        // over a branch the reader has already picked.
                        form.clearErrors('root')
                      }}
                      options={locationOptions}
                      hideChevron
                      // The message names this row; the ring points at it. On a property sheet
                      // of six near-identical rows, a sentence alone still costs a hunt.
                      triggerClassName={cn(
                        BARE_CONTROL,
                        form.formState.errors.locationId &&
                          'bg-destructive-muted/40 ring-2 ring-destructive-muted',
                      )}
                    />
                  )}
                />
              )}
            </PropertyRow>
          ) : null}
        </div>

        <div aria-hidden="true" className="h-px bg-border" />

        {/* The description gets a ground of its own. It is the only place in this dialog where
            somebody writes prose rather than picks a value, and floating it borderless on the
            card left it reading as a caption under the properties — with the browser's resize
            grip hanging off its corner, the one handle in the app you could drag. */}
        <div className="flex flex-col gap-1.5">
          {/* Set like the eyebrow above it: in a sheet whose values carry no boxes of their own,
              the small uppercase label is what marks a section off from the column of properties
              (the reference the owner sent, 2026-08-23). */}
          <span className="text-caption font-bold uppercase tracking-[0.06em] text-muted-foreground">
            {t('tasks.fieldDescription')}
          </span>
          <Textarea
            dir={descriptionDir}
            rows={5}
            aria-label={t('tasks.fieldDescription')}
            placeholder={t('tasks.descriptionPlaceholder')}
            className="max-h-56 resize-none border-0 bg-surface-sunken px-3 py-2.5 shadow-none"
            {...form.register('description')}
          />
        </div>

        {/* What the scan came back with (owner ask 2026-08-27). A panel above the checklist rather
            than inside it, because none of this is on the task yet: it is a proposal with its own
            frame, its own provenance line, and its own way to be turned down. It sits directly
            above the list it will join, so pressing Add is visibly a move downward. */}
        {scanned ? (
          <div className="flex flex-col gap-2 rounded-md border border-border-strong bg-muted/40 p-3">
            {/* Where these came from. The server refuses a document the retrieval never read, so
                when it names nothing the line says only that the knowledge base is the source
                rather than inventing a file. */}
            <p className="truncate text-caption font-semibold text-foreground">
              {scanSource
                ? t('tasks.scanSource', { title: scanSource })
                : t('tasks.scanSourceUnknown')}
            </p>

            {/* The list scrolls inside the panel rather than pushing the sheet open. The
                branch-opening checklist is forty lines, and unbounded that put Add and Not these
                thirteen hundred pixels below the title — a proposal you have to go looking for to
                accept. Bounded, the decision stays next to the thing it is about. */}
            <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {scanned.map((step, index) => (
                <li
                  // The scan drops duplicate steps before it answers, so within one proposal the
                  // text is unique and is the only stable identity these lines have — they carry
                  // no id, because none of them is on the task yet.
                  key={step.title}
                  className="flex items-center gap-2 rounded-md bg-card px-2.5 py-1.5"
                >
                  <input
                    type="checkbox"
                    checked={step.picked}
                    aria-label={step.title}
                    onChange={(event) =>
                      setScanned(
                        scanned.map((one, i) =>
                          i === index ? { ...one, picked: event.target.checked } : one,
                        ),
                      )
                    }
                    className="size-4 flex-none accent-primary"
                  />
                  {/* The <bdi> goes INSIDE the stretched box, never on it. A step that spans the
                      row must align to the row's own direction, and both dir="auto" and a bare
                      <bdi> (which carries an implicit dir="auto") turn the box itself
                      right-to-left for Hebrew text — measured at 478px of white between a step
                      and its own checkbox, reading as two unrelated columns. The box therefore
                      inherits the sheet's direction and starts where the sheet starts, while the
                      bdi isolates the Hebrew run inside it so the words still read correctly. */}
                  <span
                    className={cn(
                      'min-w-0 flex-1 text-body',
                      !step.picked && 'text-muted-foreground line-through',
                    )}
                  >
                    <bdi>{step.title}</bdi>
                  </span>
                </li>
              ))}
            </ul>

            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={dismissScan}>
                {t('tasks.scanDismiss')}
              </Button>
              <Button
                type="button"
                onClick={addScannedSteps}
                disabled={scanned.every((step) => !step.picked)}
              >
                {t('tasks.scanAdd', { count: scanned.filter((step) => step.picked).length })}
              </Button>
            </div>
          </div>
        ) : null}

        {/* The checklist (owner call 2026-08-26). Same grammar as the project sheet's: a tick, a
            line, a way to take it back off. Closed until asked for, because most tasks are one
            thing and a permanently open list-builder would make every task look unfinished. */}
        {checklistOpen ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2.5">
              <span className="text-caption font-bold uppercase tracking-[0.06em] text-muted-foreground">
                {t('tasks.checklist')}
              </span>
              {checklist.length > 0 && (
                <span className="text-caption tabular-nums text-muted-foreground">
                  {t('tasks.checklistCount', {
                    done: checklist.filter((item) => item.done).length,
                    total: checklist.length,
                  })}
                </span>
              )}
            </div>

            {checklist.length > 0 && (
              <ul className="flex flex-col gap-1">
                {checklist.map((item, index) => (
                  <li
                    // A saved line has an id; a line typed a moment ago has only its slot, and the
                    // same text can legitimately appear twice in a list somebody is still writing.
                    key={item.id ?? `draft-${index}`}
                    className="flex items-center gap-2 rounded-md bg-muted/60 px-2.5 py-1.5"
                  >
                    {/* Ticking writes through on the tap (owner call 2026-08-26) — on an edit,
                        through the item's own path, which an assignee may reach even though the
                        rest of this sheet is closed to them. */}
                    <input
                      type="checkbox"
                      checked={item.done}
                      aria-label={item.title}
                      onChange={(event) => tickItem(index, event.target.checked)}
                      className="size-4 flex-none accent-primary"
                    />
                    {/* Isolated inside the box, not on it — see the scan panel above for why.
                        The line wraps rather than truncating. `truncate` clips at the box's END,
                        and the box now runs left-to-right, so a Hebrew step longer than the row
                        lost its FIRST word and painted an ellipsis on the left where nothing was
                        missing. Two lines of a step you can read beats one line of a step that
                        starts mid-word. */}
                    <span
                      className={cn(
                        'min-w-0 flex-1 break-words text-body',
                        item.done && 'text-muted-foreground line-through',
                      )}
                    >
                      <bdi>{item.title}</bdi>
                    </span>
                    {/* A private task has no branch and no other reader, so there is nobody to
                        hand a step to; the control is left out rather than shown empty and inert. */}
                    {task?.personal ? null : (
                      <StepOwners
                        candidates={assigneeCandidates}
                        picked={item.assigneeIds}
                        label={t('tasks.stepOwners')}
                        // Until a branch is named there is no pool to pick from — the same rule
                        // the task's own assignee row follows.
                        disabled={branchUnchosen}
                        onToggle={(id) =>
                          commitChecklist(
                            checklist.map((line, i) =>
                              i === index
                                ? {
                                    ...line,
                                    assigneeIds: line.assigneeIds.includes(id)
                                      ? line.assigneeIds.filter((one) => one !== id)
                                      : [...line.assigneeIds, id],
                                  }
                                : line,
                            ),
                          )
                        }
                      />
                    )}
                    <button
                      type="button"
                      aria-label={t('tasks.removeItem', { title: item.title })}
                      onClick={() => commitChecklist(checklist.filter((_, i) => i !== index))}
                      className="flex-none rounded-md p-0.5 text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Icon name="close" size="sm" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* The checklist writes on its own, so a failure has to speak for itself here rather
                than wait for the sheet's error slot — the person who ticked a box is not on their
                way to a Save button that could report it. */}
            {checklistFailed ? <Alert tone="error">{t('tasks.checklistFailed')}</Alert> : null}

            <div className="flex items-center gap-2">
              <Input
                value={draftItem}
                onChange={(event) => setDraftItem(event.target.value)}
                // Enter adds a line instead of submitting the sheet: this field is a list builder,
                // and somebody typing five steps should not have to reach for the mouse between
                // each one.
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addDraftItem()
                  }
                }}
                placeholder={t('tasks.addItemPlaceholder')}
                aria-label={t('tasks.addItem')}
                // A ground rather than a box, like the description above it, and the same quiet
                // inset focus outline the project sheet's add field uses — the accent ring on a
                // filled field read as a stray empty input somebody had outlined.
                className="h-9 border-0 bg-muted shadow-none focus-visible:ring-1 focus-visible:ring-border-strong focus-visible:ring-offset-0"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={addDraftItem}
                disabled={!draftItem.trim()}
                className="flex-none"
              >
                {t('tasks.addItem')}
              </Button>
            </div>
          </div>
        ) : (
          // The closed state. A quiet full-width affordance rather than a primary button: adding a
          // checklist is an option on this sheet, not the thing the sheet is for.
          <button
            type="button"
            onClick={() => setChecklistOpen(true)}
            className="flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border-strong py-2 text-label font-semibold text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon name="create" size="sm" />
            {t('tasks.addChecklist')}
          </button>
        )}

        {/* Provenance (#258, moved out of the property grid 2026-08-21). Everything on this
            line is a FACT — who made the task, at which branch, when it was last edited, when
            it was finished — and none of it is settable. In the grid it wore the same shape as
            the controls above it and read as a field somebody had disabled. Here it reads as
            what it is: the task's history, in the order it happened, under the form that
            changes its future. */}
        {mode === 'edit' && task ? (
          <p className="text-caption text-muted-foreground">
            {[
              // Place first, then person, then the dates in the order they happened.
              editedLocationName,
              t('tasks.metaCreated', {
                name: task.createdBy.displayName,
                date: formatStamp(task.createdAt),
              }),
              // Only when it was actually edited: every task's updatedAt is set at create
              // time, so an unedited task would otherwise claim an edit it never had.
              new Date(task.updatedAt).getTime() - new Date(task.createdAt).getTime() > 60_000
                ? t('tasks.metaUpdated', { date: formatStamp(task.updatedAt) })
                : null,
              task.completedAt
                ? t('tasks.metaCompleted', { date: formatStamp(task.completedAt) })
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        ) : null}

        <div aria-hidden="true" className="h-px bg-border" />

        <div className="flex flex-wrap items-center justify-end gap-2 pt-0.5">
          {/* Edit adds a quiet destructive Delete pushed to the inline-start, routing its
              confirmation through the AlertDialog rather than deleting on the tap. */}
          {mode === 'edit' ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              // Quiet until you reach for it. A delete drawn in full destructive ink was the
              // second most coloured thing in this dialog, competing with Save for the eye
              // (2026-08-21); the red belongs on the confirm, which is where the decision is.
              className="me-auto text-muted-foreground hover:text-destructive focus-visible:text-destructive"
              disabled={pending}
              onClick={() => setConfirmingDelete(true)}
            >
              <Icon name="delete" size="sm" />
              {t('tasks.delete')}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? t('common.working') : t(mode === 'create' ? 'tasks.create' : 'tasks.save')}
          </Button>
        </div>
      </form>

      <AlertDialog
        open={confirmingDelete}
        title={t('tasks.confirmDelete')}
        confirmLabel={t('tasks.delete')}
        cancelLabel={t('common.cancel')}
        confirmDisabled={deleteMutation.isPending}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => deleteMutation.mutate()}
      />
    </Dialog>
  )
}
