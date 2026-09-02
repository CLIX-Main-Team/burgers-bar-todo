import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { users } from '../db/schema.js'
import type { PushSender } from './push-sender.js'
import type { PushDeviceRepository } from './repository.js'

// Operational alerts — the channel infrastructure problems ring a human on (first user: the
// credit guard). There is no email sender in production (SMTP never left the free-tier block), but
// push already works, so an ops alert is a push to the phones of the people who can act on it: the
// chain-wide owner and admin accounts. Branch staff never ring for a billing problem. Bilingual by
// the same rule as task pushes (ADR-0005): the server composes both languages because the phone is
// asleep — each recipient gets the copy in the language their account reads.

export interface OpsAlertCopy {
  he: string
  en: string
}

export interface OpsNotifier {
  // Never rejects: an unreachable phone is not a reason for the caller's poll to fail.
  alertAdmins(copy: OpsAlertCopy): Promise<void>
}

const ALERT_TITLE: OpsAlertCopy = {
  he: 'התראת מערכת',
  en: 'System alert',
}

// The roles whose phones ring: chain-wide accountability, not branch scope. super_admin is the
// owner's role; admin is kept alongside it while the production accounts still hold admin.
const OPS_ROLES = ['super_admin', 'admin'] as const

export function createOpsNotifier(
  db: Db,
  repository: PushDeviceRepository,
  sender: PushSender,
  onError: (message: string) => void = (message) => console.error(message),
): OpsNotifier {
  return {
    alertAdmins: async (copy) => {
      try {
        const adminRows = await db
          .select({ id: users.id })
          .from(users)
          .where(and(inArray(users.role, [...OPS_ROLES]), eq(users.status, 'active')))
        if (adminRows.length === 0) return
        const recipients = await repository.recipientsFor(adminRows.map((row) => row.id))
        if (recipients.length === 0) return

        // One message per language, mirroring the task notifier: every token in a message shares
        // its title and body.
        for (const language of ['he', 'en'] as const) {
          const tokens = recipients
            .filter((recipient) => recipient.language === language)
            .map((recipient) => recipient.token)
          if (tokens.length === 0) continue
          const delivery = await sender.send({
            tokens,
            title: ALERT_TITLE[language],
            body: copy[language],
          })
          if (delivery.staleTokens.length > 0) {
            await repository.forget(delivery.staleTokens)
          }
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'unknown error'
        onError(`ops alert failed: ${reason}`)
      }
    },
  }
}
