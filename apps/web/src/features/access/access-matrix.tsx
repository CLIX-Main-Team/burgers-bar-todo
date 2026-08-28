import type {
  CapabilityKey,
  EditableRole,
  PrincipalResponse,
  ScopeChoice,
  ViewScopeKey,
} from '@burgers/shared'
import { ROLE_TIER, ROLE_TIERS, rolesInTier } from '@burgers/shared'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { Icon } from '../../components/ui/icon.js'
import { Skeleton } from '../../components/ui/skeleton.js'
import { Switch } from '../../components/ui/switch.js'
import { roleLabelKey, tierLabelKey } from '../../i18n/labels.js'
import { cn } from '../../lib/cn.js'
import { useAccessMatrix, useUpdateAccess, useUpdateViewScope } from './access-queries.js'
import { ACCESS_PAGES, type AccessPageDef, EDITABLE_ROLES } from './capabilities.js'
import { HelpHint } from './help-hint.js'
import { ScopeChoices } from './scope-choices.js'

// The Access page, recut on the owner's 2026-08-26 brief. Two questions per role, in the order
// he asked them: which pages this role can OPEN, then what they can DO inside each one.
//
// The page is a floor plan. The Pages grid is the rail as that role would see it — same icons,
// same order — so the owner is looking at the thing he is deciding about rather than at a list
// of nouns. Below it, one card per page, holding the controls that live behind that door. Shut
// the door and its card goes quiet: greyed, switches disabled, and the API agrees (the cascade
// is computed in @burgers/shared's isCapabilityAllowed, not written to the table), so turning
// the page back on finds every control exactly where it was left.
//
// The two sections are numbered, which is a claim worth defending on a page where numbering is
// usually decoration: these two ARE a sequence, because the second only means anything once the
// first has said yes. The numeral carries the dependency the cascade enforces.
//
// The owner's own role is absent by his call — the answer for a super_admin is yes to
// everything and always has been, so a frozen column would be eight rows of noise. The "?"
// beside the tabs says it in a sentence instead.

interface AccessMatrixProps {
  principal: PrincipalResponse
}

