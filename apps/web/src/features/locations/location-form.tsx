import type { Location } from '@burgers/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslations } from 'use-intl'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { Field } from '../../components/ui/field.js'
import { Input } from '../../components/ui/input.js'
import { ApiError, locationsApi } from '../../lib/api.js'
import { LOCATIONS_QUERY_KEY } from './location-list.js'

interface CreateFields {
  name: string
}

// Create a Location from a name (Slice L2 — the write). There is no hard uniqueness: same-name
// branches are legitimate (decision 5), so an exact match against the current list is a soft
// confirm ("already exists — create anyway?") rather than a block. The confirm is driven off the
// list read this form subscribes to (shared cache key, one request with the list), never a server
// rejection — the API accepts a duplicate outright. On success the list and the L3 pickers refresh
// off the shared invalidation.
export function LocationForm() {
  const t = useTranslations()
  const queryClient = useQueryClient()
  const [created, setCreated] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  // Holds the exact name a soft-duplicate confirm is pending on; a second submit of the same name
  // goes through. Cleared on success, or implicitly when the typed name no longer matches it.
  const [confirmName, setConfirmName] = useState<string | null>(null)

  // Read-only subscription to the same list the LocationList renders (React Query dedupes to one
  // request): the exact-name match that drives the soft confirm reads from here.
  const listQuery = useQuery({ queryKey: LOCATIONS_QUERY_KEY, queryFn: locationsApi.list })
  const existing: Location[] = listQuery.data?.locations ?? []

  const form = useForm<CreateFields>({ defaultValues: { name: '' } })
  const typedName = form.watch('name').trim()

  const mutation = useMutation({
    mutationFn: (name: string) => locationsApi.create({ name }),
    onSuccess: async (location) => {
      setCreated(location.name)
      setConfirmName(null)
      form.reset({ name: '' })
      await queryClient.invalidateQueries({ queryKey: LOCATIONS_QUERY_KEY })
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
      <h2 className="text-lg font-semibold text-foreground">{t('locations.createHeading')}</h2>

      {created ? <Alert tone="success">{t('locations.created', { name: created })}</Alert> : null}
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

      <Button type="submit" disabled={mutation.isPending || !typedName}>
        {mutation.isPending
          ? t('common.working')
          : awaitingConfirm
            ? t('locations.createAnyway')
            : t('locations.create')}
      </Button>
    </form>
  )
}
