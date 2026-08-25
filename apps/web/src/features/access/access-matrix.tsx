import type { CapabilityKey, PrincipalResponse, Role } from '@burgers/shared'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { Badge } from '../../components/ui/badge.js'
import { Icon } from '../../components/ui/icon.js'
import { Skeleton } from '../../components/ui/skeleton.js'
import { Switch } from '../../components/ui/switch.js'
import { roleLabelKey } from '../../i18n/labels.js'
import { cn } from '../../lib/cn.js'
import { useAccessMatrix, useUpdateAccess } from './access-queries.js'
import { ACCESS_GROUPS, type AccessRowDef, ROLE_ORDER } from './capabilities.js'

// The Access page (owner asks 2026-08-24, three times over): the role-capability map, then
// "this page is where we CONTROL which roles see which", then "filter by role so its much
// better understanding what every role can do" — so the page reads one role at a time behind
// a segmented tab bar, at every breakpoint. For the owner every row ends in a live switch
// over GET /access, and a flip is enforced by the API on everyone's next request. For every
// other role the page stays the read-only map of the rules they live under.
//
// The owner's own tab has no live switches: it is locked all-ON by the server, so the role
// holding the levers can never saw off its own branch — its switches render ON and disabled
// under an "Always on" chip. Scope words (chain wide / own branch / assigned only) describe
// the tier-two predicates, which stay derived from the role and are deliberately not
// editable — a switch gates yes/no, the role's nature decides how far.
//
// The switches are OFF the page as of 2026-08-25 (the owner's words: "make it read-only and
// I'll create the buttons again"). His per-page brief is now the catalog's defaults, so the map
// this page draws is the model itself rather than a starting point somebody is expected to
// adjust. Everything behind them is untouched and still enforced — the overrides table, the
// update endpoint, its super_admin guard — so putting them back is this one flag.

interface AccessMatrixProps {
  principal: PrincipalResponse
}

// ON states that carry no real limit print as full ink; a limiting scope word steps back to
// muted so the eye reads the ladder at a glance. Colour is never the only carrier — the word
// is always there (WCAG 1.4.1, the dashboard donut's rule).
const FULL_SCOPES = new Set(['access.levelChain', 'access.levelAnyRole'])

// See the note above: flip to true to hand the owner his switches back.
const SWITCHES_ENABLED = false

export function AccessMatrix({ principal }: AccessMatrixProps) {
  const t = useTranslations()
  const [activeRole, setActiveRole] = useState<Role>(principal.role)
  const { data, isPending, isError } = useAccessMatrix()
  const update = useUpdateAccess()

  const allowed = new Map<CapabilityKey, Record<Role, boolean>>(
    data?.matrix.map((row) => [row.capability, row.byRole]) ?? [],
  )
  const editable = SWITCHES_ENABLED && (data?.editable ?? false)
  const isAllowed = (key: CapabilityKey, role: Role): boolean => allowed.get(key)?.[role] ?? false

  const rowEnd = (row: AccessRowDef) => {
    const on = isAllowed(row.key, activeRole)
    const scopeKey = row.scopeByRole?.[activeRole]
    if (editable) {
      const locked = activeRole === 'super_admin'
      return (
        <span className="inline-flex flex-none items-center gap-2.5">
          {on && scopeKey && (
            <span className="text-caption text-muted-foreground">{t(scopeKey)}</span>
          )}
          <Switch
            checked={on}
            disabled={locked}
            onCheckedChange={(next) =>
              update.mutate({ role: activeRole, capability: row.key, allowed: next })
            }
            label={t('access.switchLabel', {
              capability: t(row.labelKey),
              role: t(roleLabelKey(activeRole)),
            })}
          />
        </span>
      )
    }
    return <LevelCell on={on} scopeKey={scopeKey} />
  }

  return (
    <div className="flex flex-col gap-4.5">
      <div>
        <h1 className="text-heading-lg font-extrabold text-foreground">{t('access.heading')}</h1>
        <p className="mt-0.5 text-label text-muted-foreground">
          {t(editable ? 'access.subtitleEditable' : 'access.subtitle')}
        </p>
      </div>

      {/* A refused or failed flip surfaces here; the optimistic state has already rolled
          back to the server's truth by the time this shows. */}
      <div aria-live="polite">
        {update.isError && <p className="text-label text-destructive">{t('access.saveFailed')}</p>}
      </div>

      {isError ? (
        <p className="text-body text-muted-foreground">{t('access.loadFailed')}</p>
      ) : isPending ? (
        <AccessLoading />
      ) : (
        <>
          {/* One role at a time, picked by a segmented tab bar (owner ask: filter by role).
              The end slot explains a frozen tab: the owner's own column is server-locked. */}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <fieldset className="flex flex-wrap gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5">
              <legend className="sr-only">{t('access.rolePicker')}</legend>
              {ROLE_ORDER.map((role) => (
                <button
                  key={role}
                  type="button"
                  aria-pressed={role === activeRole}
                  onClick={() => setActiveRole(role)}
                  className={cn(
                    'flex h-8 items-center gap-1.5 rounded-md px-3 text-label font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    role === activeRole
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(roleLabelKey(role))}
                  {role === principal.role && <Badge variant="accent">{t('access.youChip')}</Badge>}
                </button>
              ))}
            </fieldset>
            {editable && activeRole === 'super_admin' && (
              <Badge variant="muted">{t('access.lockedChip')}</Badge>
            )}
          </div>

          {/* The whole catalog in one bordered card: group headers band the rows the way the
              rail groups the screens they belong to; two columns once the width allows. */}
          <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm md:px-5">
            {ACCESS_GROUPS.map((group) => (
              <section key={group.key}>
                <h2 className="pt-3 pb-1 text-caption font-bold uppercase tracking-wider text-muted-foreground">
                  {t(group.labelKey)}
                </h2>
                <ul className="md:grid md:grid-cols-2 md:gap-x-10">
                  {group.rows.map((row) => (
                    <li
                      key={row.key}
                      className="flex min-h-11 items-center justify-between gap-3 border-b border-border py-2 last:border-b-0 md:nth-last-[-n+2]:border-b-0"
                    >
                      <span className="min-w-0 text-body text-foreground">{t(row.labelKey)}</span>
                      {rowEnd(row)}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// One read-only row end. The word is the content and the mark supports it: an ON state
// prints its scope in words, and the no-access dash carries screen-reader text of its own.
function LevelCell({ on, scopeKey }: { on: boolean; scopeKey?: string }) {
  const t = useTranslations()

  if (!on) {
    return (
      <span className="flex-none text-body text-muted-foreground/50">
        <span aria-hidden>—</span>
        <span className="sr-only">{t('access.levelNone')}</span>
      </span>
    )
  }

  const full = !scopeKey || FULL_SCOPES.has(scopeKey)
  return (
    <span className="inline-flex flex-none items-center gap-1.5">
      <Icon name="selected" size="sm" className={full ? 'text-success' : 'text-muted-foreground'} />
      <span
        className={cn(
          'text-caption',
          full ? 'font-semibold text-foreground' : 'text-muted-foreground',
        )}
      >
        {t(scopeKey ?? 'access.levelYes')}
      </span>
    </span>
  )
}

function AccessLoading() {
  return (
    <div className="flex flex-col gap-2.5" aria-hidden>
      <Skeleton className="h-9 w-72 max-w-full" />
      <Skeleton className="h-56 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}
