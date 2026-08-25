import type { Location, UpdateLocationRequest } from '@burgers/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslations } from 'use-intl'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { Icon } from '../../components/ui/icon.js'
import { Input } from '../../components/ui/input.js'
import { ApiError, locationsApi } from '../../lib/api.js'
import { BranchDisc } from './branch-disc.js'
import { LOCATIONS_QUERY_KEY } from './use-locations.js'

// The storefront plate at the top of the branch page — and the page's one deliberate risk
// (spec 2.3). "Edit branch" does not open anything: the very same block turns into fields,
// each one starting exactly where its own line started and filling the column that line sat
// in, and the plate keeps its place on the page — same top-left, same width, no dialog. It
// grows downward, because a field is taller than a line of text, and that is the only motion
// there is. That is the literal answer to "you can edit everything", and it is the only bold
// thing on a screen that is otherwise deliberately quiet.
//
// Because the fields stand exactly where the text stood, there is no room for a label line
// above any of them — a label would push every field down and break the promise. The field
// names ride as `aria-label` and as the placeholder instead, so the name is announced to
// assistive tech and shown to the eye the moment a field is empty.
//
// Save sends ONE patch and carries only what actually moved (PATCH is a real partial patch
// since 2026-08-23: an absent key means "leave it", an explicit null means "clear it"), so
// re-saving an untouched plate is not a write, and emptying the address is a clear rather
// than an empty string.

interface PlateFields {
  name: string
  address: string
  city: string
  phone: string
}

function draftOf(branch: Location): PlateFields {
  return {
    name: branch.name,
    address: branch.address ?? '',
    city: branch.city ?? '',
    phone: branch.phone ?? '',
  }
}

// One nullable field's contribution to the patch: `undefined` when the reader left it alone,
// `null` when they emptied a value that was there, the trimmed text otherwise. Whitespace is
// not a value — typing spaces into a field that was already empty is still no change.
function patched(next: string, current: string | null): string | null | undefined {
  const value = next.trim()
  if (value === (current ?? '')) return undefined
  return value === '' ? null : value
}

export function BranchPlate({
  branch,
  // Whether this viewer may change the branch record at all (2026-08-25). False for a manager,
  // who reads their branch page without the means to rewrite it; the plate then has no edit
  // affordance rather than one that opens onto a save the API would refuse.
  editable = true,
  // Rendered into the editor's footer when the viewer may destroy this branch. Passed in
  // rather than decided here: who holds that authority is the screen's question, and the
  // plate's job is only to say where the control lives.
  deleteAction,
}: { branch: Location; editable?: boolean; deleteAction?: ReactNode }) {
  const t = useTranslations()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const form = useForm<PlateFields>({ defaultValues: draftOf(branch) })

  const mutation = useMutation({
    mutationFn: (patch: UpdateLocationRequest) => locationsApi.update(branch.id, patch),
    onSuccess: async () => {
      setEditing(false)
      // The list, the invite picker and the task form's branch choice all read this one key,
      // so a rename here reaches every one of them off a single invalidation.
      await queryClient.invalidateQueries({ queryKey: LOCATIONS_QUERY_KEY })
    },
    onError: (error) => {
      // The editor stays open and keeps what was typed: the fix is in the field the reader
      // is already looking at, so throwing their input away would be the second failure.
      if (error instanceof ApiError) {
        if (error.status === 403) return setFailure(t('locations.forbidden'))
        if (error.status === 0) return setFailure(t('common.networkError'))
      }
      setFailure(t('locations.saveFailed'))
    },
  })

  const startEditing = () => {
    setFailure(null)
    form.reset(draftOf(branch))
    setEditing(true)
  }

  const cancelEditing = () => {
    setFailure(null)
    setEditing(false)
  }

  const onSubmit = form.handleSubmit((values) => {
    setFailure(null)
    const patch: UpdateLocationRequest = {}
    // The name is the one field with no null: the contract refuses a blank one, and a branch
    // with no name is not a branch. A cleared field therefore means "unchanged", not "clear".
    const name = values.name.trim()
    if (name && name !== branch.name) patch.name = name
    const address = patched(values.address, branch.address)
    if (address !== undefined) patch.address = address
    const city = patched(values.city, branch.city)
    if (city !== undefined) patch.city = city
    const phone = patched(values.phone, branch.phone)
    if (phone !== undefined) patch.phone = phone

    // Nothing moved, so there is nothing to send — Save still means "I am done here".
    if (Object.keys(patch).length === 0) {
      setEditing(false)
      return
    }
    mutation.mutate(patch)
  })

  // The disc, the text column and the action, in that order, in both modes. Rendered once so
  // the two modes cannot drift apart in position — which is the whole point of this plate.
  const head = (
    // Edit drops to its own line below `sm`. On a phone the shell already keeps its icon rail,
    // and a button that refuses to shrink beside a disc that refuses to shrink left the text
    // column at 40px — the branch name printed straight through the button (measured at 375
    // and 390; clean from 430). The name is why the reader is here, so it gets the row.
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-3.5">
      <div className="flex min-w-0 flex-1 items-start gap-3.5">
        <BranchDisc name={branch.name} className="size-11 text-heading-sm" />
        <div className="min-w-0 flex-1">
          {editing ? <PlateFieldsRow form={form} /> : <PlateText branch={branch} />}
        </div>
      </div>
      {editing || !editable ? null : (
        <Button variant="outline" size="sm" className="flex-none self-start" onClick={startEditing}>
          <Icon name="edit" size="sm" />
          {t('locations.editBranch')}
        </Button>
      )}
    </div>
  )

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
      {editing ? (
        <form onSubmit={onSubmit}>
          {failure ? (
            <Alert tone="error" className="mb-3.5">
              {failure}
            </Alert>
          ) : null}
          {head}
          {/* Delete sits at the start of the editor's own footer (owner ask 2026-08-23),
              opposite Cancel and Save rather than beside them, and only while the plate is
              open for editing. Destroying a branch is an edit to the branch, so this is where
              a reader already is when they want it; and because it only exists in edit mode it
              cannot be reached by a stray click on a page someone is only reading. `ms-auto`
              on the confirming pair, not `justify-between`, so a wrap drops them together
              instead of stranding Save alone. */}
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            {deleteAction}
            <div className="ms-auto flex flex-wrap gap-2.5">
              <Button variant="ghost" onClick={cancelEditing} disabled={mutation.isPending}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? t('common.working') : t('locations.saveChanges')}
              </Button>
            </div>
          </div>
        </form>
      ) : (
        head
      )}
    </section>
  )
}

