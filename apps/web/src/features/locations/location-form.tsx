import {
  type Location,
  OPENING_CHECKLIST,
  OPENING_PROJECT_COLOUR,
  OPENING_PROJECT_ICON,
  type PreferredLanguage,
  openingProjectName,
} from '@burgers/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { useLocale, useTranslations } from 'use-intl'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { Field } from '../../components/ui/field.js'
import { Icon } from '../../components/ui/icon.js'
import { Input } from '../../components/ui/input.js'
import { Switch } from '../../components/ui/switch.js'
import { ApiError, locationsApi } from '../../lib/api.js'
import { PROJECT_ICON_ROLE, PROJECT_TILE } from '../projects/project-look.js'
import { PROJECTS_QUERY_KEY } from '../projects/project-queries.js'
import { LOCATIONS_QUERY_KEY, useLocations } from './use-locations.js'

interface CreateFields {
  name: string
}

// How many checklist lines the preview shows before it rolls the rest into a count. Three is
// enough to prove the list is the chain's real document rather than a promise, and few enough
// that the switch stays a switch instead of becoming a form.
const PREVIEW_LINES = 3

// Create a Location from a name (Slice L2 — the write). There is no hard uniqueness: same-name
// branches are legitimate (decision 5), so an exact match against the current list is a soft
// confirm ("already exists — create anyway?") rather than a block. The confirm is driven off the
// list read this form subscribes to (shared cache key, one request with the list), never a server
// rejection — the API accepts a duplicate outright. On success the list and the L3 pickers refresh
// off the shared invalidation.
//
// Since 2026-08-26 the same submit can also start the branch's opening project (owner ask). It is
// a switch in THIS dialog rather than a second dialog after it: one decision and one submit, so
// the branch and its project either both exist or neither does, and saying no costs nothing. The
// switch does not open the project form — every field an opening project needs has one right
// answer (shared: OPENING_PROJECT_*), and the forty checklist lines are the chain's document, not
// something anybody would type here. What it shows instead is a preview of what will be made, and
// the project's own page is where it is edited.
export function LocationForm({ onClose }: { onClose: () => void }) {
  const t = useTranslations()
  // The active locale, narrowed to the two languages the checklist is written in. use-intl's own
  // hook rather than the app's LocaleProvider: the IntlProvider is what every consumer of this
  // form already mounts, tests included, so the preview needs nothing extra to render.
  const locale: PreferredLanguage = useLocale() === 'he' ? 'he' : 'en'
  const queryClient = useQueryClient()
  const [created, setCreated] = useState<Location | null>(null)
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  // Holds the exact name a soft-duplicate confirm is pending on; a second submit of the same name
  // goes through. Cleared on success, or implicitly when the typed name no longer matches it.
  const [confirmName, setConfirmName] = useState<string | null>(null)
  // On by default: a branch being created is a branch being opened, and the checklist is what
  // opening one means here. Turning it off is the exception, so it is the exception that costs
  // the click.
  const [withProject, setWithProject] = useState(true)

  // Read-only subscription to the same list the LocationList renders (React Query dedupes to one
  // request): the exact-name match that drives the soft confirm reads from here.
  const listQuery = useLocations()
  const existing: Location[] = listQuery.data ?? []

  const form = useForm<CreateFields>({ defaultValues: { name: '' } })
  const typedName = form.watch('name').trim()

  const checklist = OPENING_CHECKLIST[locale]

  const mutation = useMutation({
    mutationFn: (name: string) =>
      // The locale the preview was drawn in rides along, so what was shown is what gets written.
      locationsApi.create({ name, withOpeningProject: withProject, language: locale }),
    onSuccess: async (location) => {
      setCreated(location)
      setCreatedProjectId(location.openingProjectId)
      setConfirmName(null)
      form.reset({ name: '' })
      await queryClient.invalidateQueries({ queryKey: LOCATIONS_QUERY_KEY })
      // The branch boxes count projects per branch, so a create that started one has to refresh
      // the project list too or the new box would read 0 until something else invalidated it.
      if (location.openingProjectId) {
        await queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY })
      }
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        if (error.status === 403) return setFailure(t('locations.forbidden'))
        if (error.status === 0) return setFailure(t('common.networkError'))
      }
      setFailure(t('locations.createFailed'))
    },
  })

  const onSubmit = form.handleSubmit((values) => {
    setFailure(null)
    setCreated(null)
    const name = values.name.trim()
    if (!name) {
      return
    }
    // First submit of a name that collides with an existing branch → hold for confirmation rather
    // than create. A second submit of that same name (confirmName === name) falls through to create.
    const isDuplicate = existing.some((location) => location.name.trim() === name)
    if (isDuplicate && confirmName !== name) {
      setConfirmName(name)
      return
    }
    mutation.mutate(name)
  })

  // The confirm prompt is live only while the typed name still equals the one it was raised for —
  // editing the field away from the duplicate silently drops back to the normal create action.
  const awaitingConfirm = confirmName !== null && confirmName === typedName

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      {created ? (
        <Alert tone="success">
          {createdProjectId ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {t('locations.createdWithProject', { name: created.name })}
              <Link
                to={`/projects/${createdProjectId}`}
                onClick={onClose}
                className="font-semibold underline underline-offset-2"
              >
                {t('locations.openOpeningProject')}
              </Link>
            </span>
          ) : withProject ? (
            t('locations.openingProjectFailed', { name: created.name })
          ) : (
            t('locations.created', { name: created.name })
          )}
        </Alert>
      ) : null}
      {failure ? <Alert tone="error">{failure}</Alert> : null}
      {awaitingConfirm ? (
        <Alert tone="info">{t('locations.duplicateConfirm', { name: confirmName })}</Alert>
      ) : null}

      <Field label={t('locations.name')}>
        {(props) => (
          <Input
            {...props}
            placeholder={t('locations.namePlaceholder')}
            {...form.register('name', { required: true })}
          />
        )}
      </Field>

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <div className="flex items-start gap-3">
          <Switch
            checked={withProject}
            onCheckedChange={setWithProject}
            label={t('locations.startOpeningProject')}
            disabled={mutation.isPending}
            className="mt-0.5"
          />
          <div className="min-w-0">
            <p className="text-label font-semibold text-foreground">
              {t('locations.startOpeningProject')}
            </p>
            <p className="mt-0.5 text-caption text-muted-foreground">
              {t('locations.openingProjectHint', { count: checklist.length })}
            </p>
          </div>
        </div>

        {withProject ? (
          <OpeningProjectPreview
            name={
              typedName
                ? openingProjectName(typedName, locale)
                : t('locations.openingProjectUnnamed')
            }
            named={typedName.length > 0}
            checklist={checklist}
          />
        ) : null}
      </div>

      <div className="mt-2 flex justify-end gap-2.5">
        <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={mutation.isPending || !typedName}>
          {mutation.isPending
            ? t('common.working')
            : awaitingConfirm
              ? t('locations.createAnyway')
              : t('locations.create')}
        </Button>
      </div>
    </form>
  )
}

