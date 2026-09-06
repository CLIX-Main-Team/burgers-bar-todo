import type { PrincipalResponse, UpdateProfileRequest } from '@burgers/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslations } from 'use-intl'
import { ME_QUERY_KEY } from '../../auth/session.js'
import { Alert } from '../../components/ui/alert.js'
import { AVATAR_TONES, hashedTone } from '../../components/ui/avatar-color.js'
import { Avatar } from '../../components/ui/avatar.js'
import { Button } from '../../components/ui/button.js'
import { Field } from '../../components/ui/field.js'
import { Input } from '../../components/ui/input.js'
import { roleLabelKey } from '../../i18n/labels.js'
import { ApiError, authApi } from '../../lib/api.js'
import { cn } from '../../lib/cn.js'

// Name and colour, one form (Profile page, 2026-09-04). They share a Save because together they
// are the disc the rest of the team recognises a person by: the initials come from the name,
// the ground from the colour, and the preview at the top repaints as either changes so the
// person is choosing the actual face, not a paint chip.
//
// The swatches ARE avatars — the person's own initials on each of the eight tones — rather than
// coloured dots, for the same reason. "Automatic" is the ninth choice: the colour the app hashes
// from the name, which is what everyone wears until they choose, drawn on the swatch it currently
// resolves to so the person can see what "automatic" means for them today.
//
// Nothing is stored until Save. The preview and the strip below it read the form's live values,
// so a person can try every tone and walk away having changed nothing.

interface IdentityFields {
  displayName: string
}

const OVERLINE = 'text-caption font-bold uppercase tracking-[0.08em] text-muted-foreground'

export function IdentityForm({ principal }: { principal: PrincipalResponse }) {
  const t = useTranslations()
  const queryClient = useQueryClient()
  const form = useForm<IdentityFields>({ defaultValues: { displayName: principal.displayName } })
  const [tone, setTone] = useState<number | null>(principal.avatarTone)
  const [saved, setSaved] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  // What the preview draws: the typed name once it has any letters, the saved one while the
  // field is being cleared, so the disc never shows a "?" mid-edit.
  const typed = form.watch('displayName').trim()
  const liveName = typed || principal.displayName
  const dirty = typed !== principal.displayName || tone !== principal.avatarTone

  const mutation = useMutation({
    mutationFn: (body: UpdateProfileRequest) => authApi.updateProfile(body),
    onSuccess: async (fresh) => {
      // The answer IS the fresh principal, so the popover and this page repaint from it at
      // once; every other cached face — task cards, rosters, branch boxes — still carries the
      // old colour until it is fetched again, so the rest of the cache is invalidated behind it.
      queryClient.setQueryData(ME_QUERY_KEY, fresh)
      form.reset({ displayName: fresh.displayName })
      setSaved(true)
      await queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'auth' })
    },
    onError: (error) => {
      setFailure(
        error instanceof ApiError && error.status === 0
          ? t('common.networkError')
          : t('profile.saveFailed'),
      )
    },
  })

  const onSubmit = form.handleSubmit((values) => {
    setSaved(false)
    setFailure(null)
    mutation.mutate({ displayName: values.displayName.trim(), avatarTone: tone })
  })

  const nameInvalid = Boolean(form.formState.errors.displayName)

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit}>
      {/* The face and its name, side by side: the disc is big here — the one place in the app
          it is the subject rather than a mark beside something else. */}
      <div className="flex items-start gap-4">
        <Avatar
          name={liveName}
          tone={tone}
          className="size-16 flex-none text-heading-md md:size-[4.5rem]"
        />
        <Field
          label={t('profile.displayName')}
          hint={t('profile.displayNameHint')}
          error={nameInvalid ? t('profile.nameRequired') : undefined}
          className="min-w-0 flex-1"
        >
          {(props) => (
            <Input
              {...props}
              {...form.register('displayName', {
                required: true,
                validate: (value) => value.trim().length > 0,
              })}
              dir="auto"
              maxLength={120}
              autoComplete="name"
            />
          )}
        </Field>
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className={OVERLINE}>{t('profile.colour')}</legend>
        <p className="text-caption text-muted-foreground">{t('profile.colourHint')}</p>
        <div className="mt-2.5 flex flex-wrap gap-2.5">
          <ToneOption
            value={null}
            name={liveName}
            selected={tone === null}
            onSelect={setTone}
            label={t('profile.colourAuto')}
          />
          {AVATAR_TONES.map((value) => (
            <ToneOption
              key={value}
              value={value}
              name={liveName}
              selected={tone === value}
              onSelect={setTone}
              label={t('profile.toneName', { n: value })}
            />
          ))}
        </div>
        {/* The chosen swatch's name in words, because a ring is not a label: it says which one
            is picked to a reader who cannot see the ring, and what "automatic" resolves to. */}
        <p aria-live="polite" className="mt-1 text-caption text-muted-foreground">
          {tone === null ? t('profile.colourAutoChosen') : t('profile.toneChosen', { n: tone })}
        </p>
      </fieldset>

      <SeenAs name={liveName} tone={tone} roleLabel={t(roleLabelKey(principal.role))} />

      <div aria-live="polite" className="empty:hidden">
        {saved ? <Alert tone="success">{t('profile.saved')}</Alert> : null}
        {failure ? <Alert tone="error">{failure}</Alert> : null}
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={!dirty || mutation.isPending}>
          {mutation.isPending ? t('common.working') : t('profile.save')}
        </Button>
      </div>
    </form>
  )
}

