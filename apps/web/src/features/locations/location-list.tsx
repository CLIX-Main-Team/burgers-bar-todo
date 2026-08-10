import type { Location } from '@burgers/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { Field } from '../../components/ui/field.js'
import { Input } from '../../components/ui/input.js'
import { locationsApi } from '../../lib/api.js'
import { LOCATIONS_QUERY_KEY, useLocations } from './use-locations.js'

// The authoritative Location list (Slice L2 — the read). The API returns every branch ordered by
// name (#164); this renders them, or an explicit empty state so "no branches yet" reads as a state,
// not an absent section. Each row carries an inline rename. The whole surface is admin-only, gated
// by the route (RequireAdmin); the API re-authorises every call regardless (ADR-0007). The read
// goes through the shared useLocations hook, so the L3 pickers (invite / task form) share this
// screen's cache key and every create or rename here invalidates all of them together.
export function LocationList() {
  const t = useTranslations()
  const query = useLocations()

  if (query.isPending) {
    return <p className="text-sm text-muted-foreground">{t('common.working')}</p>
  }
  if (query.isError) {
    return <Alert tone="error">{t('locations.loadFailed')}</Alert>
  }

  const locations = query.data

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-heading-sm font-semibold text-foreground">{t('locations.listHeading')}</h2>
      {locations.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('locations.empty')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {locations.map((location) => (
            <LocationRow key={location.id} location={location} />
          ))}
        </div>
      )}
    </section>
  )
}

// One branch: its name, with an inline rename that swaps the name for an editable field. Save →
// PATCH /locations/:id, then invalidate so the new name is read back from the API rather than
// guessed; an empty or unchanged name simply closes the editor without a call.
function LocationRow({ location }: { location: Location }) {
  const t = useTranslations()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(location.name)
  const [failed, setFailed] = useState(false)

  const rename = useMutation({
    mutationFn: (name: string) => locationsApi.rename(location.id, { name }),
    onSuccess: async () => {
      setEditing(false)
      await queryClient.invalidateQueries({ queryKey: LOCATIONS_QUERY_KEY })
    },
    onError: () => setFailed(true),
  })

  function startEditing() {
    setDraft(location.name)
    setFailed(false)
    setEditing(true)
  }

  function save() {
    const name = draft.trim()
    // A blank or unchanged name is a no-op close, not a call the API would reject or that would
    // churn the list — the rename is only sent when the name actually changed.
    if (!name || name === location.name) {
      setEditing(false)
      return
    }
    setFailed(false)
    rename.mutate(name)
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border p-3">
        <p className="min-w-0 flex-1 truncate font-medium text-foreground">{location.name}</p>
        <Button variant="outline" size="sm" onClick={startEditing}>
          {t('locations.rename')}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-end gap-2">
        <Field label={t('locations.name')} className="flex-1">
          {(props) => (
            <Input
              {...props}
              value={draft}
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  save()
                }
              }}
            />
          )}
        </Field>
        <Button size="sm" disabled={rename.isPending} onClick={save}>
          {rename.isPending ? t('common.working') : t('locations.save')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={rename.isPending}
          onClick={() => setEditing(false)}
        >
          {t('common.cancel')}
        </Button>
      </div>
      {failed ? <Alert tone="error">{t('locations.renameFailed')}</Alert> : null}
    </div>
  )
}