// What the switch will make, drawn in the app's own project grammar: the rounded square holding
// the project's glyph (project-look.ts), its name, then the first lines of the checklist. Not a
// form — nothing in here is editable, on purpose. It is `aria-hidden` because the switch's own
// label and hint already say what it does in words, and reading forty-odd steps out to somebody
// who has not chosen to open the project yet would bury the field they are actually filling in.
function OpeningProjectPreview({
  name,
  named,
  checklist,
}: {
  name: string
  named: boolean
  checklist: readonly string[]
}) {
  const t = useTranslations()
  const shown = checklist.slice(0, PREVIEW_LINES)
  const hidden = checklist.length - shown.length

  return (
    <div aria-hidden className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-2.5">
        <span
          className={`flex size-7 flex-none items-center justify-center rounded-md ${PROJECT_TILE[OPENING_PROJECT_COLOUR]}`}
        >
          <Icon name={PROJECT_ICON_ROLE[OPENING_PROJECT_ICON]} size="sm" />
        </span>
        <span
          className={`min-w-0 truncate text-label font-semibold ${named ? 'text-foreground' : 'text-muted-foreground'}`}
          dir="auto"
        >
          {name}
        </span>
      </div>
      <ul className="mt-2.5 flex flex-col gap-1 border-t border-border pt-2.5">
        {shown.map((line) => (
          <li key={line} className="flex items-center gap-2 text-caption text-muted-foreground">
            {/* The same empty box the project page draws an unticked item with (project-detail),
                at preview scale — so what this shows is recognisably the list they will get. */}
            <span className="size-3.5 flex-none rounded-[3px] border border-border-strong" />
            <span className="min-w-0 truncate" dir="auto">
              {line}
            </span>
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <p className="mt-1.5 ps-5.5 text-caption text-muted-foreground/80">
          {t('locations.openingProjectMore', { count: hidden })}
        </p>
      ) : null}
    </div>
  )
}
