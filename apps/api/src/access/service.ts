import {
  CAPABILITY_DEFAULTS,
  CAPABILITY_KEYS,
  type CapabilityKey,
  type CapabilityOverrides,
  type Role,
  type ScopeChoice,
  VIEW_SCOPE_CHOICES,
  VIEW_SCOPE_DEFAULTS,
  VIEW_SCOPE_KEYS,
  type ViewScopeKey,
  type ViewScopeOverrides,
  type ViewScopes,
  capabilitiesFor,
  capabilityKeySchema,
  isCapabilityAllowed,
  isCapabilityLocked,
  roleSchema,
  scopeChoiceSchema,
  viewScopeFor,
  viewScopeKeySchema,
  viewScopesFor,
} from '@burgers/shared'
import { and, eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { roleCapabilities, roleViewScopes } from '../db/schema.js'

// The one reader/writer of role_capabilities (owner ask 2026-08-24). Effective answers come
// from the shared catalog with the stored overrides layered on, computed fresh per request:
// the table is a handful of rows behind a primary key, so a read costs less than any cache
// invalidation story, and a flipped switch is live on the very next request (ADR-0007's
// fresh-principal principle, extended to what the principal may do).
//
// The table stores only DEVIATIONS. Setting a switch back to its default deletes the row
// rather than storing an equal override, so the table reads as "what the owner changed".

export interface AccessService {
  overrides(): Promise<CapabilityOverrides>
  isAllowed(role: Role, key: CapabilityKey): Promise<boolean>
  capabilitiesFor(role: Role): Promise<CapabilityKey[]>
  matrix(): Promise<
    Array<{
      capability: CapabilityKey
      byRole: Record<Role, boolean>
      raw: Record<Exclude<Role, 'super_admin'>, boolean>
    }>
  >
  // Returns false when the edit is refused: a super_admin row (the locked column) or a
  // locked key, which the route reports as forbidden without revealing table state.
  set(role: Role, key: CapabilityKey, allowed: boolean): Promise<boolean>
  // How far each role sees. viewScopes() is the per-request read the principal carries.
  viewScopes(role: Role): Promise<ViewScopes>
  scopeMatrix(): Promise<Array<{ key: ViewScopeKey; byRole: Record<Role, ScopeChoice> }>>
  setScope(role: Role, key: ViewScopeKey, choice: ScopeChoice): Promise<boolean>
}

export function createAccessService(db: Db): AccessService {
  async function overrides(): Promise<CapabilityOverrides> {
    const rows = await db.select().from(roleCapabilities)
    const result: CapabilityOverrides = {}
    for (const row of rows) {
      // Rows are validated on write, but the columns are text — a row surviving from a
      // removed catalog key or role must not crash every request, so unparseable rows are
      // simply inert.
      const key = capabilityKeySchema.safeParse(row.capability)
      const role = roleSchema.safeParse(row.role)
      if (!key.success || !role.success) {
        continue
      }
      const forKey = result[key.data] ?? {}
      forKey[role.data] = row.allowed
      result[key.data] = forKey
    }
    return result
  }

  // The horizons twin of overrides(): the owner's stored deviations, unparseable rows inert.
  async function scopeOverrides(): Promise<ViewScopeOverrides> {
    const rows = await db.select().from(roleViewScopes)
    const result: ViewScopeOverrides = {}
    for (const row of rows) {
      const key = viewScopeKeySchema.safeParse(row.viewKey)
      const role = roleSchema.safeParse(row.role)
      const choice = scopeChoiceSchema.safeParse(row.choice)
      if (!key.success || !role.success || !choice.success) {
        continue
      }
      const forKey = result[key.data] ?? {}
      forKey[role.data] = choice.data
      result[key.data] = forKey
    }
    return result
  }

  return {
    overrides,

    async isAllowed(role, key) {
      return isCapabilityAllowed(role, key, await overrides())
    },

    async capabilitiesFor(role) {
      return capabilitiesFor(role, await overrides())
    },

    async matrix() {
      const stored = await overrides()
      // `raw` is the switch as the owner left it, before the page cascade folds it to off.
      // The page needs it to grey a control out without losing where its switch was set, so
      // turning the page back on restores the row rather than resetting it.
      const raw = (role: Exclude<Role, 'super_admin'>, key: CapabilityKey): boolean =>
        stored[key]?.[role] ?? CAPABILITY_DEFAULTS[key][role]
      return CAPABILITY_KEYS.map((capability) => ({
        capability,
        byRole: {
          super_admin: true as const,
          admin: isCapabilityAllowed('admin', capability, stored),
          manager: isCapabilityAllowed('manager', capability, stored),
          employee: isCapabilityAllowed('employee', capability, stored),
        },
        raw: {
          admin: raw('admin', capability),
          manager: raw('manager', capability),
          employee: raw('employee', capability),
        },
      }))
    },

    async set(role, key, allowed) {
      if (role === 'super_admin' || isCapabilityLocked(key)) {
        return false
      }
      if (allowed === CAPABILITY_DEFAULTS[key][role]) {
        // Back to the default: remove the deviation instead of storing an equal row.
        await db
          .delete(roleCapabilities)
          .where(and(eq(roleCapabilities.role, role), eq(roleCapabilities.capability, key)))
        return true
      }
      await db
        .insert(roleCapabilities)
        .values({ role, capability: key, allowed, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [roleCapabilities.role, roleCapabilities.capability],
          set: { allowed, updatedAt: new Date() },
        })
      return true
    },

    async viewScopes(role) {
      return viewScopesFor(role, await scopeOverrides())
    },

    async scopeMatrix() {
      const stored = await scopeOverrides()
      return VIEW_SCOPE_KEYS.map((key) => ({
        key,
        byRole: {
          super_admin: 'chain' as const,
          admin: viewScopeFor('admin', key, stored),
          manager: viewScopeFor('manager', key, stored),
          employee: viewScopeFor('employee', key, stored),
        },
      }))
    },

    async setScope(role, key, choice) {
      // The owner's own horizon is the chain and is not up for editing, and a choice this
      // view's predicate cannot honour is refused rather than stored and silently ignored.
      if (role === 'super_admin' || !VIEW_SCOPE_CHOICES[key].includes(choice)) {
        return false
      }
      if (choice === VIEW_SCOPE_DEFAULTS[key][role]) {
        await db
          .delete(roleViewScopes)
          .where(and(eq(roleViewScopes.role, role), eq(roleViewScopes.viewKey, key)))
        return true
      }
      await db
        .insert(roleViewScopes)
        .values({ role, viewKey: key, choice, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [roleViewScopes.role, roleViewScopes.viewKey],
          set: { choice, updatedAt: new Date() },
        })
      return true
    },
  }
}