// One swatch: a native radio for the keyboard and the screen reader, and the person's own disc
// on that tone for the eye. The radio is visually hidden and the disc reads its state through
// `peer`, so a Tab lands on it, arrows move between them, and the ring follows both a click and
// a keypress. The automatic swatch wears a dashed inner outline: it is a colour that follows the
// name rather than one that is pinned, and the dash says "not fixed" without a word.
function ToneOption({
  value,
  name,
  selected,
  onSelect,
  label,
}: {
  value: number | null
  name: string
  selected: boolean
  onSelect: (value: number | null) => void
  label: string
}) {
  return (
    <label className="relative cursor-pointer">
      <input
        type="radio"
        name="avatar-tone"
        className="peer sr-only"
        checked={selected}
        onChange={() => onSelect(value)}
        aria-label={label}
      />
      <Avatar
        name={name}
        tone={value ?? hashedTone(name)}
        className={cn(
          'size-11 text-label transition-transform md:size-10',
          'peer-checked:ring-2 peer-checked:ring-foreground peer-checked:ring-offset-2 peer-checked:ring-offset-card motion-safe:peer-checked:scale-110',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-card',
          value === null && 'outline-dashed outline-2 -outline-offset-4 outline-current/50',
        )}
      />
    </label>
  )
}

// The disc at the three sizes the app actually draws it, with a scrap of each surface around
// it: the 23px stack on a task card, the 28px roster row, the 32px account foot on the dark nav.
// It is the page's one argument for choosing carefully — a tone that sings at 72px can vanish
// at 23px beside a "+2" — and it is honest content, not decoration: every pixel of chrome here
// is the real component's class list.
function SeenAs({
  name,
  tone,
  roleLabel,
}: { name: string; tone: number | null; roleLabel: string }) {
  const t = useTranslations()
  return (
    <div>
      <p className={OVERLINE}>{t('profile.seenAs')}</p>
      <div className="mt-2 grid gap-2.5 sm:grid-cols-3">
        <Preview label={t('profile.seenAsCard')}>
          {/* A card's assignee stack at its real 23px, with the viewer's own disc drawn LAST so
              it sits on top. In the live stack a disc is partly covered by the one after it,
              which is honest but would hide half the initials — and reading your initials at
              card scale is the only reason this box exists. Standing second is just as true as
              standing first, so the arrangement costs nothing and shows what it promises. */}
          <span className="flex items-center">
            <span
              aria-hidden
              className="inline-grid size-[23px] place-items-center rounded-full bg-muted text-[0.59375rem] font-semibold text-muted-foreground ring-2 ring-card"
            />
            {/* The pull-back rides a plain wrapper, never the Avatar itself, which is what the
                live stack does too (avatar.tsx). An Avatar carries dir="auto", so a Latin name
                resolves that element to LTR and its own `-ms-*` becomes a LEFT margin even on a
                Hebrew page — the overlap then lands on the wrong side and reads as no overlap
                at all. On an undirected wrapper the logical margin follows the page. */}
            <span className="-ms-1.5">
              <Avatar
                name={name}
                tone={tone}
                className="size-[23px] text-[0.59375rem] ring-2 ring-card"
              />
            </span>
          </span>
        </Preview>
        <Preview label={t('profile.seenAsRoster')}>
          <Avatar name={name} tone={tone} className="size-7 flex-none" />
          <span dir="auto" className="min-w-0 truncate text-body font-semibold text-foreground">
            {name}
          </span>
        </Preview>
        <Preview label={t('profile.seenAsMenu')} nav>
          <Avatar
            name={name}
            tone={tone}
            className="size-8 flex-none text-label ring-2 ring-nav-active"
          />
          <span className="flex min-w-0 flex-col">
            <span dir="auto" className="truncate text-body font-semibold leading-tight">
              {name}
            </span>
            <span className="truncate text-caption leading-tight text-nav-muted">{roleLabel}</span>
          </span>
        </Preview>
      </div>
    </div>
  )
}

function Preview({ label, nav, children }: { label: string; nav?: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex min-h-[4.5rem] flex-col justify-between gap-2 rounded-lg border px-3 py-2.5',
        nav ? 'border-nav-border bg-nav-surface text-nav-ink' : 'border-border bg-background',
      )}
    >
      <span className={cn('text-caption', nav ? 'text-nav-muted' : 'text-muted-foreground')}>
        {label}
      </span>
      <span className="flex min-w-0 items-center gap-2.5">{children}</span>
    </div>
  )
}
