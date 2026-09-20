import { type Department, type UserSummary, departmentLabel } from '@burgers/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslations } from 'use-intl'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { Dialog } from '../../components/ui/dialog.js'
import { Icon } from '../../components/ui/icon.js'
import { useLocale } from '../../i18n/locale.js'
import { authApi } from '../../lib/api.js'
import { cn } from '../../lib/cn.js'
import { useDeferredClose } from '../../lib/use-exit-transition.js'
import { departmentIconName } from '../departments/department-icon.js'
import { useDepartments } from '../departments/use-departments.js'
import { USERS_QUERY_KEY } from './users-query.js'

// Place a person in a department, or unplace them (2026-09-20). Reached from the person's
// actions menu, beside deactivate, because changing where someone sits is rare and deliberate,
// and the app already keeps its rare per-person acts behind that one menu rather than as
// controls that sit in every row.
//
// It opened as a native select and the owner sent it back ("a simple dropdown"). The chain has
// seven desks and this is a choice between them, so the seven are simply on screen, in the
// client's own order and each under its own mark, with the person's current desk tagged: what is
// hidden behind a dropdown here is the whole org chart, and it is small enough to show. The same
// argument the Access page made for its horizon pills, at a size that fits eight rows on a phone.
//
// Real radios under the rows, so arrow keys move the choice, the group is announced as one
// question, and the browser does the state work; the chosen row is carried by ground, border
// AND a check mark rather than colour alone. Save stays explicit, and it names the move it is
// about to make ("Move to Finance") once one is chosen, so the outcome is read before it is
// pressed; while nothing has changed it says Save and waits. A failure is said inside, under
// the title, with the choice still standing.
//
// Mounted only while open, like the task dialogs, so the list opens on the person's CURRENT
// department every time; it closes itself first (useDeferredClose) so the exit can play.
export function ChangeDepartmentDialog({
  user,
  onClose,
}: {
  user: UserSummary
  onClose: () => void
}) {
  const t = useTranslations()
  const { locale } = useLocale()
  const queryClient = useQueryClient()
  const { open, close } = useDeferredClose(onClose)
  const departments = useDepartments().data ?? []
  const current = user.departmentId
  const [chosen, setChosen] = useState<string | null>(current)
  const [failed, setFailed] = useState(false)
  const groupName = useId()
  const changed = chosen !== current
  const chosenDepartment = departments.find((department) => department.id === chosen)

  const save = useMutation({
    mutationFn: () => authApi.updateUser(user.id, { departmentId: chosen }),
    onSuccess: async () => {
      // The roster re-reads the row rather than trusting the response, the way every other
      // person action does, so the header and the row change together.
      await queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY })
      close()
    },
    onError: () => setFailed(true),
  })

  const submitLabel = !changed
    ? t('users.saveDepartment')
    : chosenDepartment
      ? t('users.moveToDepartment', { department: departmentLabel(chosenDepartment, locale) })
      : t('users.removeFromDepartment')

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('users.changeDepartment')}
      description={t('users.changeDepartmentBody', { name: user.displayName })}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          setFailed(false)
          save.mutate()
        }}
      >
        {failed ? <Alert tone="error">{t('users.actionFailed')}</Alert> : null}

        <fieldset className="min-w-0">
          <legend className="sr-only">{t('users.department')}</legend>
          <div className="flex flex-col gap-1.5">
            {departments.map((department) => (
              <DepartmentRow
                key={department.id}
                groupName={groupName}
                value={department.id}
                label={departmentLabel(department, locale)}
                icon={department}
                checked={chosen === department.id}
                isCurrent={current === department.id}
                onChoose={() => setChosen(department.id)}
              />
            ))}
            {/* Unplaced is a real answer, so it is a row like the others; last, because it is
                the one the list is usually moving someone OUT of. Its mark is dashed, the same
                "not fixed" the automatic avatar tone wears. */}
            <DepartmentRow
              groupName={groupName}
              value=""
              label={t('invites.departmentNone')}
              icon={null}
              checked={chosen === null}
              isCurrent={current === null}
              onChoose={() => setChosen(null)}
            />
          </div>
        </fieldset>

        <div className="mt-1 flex justify-end gap-2.5">
          <Button variant="outline" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={!changed || save.isPending}>
            {save.isPending ? t('common.working') : submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

// One desk in the list: its mark, its name, "Current" when the person sits there today, and a
// check when it is the chosen answer. The whole row is the label, so the whole row is the target
// (48px on a phone, 44px on a desktop), and the focus ring rides it since the input is off-screen.
function DepartmentRow({
  groupName,
  value,
  label,
  icon,
  checked,
  isCurrent,
  onChoose,
}: {
  groupName: string
  value: string
  label: string
  icon: Department | null
  checked: boolean
  isCurrent: boolean
  onChoose: () => void
}) {
  const t = useTranslations()

  return (
    <label
      className={cn(
        'group relative flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border ps-2.5 pe-3 transition-colors motion-reduce:transition-none md:min-h-11',
        // Chosen wears the same quiet wash the Access page's chosen pill wears: this is a
        // "which one of these", not an action, so it does not take the action blue. Weight
        // never moves between the two states, so the list does not jitter as the choice does.
        checked
          ? 'border-transparent bg-selected-soft text-foreground'
          : 'border-border-strong bg-card text-muted-foreground hover:border-muted-foreground hover:text-foreground',
      )}
    >
      <input
        type="radio"
        name={groupName}
        value={value}
        checked={checked}
        onChange={onChoose}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-px rounded-lg peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background"
      />
      <span
        aria-hidden
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-md',
          icon
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground outline-dashed outline-1 -outline-offset-1 outline-current/50',
        )}
      >
        {icon ? <Icon name={departmentIconName(icon.slug)} size="sm" /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate text-body font-semibold">
        <bdi>{label}</bdi>
      </span>
      {isCurrent ? (
        <span
          className={cn(
            'shrink-0 text-caption font-medium',
            // On the chosen row's wash the muted ink falls under 4.5:1 at caption size, so the
            // tag borrows the row's own ink there and steps back only where the ground is plain.
            checked ? 'text-foreground/80' : 'text-muted-foreground',
          )}
        >
          {t('users.departmentCurrent')}
        </span>
      ) : null}
      {/* The check is the second carrier of "chosen" beside the wash, and it is drawn for the
          eye only: the radio already announces the state. Its box is reserved on every row so
          the names do not shift when the check moves. */}
      <span aria-hidden className="grid size-5 shrink-0 place-items-center text-foreground">
        {checked ? <Icon name="choice-checked" size="sm" /> : null}
      </span>
    </label>
  )
}
