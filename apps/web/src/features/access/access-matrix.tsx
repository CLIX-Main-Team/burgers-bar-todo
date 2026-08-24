import type { PrincipalResponse, Role } from '@burgers/shared'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { Badge } from '../../components/ui/badge.js'
import { Icon } from '../../components/ui/icon.js'
import { roleLabelKey } from '../../i18n/labels.js'
import { cn } from '../../lib/cn.js'
import { ACCESS_GROUPS, type AccessLevel, ROLE_ORDER } from './capabilities.js'

// The Access page (owner ask 2026-08-24): the role-capability map, readable at a glance.
//
// Two deliberate departures from the reference screenshot it started from:
// - No toggles. Our roles are fixed capability sets with no editing backend; a switch that
//   cannot be flipped promises something the page does not do. Each cell instead prints the
//   truth this system actually has — a tier plus its SCOPE (chain wide / own branch / only
//   what names you), which a boolean toggle could never carry.
// - Desktop shows all four roles side by side, because the question this page answers is
//   comparative ("what can a manager do that an employee can't"). The screenshot's
//   one-role-at-a-time view survives as the phone layout, where four columns cannot fit.
//
// The signed-in person's own column is washed and tagged "You" — the first question anyone
// asks a permissions table is "which one am I". On the phone the role picker simply opens
// on their role. Presentation only, as ever (ADR-0007): the API enforces every rule here.

interface AccessMatrixProps {
  principal: PrincipalResponse
}

export function AccessMatrix({ principal }: AccessMatrixProps) {
  const t = useTranslations()
  const [phoneRole, setPhoneRole] = useState<Role>(principal.role)

  return (
    <div className="flex flex-col gap-4.5">
      <div>
        <h1 className="text-heading-lg font-extrabold text-foreground">{t('access.heading')}</h1>
        <p className="mt-0.5 text-label text-muted-foreground">{t('access.subtitle')}</p>
      </div>

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
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ACCESS_GROUPS.map((group) => (
              <GroupRows key={group.key} group={group} viewerRole={principal.role} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone: one role at a time — a picker over grouped cards. Four scope-worded columns
          cannot share 390px, and one role is the question a phone user is asking anyway. */}
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
                  <LevelCell level={row.byRole[phoneRole]} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

function GroupRows({
  group,
  viewerRole,
}: {
  group: (typeof ACCESS_GROUPS)[number]
  viewerRole: Role
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
              <LevelCell level={row.byRole[role]} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

// One cell of the matrix. The word is the content and the mark supports it — colour is
// never the only carrier (WCAG 1.4.1, same rule the dashboard donut follows): full and
// scoped both print their scope in words, and the no-access dash carries screen-reader
// text of its own.
function LevelCell({ level }: { level: AccessLevel }) {
  const t = useTranslations()

  if (level.tier === 'none') {
    return (
      <span className="text-body text-muted-foreground/50">
        <span aria-hidden>—</span>
        <span className="sr-only">{t('access.levelNone')}</span>
      </span>
    )
  }

  const full = level.tier === 'full'
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon name="selected" size="sm" className={full ? 'text-success' : 'text-muted-foreground'} />
      <span
        className={cn(
          'text-caption',
          full ? 'font-semibold text-foreground' : 'text-muted-foreground',
        )}
      >
        {t(level.labelKey ?? 'access.levelYes')}
      </span>
    </span>
  )
}