function PlateText({ branch }: { branch: Location }) {
  const t = useTranslations()
  // Address and city are one sentence about one place, so they read as one line and the
  // comma only appears when there are two halves to separate.
  const place = [branch.address, branch.city].filter(Boolean).join(', ')
  const bare = !branch.address && !branch.city && !branch.phone

  return (
    <>
      {/* `w-fit` beside `dir="auto"` is load-bearing, not tidying. A Latin branch name inside a
          Hebrew page resolves to `dir=ltr`, and a full-width block then aligns its text to its
          OWN start — the card's far edge — stranding "Dizengoff" 900px from the disc it belongs
          to (measured at 1440 in Hebrew). Shrink-wrapped, the box itself is placed by the PAGE's
          direction, so the name sits against the disc in both scripts while the text inside it
          still runs the way the text itself reads. */}
      <h1 dir="auto" className="w-fit text-heading-lg font-extrabold text-foreground">
        {branch.name}
      </h1>
      {place ? (
        <p dir="auto" className="mt-1 w-fit text-body text-muted-foreground">
          {place}
        </p>
      ) : null}
      {branch.phone ? (
        <p dir="auto" className="mt-0.5 w-fit text-body text-muted-foreground">
          {branch.phone}
        </p>
      ) : null}
      {/* A branch with no contact details at all gets an invitation rather than a hole where
          three lines should be — the plate asks for the edit it is missing. */}
      {bare ? (
        <p className="mt-1 text-body text-muted-foreground">{t('locations.contactEmpty')}</p>
      ) : null}
    </>
  )
}

function PlateFieldsRow({ form }: { form: ReturnType<typeof useForm<PlateFields>> }) {
  const t = useTranslations()
  // h-11 is the 44px phone touch floor; an Input carries no tap collar of its own the way a
  // Button does, so it is stated here and relaxed to the drawn 40px field from md up.
  const field = 'h-11 md:h-10'

  return (
    <>
      <Input
        dir="auto"
        aria-label={t('locations.name')}
        placeholder={t('locations.name')}
        // The name keeps the heading's own size and weight while it is editable, so the eye
        // does not lose the branch it came here for. Both the base and the md step have to be
        // named: the Input sets `text-base md:text-body`, and a variant only beats a variant.
        className={`${field} text-heading-lg font-extrabold md:text-heading-lg`}
        {...form.register('name', { required: true })}
      />
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <Input
          dir="auto"
          aria-label={t('locations.fieldAddress')}
          placeholder={t('locations.fieldAddress')}
          // Address to city in roughly the 2:1 ratio the joined line reads at.
          className={`${field} sm:flex-[2]`}
          {...form.register('address')}
        />
        <Input
          dir="auto"
          aria-label={t('locations.fieldCity')}
          placeholder={t('locations.fieldCity')}
          className={`${field} sm:flex-1`}
          {...form.register('city')}
        />
      </div>
      <Input
        dir="auto"
        type="tel"
        aria-label={t('locations.fieldPhone')}
        placeholder={t('locations.fieldPhone')}
        // Capped rather than full width, because the line it replaces is a short one.
        className={`mt-2 ${field} sm:max-w-[16rem]`}
        {...form.register('phone')}
      />
    </>
  )
}