export function AccessMatrix({ principal }: AccessMatrixProps) {
  const t = useTranslations()
  // Open on the viewer's own row when they have one; the owner (who has no row) starts on the
  // most senior role the page edits.
  const [activeRole, setActiveRole] = useState<EditableRole>(
    EDITABLE_ROLES.find((role) => role === principal.role) ?? 'admin',
  )
  // Which group the picker is showing, read OFF the active role rather than stored beside it:
  // one source of truth means the tier row can never highlight a group the role below it is
  // not in, which is what a second useState here would eventually allow.
  const activeTier = ROLE_TIER[activeRole]
  const { data, isPending, isError } = useAccessMatrix()
  const update = useUpdateAccess()
  const setScope = useUpdateViewScope()

  const editable = data?.editable ?? false
  const failed = update.isError || setScope.isError

  // Two readings of the same switch. `effective` is what the API will actually answer, cascade
  // included; `stored` is where the owner left the lever. A control under a shut page draws
  // from `stored` so its position survives the round trip.
  const effective = new Map(data?.matrix.map((row) => [row.capability, row.byRole]) ?? [])
  const stored = new Map(data?.matrix.map((row) => [row.capability, row.raw]) ?? [])
  const scopes = new Map(data?.scopes.map((row) => [row.key, row.byRole]) ?? [])

  const pageIsOpen = (page: CapabilityKey): boolean => effective.get(page)?.[activeRole] ?? false
  const storedAt = (key: CapabilityKey): boolean => stored.get(key)?.[activeRole] ?? false
  const scopeAt = (key: ViewScopeKey): ScopeChoice =>
    (scopes.get(key)?.[activeRole] as ScopeChoice) ?? 'branch'

  const roleName = t(roleLabelKey(activeRole))

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-heading-lg font-extrabold text-foreground">{t('access.heading')}</h1>
        <p className="mt-0.5 text-label text-muted-foreground">
          {t(editable ? 'access.subtitleEditable' : 'access.subtitle')}
        </p>
      </header>

      {/* A refused or failed change surfaces here; the optimistic state has already rolled
          back to the server's truth by the time this shows. */}
      <div aria-live="polite">
        {failed && <p className="text-label text-destructive">{t('access.saveFailed')}</p>}
      </div>

      {isError ? (
        <p className="text-body text-muted-foreground">{t('access.loadFailed')}</p>
      ) : isPending ? (
        <AccessLoading />
      ) : (
        <>
          {/* Seventeen roles in one strip ran off the side of the page (owner report
              2026-08-27). They are picked in two steps now: the tier first, then the two to
              seven roles inside it, so the widest row is seven short pills rather than
              seventeen. Nothing is hidden behind a menu — both levels stay on the page — and
              the tiers are the chain's own, not a layout convenience.
              The tier is DERIVED from the active role rather than held in its own state: with
              two pieces of state they could disagree, and a tier showing roles the picker is
              not on is exactly the bug that invites. */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <fieldset className="m-0 min-w-0 rounded-lg border border-border-strong bg-card p-0.5">
                <legend className="sr-only">{t('access.tierPicker')}</legend>
                <div className="flex flex-wrap gap-0.5">
                  {ROLE_TIERS.map((tier) => (
                    <button
                      key={tier}
                      type="button"
                      aria-pressed={tier === activeTier}
                      onClick={() => {
                        const first = rolesInTier(tier)[0]
                        if (first) setActiveRole(first)
                      }}
                      className={cn(
                        'flex h-9 items-center justify-center whitespace-nowrap rounded-md px-3 text-label font-semibold transition-colors motion-reduce:transition-none',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        tier === activeTier
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {t(tierLabelKey(tier))}
                    </button>
                  ))}
                </div>
              </fieldset>
              <HelpHint textKey="access.ownerNote" subject={t('access.rolePicker')} />
            </div>

            {/* The roles inside the chosen tier. A quieter treatment than the tier row above:
                the tier is the coarse move and the role the fine one, and giving both the same
                weight made the header read as two competing rows of tabs. */}
            <fieldset className="m-0 min-w-0 border-0 p-0">
              <legend className="sr-only">{t('access.rolePicker')}</legend>
              <div className="flex flex-wrap gap-1.5">
                {rolesInTier(activeTier).map((role) => (
                  <button
                    key={role}
                    type="button"
                    aria-pressed={role === activeRole}
                    onClick={() => setActiveRole(role)}
                    className={cn(
                      'flex h-8 items-center justify-center whitespace-nowrap rounded-md border px-2.5 text-label font-semibold transition-colors motion-reduce:transition-none',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      role === activeRole
                        ? 'border-transparent bg-foreground/22 text-foreground'
                        : 'border-border-strong bg-card text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t(roleLabelKey(role))}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>

          <Section
            step="1"
            titleKey="access.sectionPages"
            leadKey="access.sectionPagesLead"
            hintKey="access.sectionPagesHint"
            aside={t('access.pagesOpen', {
              open: ACCESS_PAGES.filter((page) => pageIsOpen(page.key)).length,
              total: ACCESS_PAGES.length,
            })}
          >
            {/* The rail, as this role would see it. Two up on a phone, four across a desk — a
                card small enough to fit eight in a row stopped reading as a destination and
                started reading as a checkbox (owner call, 2026-08-26). `auto-rows-fr` keeps
                every card one size whatever any single one of them carries. */}
            <ul className="grid auto-rows-fr grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
              {ACCESS_PAGES.map((page) => {
                const on = pageIsOpen(page.key)
                const locked = Boolean(page.lockedKey)
                return (
                  <li key={page.key}>
                    <div
                      className={cn(
                        'flex h-full flex-col gap-2 rounded-xl border p-3.5 transition-colors motion-reduce:transition-none',
                        on ? 'border-border bg-card' : 'border-dashed border-border bg-muted/30',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <Icon
                          name={page.icon}
                          size="lg"
                          className={on ? 'text-foreground' : 'text-muted-foreground/60'}
                        />
                        <Switch
                          checked={on}
                          disabled={!editable || locked}
                          onCheckedChange={(next) =>
                            update.mutate({ role: activeRole, capability: page.key, allowed: next })
                          }
                          label={t('access.switchLabel', {
                            capability: t(page.labelKey),
                            role: roleName,
                          })}
                        />
                      </div>
                      <span
                        className={cn(
                          'text-body font-semibold leading-tight',
                          on ? 'text-foreground' : 'text-muted-foreground',
                        )}
                      >
                        {t(page.labelKey)}
                      </span>
                      {locked && (
                        <span className="text-caption leading-tight text-muted-foreground">
                          {t(page.lockedKey as string)}
                        </span>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </Section>

          <Section
            step="2"
            titleKey="access.sectionControl"
            leadKey="access.sectionControlLead"
            hintKey="access.sectionControlHint"
          >
            {/* Two columns from lg (owner ask, same day): six cards single-file left two thirds
                of a desktop screen empty. `auto-rows-fr` gives every card ONE size rather than
                each its own — six cards of six heights read as six unrelated things, and the
                ragged bottoms left white notches down the column. */}
            <div className="grid auto-rows-fr gap-2.5 lg:grid-cols-2">
              {ACCESS_PAGES.filter((page) => page.controls.length > 0).map((page) => (
                <PageControls
                  key={page.key}
                  page={page}
                  open={pageIsOpen(page.key)}
                  editable={editable}
                  roleName={roleName}
                  storedAt={storedAt}
                  scopeAt={scopeAt}
                  onSwitch={(key, allowed) =>
                    update.mutate({ role: activeRole, capability: key, allowed })
                  }
                  onScope={(key, choice) => setScope.mutate({ role: activeRole, key, choice })}
                />
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  )
}

// One of the two questions. The numbered tile is what makes them read as two categories rather
// than two more headings on a long page: a filled square, the title at dialog-title weight, a
// one-line lead under it, and a rule closing the band off.
function Section({
  step,
  titleKey,
  leadKey,
  hintKey,
  aside,
  children,
}: {
  step: string
  titleKey: string
  leadKey: string
  hintKey: string
  aside?: string
  children: ReactNode
}) {
  const t = useTranslations()
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5 border-b-2 border-foreground/10 pb-2">
        <span
          aria-hidden
          className="flex size-8 flex-none items-center justify-center rounded-lg bg-primary text-body font-extrabold text-primary-foreground"
        >
          {step}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h2 className="text-heading-md font-extrabold text-foreground">{t(titleKey)}</h2>
            <HelpHint textKey={hintKey} subject={t(titleKey)} />
          </div>
          <p className="text-label text-muted-foreground">{t(leadKey)}</p>
        </div>
        {aside && (
          <span className="flex-none text-caption font-semibold text-muted-foreground">
            {aside}
          </span>
        )}
      </div>
      {children}
    </section>
  )
}

// One page's card in the Control section. Shut its door and the whole card steps back: dimmed,
// every control disabled, and one line saying why — so the cascade is something the owner
// watches happen rather than a rule he has to remember.
function PageControls({
  page,
  open,
  editable,
  roleName,
  storedAt,
  scopeAt,
  onSwitch,
  onScope,
}: {
  page: AccessPageDef
  open: boolean
  editable: boolean
  roleName: string
  storedAt: (key: CapabilityKey) => boolean
  scopeAt: (key: ViewScopeKey) => ScopeChoice
  onSwitch: (key: CapabilityKey, allowed: boolean) => void
  onScope: (key: ViewScopeKey, choice: ScopeChoice) => void
}) {
  const t = useTranslations()

  return (
    <article
      className={cn(
        'flex h-full flex-col rounded-xl border border-border bg-card px-4 py-3 shadow-sm transition-opacity motion-reduce:transition-none',
        !open && 'opacity-60',
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <Icon name={page.icon} size="sm" className="translate-y-0.5 text-muted-foreground" />
        <h3 className="text-body font-semibold text-foreground">{t(page.labelKey)}</h3>
        <p className="text-caption text-muted-foreground">{t(page.blurbKey)}</p>
        {!open && (
          <span className="ms-auto text-caption font-semibold text-muted-foreground">
            {t('access.pageOff')}
          </span>
        )}
      </div>

      <ul className="mt-1 flex flex-1 flex-col">
        {page.controls.map((control) =>
          control.kind === 'switch' ? (
            <li
              key={control.key}
              className="flex min-h-11 items-center justify-between gap-3 border-t border-border py-1.5"
            >
              <span className="min-w-0 text-body text-foreground">{t(control.labelKey)}</span>
              <Switch
                checked={open && storedAt(control.key)}
                disabled={!editable || !open}
                onCheckedChange={(next) => onSwitch(control.key, next)}
                label={t('access.switchLabel', {
                  capability: t(control.labelKey),
                  role: roleName,
                })}
              />
            </li>
          ) : (
            <li key={control.key} className="flex flex-col gap-1.5 border-t border-border py-2">
              <span className="text-body text-foreground">{t(control.labelKey)}</span>
              <ScopeChoices
                scopeKey={control.key}
                value={scopeAt(control.key)}
                disabled={!editable || !open}
                label={t(control.labelKey)}
                onChange={(choice) => onScope(control.key, choice)}
              />
            </li>
          ),
        )}
      </ul>
    </article>
  )
}

function AccessLoading() {
  return (
    <div className="flex flex-col gap-2.5" aria-hidden>
      <Skeleton className="h-9 w-72 max-w-full" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-56 w-full" />
    </div>
  )
}
