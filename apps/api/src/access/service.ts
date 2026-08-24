import {
  CAPABILITY_DEFAULTS,
  CAPABILITY_KEYS,
  type CapabilityKey,
  type CapabilityOverrides,
  type Role,
  capabilitiesFor,
  capabilityKeySchema,
  isCapabilityAllowed,
  roleSchema,
} from '@burgers/shared'
import { and, eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { roleCapabilities } from '../db/schema.js'

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
  matrix(): Promise<Array<{ capability: CapabilityKey; byRole: Record<Role, boolean> }>>
  // Returns false when the edit is refused: a super_admin row (the locked column), which
  // the route reports as forbidden without revealing table state.
  set(role: Role, key: CapabilityKey, allowed: boolean): Promise<boolean>
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
      return CAPABILITY_KEYS.map((capability) => ({
        capability,
        byRole: {
          super_admin: true as const,
          admin: isCapabilityAllowed('admin', capability, stored),
          manager: isCapabilityAllowed('manager', capability, stored),
          employee: isCapabilityAllowed('employee', capability, stored),
        },
      }))
    },

    async set(role, key, allowed) {
      if (role === 'super_admin') {
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
  }
}
