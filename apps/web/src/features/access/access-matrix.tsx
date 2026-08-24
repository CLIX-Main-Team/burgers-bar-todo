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

// The Access page (owner asks 2026-08-24, twice over): first the role-capability map, then
// "this page is where we CONTROL which roles see which" — so for the owner every cell is a
// live switch over GET /access, and a flip is enforced by the API on everyone's next
// request. For every other role the page stays the read-only map of the rules they live
// under (his call: super_admin edits, the rest read).
//
// The owner's own column has no switches: it is locked all-ON by the server, so the role
// holding the levers can never saw off its own branch. Scope words (chain wide / own branch
// / assigned only) describe the tier-two predicates, which stay derived from the role and
// are deliberately not editable — a switch gates yes/no, the role's nature decides how far.
//
// Desktop shows all four roles side by side because the question is comparative; the phone
// shows one role at a time behind a picker, opening on the viewer's own role.

interface AccessMatrixProps {
  principal: PrincipalResponse
}

// ON states that carry no real limit print as full ink; a limiting scope word steps back to
// muted so the eye reads the ladder at a glance. Colour is never the only carrier — the word
// is always there (WCAG 1.4.1, the dashboard donut's rule).
const FULL_SCOPES = new Set(['access.levelChain', 'access.levelAnyRole'])

export function AccessMatrix({ principal }: AccessMatrixProps) {
  const t = useTranslations()
  const [phoneRole, setPhoneRole] = useState<Role>(principal.role)
  const { data, isPending, isError } = useAccessMatrix()
  const update = useUpdateAccess()

  const allowed = new Map<CapabilityKey, Record<Role, boolean>>(
    data?.matrix.map((row) => [row.capability, row.byRole]) ?? [],
  )
  const editable = data?.editable ?? false
  const isAllowed = (key: CapabilityKey, role: Role): boolean => allowed.get(key)?.[role] ?? false

  const cell = (row: AccessRowDef, role: Role) => {
    const on = isAllowed(row.key, role)
    const scopeKey = row.scopeByRole?.[role]
    // The owner's column is server-locked; everyone else's flips when the viewer may edit.
    if (editable && role !== 'super_admin') {
      return (
        <span className="inline-flex min-h-9 flex-col items-center justify-center gap-1">
          <Switch
            checked={on}
            onCheckedChange={(next) => update.mutate({ role, capability: row.key, allowed: next })}
            label={t('access.switchLabel', {
              capability: t(row.labelKey),
              role: t(roleLabelKey(role)),
            })}
          />
          {on && scopeKey && (
            <span className="text-caption text-muted-foreground">{t(scopeKey)}</span>
          )}
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
          {/* Desktop: the whole map in one bordered card, roles as columns (the locations
              table's grammar). Group rows band the capabilities the way the rail groups the
              screens they belong to. */}
          <div className="hidden rounded-xl border border-border bg-card shadow-sm md:block">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="w-[32%] px-4 py-[11px] text-start text-caption font-bold tracking-wider text-muted-foreground">
                    {t('access.capabilityColumn')}
                  </th>
                  {ROLE_ORDER.map((role) => (
                    <th
                      key={role}
                      className={cn(
                        'px-3 py-[11px] text-center text-caption font-bold tracking-wider text-muted-foreground',
                        role === principal.role && 'bg-muted/60',
                      )}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {t(roleLabelKey(role))}
                        {role === principal.role && (
                          <Badge variant="accent">{t('access.youChip')}</Badge>
                        )}
                        {editable && role === 'super_admin' && (
                          <Badge variant="muted">{t('access.lockedChip')}</Badge>
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ACCESS_GROUPS.map((group) => (
                  <GroupRows
                    key={group.key}
                    group={group}
                    viewerRole={principal.role}
                    cell={cell}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Phone: one role at a time — a picker over grouped cards. Four scope-worded
              columns cannot share 390px, and one role is the question anyway. */}
          <div className="flex flex-col gap-4 md:hidden">
            <fieldset className="flex flex-wrap gap-1.5">
              <legend className="sr-only">{t('access.rolePicker')}</legend>
              {ROLE_ORDER.map((role) => (
                <button
                  key={role}
                  type="button"
                  aria-pressed={role === phoneRole}
                  onClick={() => setPhoneRole(role)}
                  className={cn(
                    'flex h-9 items-center gap-1.5 rounded-md border px-3 text-label font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    role === phoneRole
                      ? 'border-transparent bg-primary text-primary-foreground'
                      : 'border-border bg-card text-muted-foreground hover:bg-muted',
                  )}
                >
                  {t(roleLabelKey(role))}
                  {role === principal.role && (
                    <Badge variant={role === phoneRole ? 'muted' : 'accent'}>
                      {t('access.youChip')}
                    </Badge>
                  )}
                </button>
              ))}
            </fieldset>

            {ACCESS_GROUPS.map((group) => (
              <section
                key={group.key}
                className="rounded-lg border border-border bg-card px-3.5 py-3 shadow-sm"
              >
                <h2 className="pb-1.5 text-caption font-bold uppercase tracking-wider text-muted-foreground">
                  {t(group.labelKey)}
                </h2>
                <ul>
                  {group.rows.map((row) => (
                    <li
                      key={row.key}
                      className="flex items-center justify-between gap-3 border-b border-border py-[11px] last:border-b-0 last:pb-1"
                    >
                      <span className="text-body text-foreground">{t(row.labelKey)}</span>
                      {cell(row, phoneRole)}
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

function GroupRows({
  group,
  viewerRole,
  cell,
}: {
  group: (typeof ACCESS_GROUPS)[number]
  viewerRole: Role
  cell: (row: AccessRowDef, role: Role) => React.ReactNode
}) {
  const t = useTranslations()
  return (
    <>
      <tr>
        <td
          colSpan={ROLE_ORDER.length + 1}
          className="px-4 pt-4 pb-1.5 text-caption font-bold uppercase tracking-wider text-muted-foreground"
        >
          {t(group.labelKey)}
        </td>
      </tr>
      {group.rows.map((row) => (
        <tr key={row.key} className="border-b border-border last:border-b-0">
          <td className="px-4 py-[11px] text-body text-foreground">{t(row.labelKey)}</td>
          {ROLE_ORDER.map((role) => (
            <td
              key={role}
              className={cn('px-3 py-[11px] text-center', role === viewerRole && 'bg-muted/60')}
            >
              {cell(row, role)}
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

// One read-only cell. The word is the content and the mark supports it: an ON state prints
// its scope in words, and the no-access dash carries screen-reader text of its own.
function LevelCell({ on, scopeKey }: { on: boolean; scopeKey?: string }) {
  const t = useTranslations()

  if (!on) {
    return (
      <span className="text-body text-muted-foreground/50">
        <span aria-hidden>—</span>
        <span className="sr-only">{t('access.levelNone')}</span>
      </span>
    )
  }

  const full = !scopeKey || FULL_SCOPES.has(scopeKey)
  return (
    <span className="inline-flex items-center gap-1.5">
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
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-56 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}
