import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb } from '../src/db/client.js'
import { locations, users } from '../src/db/schema.js'
import { createOpsNotifier } from '../src/notifications/ops-notifier.js'
import { createCapturingPushSender } from '../src/notifications/push-sender.js'
import { createPushDeviceRepository } from '../src/notifications/repository.js'
import { type TestDb, startTestDb } from './helpers/test-db.js'

// Operational alerts (the credit guard's channel): a push to the phones of the people who can act
// on an infrastructure problem — the chain-wide owner and admin accounts — in each recipient's own
// language. Scoping is the point of this suite: a branch employee's phone must never ring for a
// billing problem, and a deactivated admin's must not either.

describe('ops notifier — who rings when infrastructure needs a human', () => {
  let testDb: TestDb
  let db: ReturnType<typeof createDb>['db']
  let pool: ReturnType<typeof createDb>['pool']

  beforeAll(async () => {
    testDb = await startTestDb()
    const created = createDb(testDb.connectionString)
    db = created.db
    pool = created.pool
  }, 120_000)

  afterAll(async () => {
    await pool.end()
    await testDb.stop()
  })

  beforeEach(async () => {
    await db.delete(users)
    await db.delete(locations)
  })

  // The branch trio must hold a real Location and every chain-wide role must be branch-less
  // (users_role_location_check, 0033) — so branch-role seeds get a branch of their own.
  const seedUser = async (
    email: string,
    role: 'super_admin' | 'admin' | 'employee',
    over: { status?: 'active' | 'deactivated'; language?: 'he' | 'en' } = {},
  ): Promise<string> => {
    const branchBound = role === 'admin' || role === 'employee'
    let locationId: string | null = null
    if (branchBound) {
      const [branch] = await db
        .insert(locations)
        .values({ name: `branch of ${email}` })
        .returning({ id: locations.id })
      if (!branch) throw new Error('seed location returned no row')
      locationId = branch.id
    }
    const [row] = await db
      .insert(users)
      .values({
        email,
        displayName: email,
        role,
        locationId,
        status: over.status ?? 'active',
        preferredLanguage: over.language ?? 'he',
      })
      .returning({ id: users.id })
    if (!row) throw new Error('seed insert returned no row')
    return row.id
  }

  it('rings active chain admins in their own language, and nobody else', async () => {
    const owner = await seedUser('owner@x.il', 'super_admin', { language: 'he' })
    const admin = await seedUser('admin@x.il', 'admin', { language: 'en' })
    await seedUser('worker@x.il', 'employee')
    await seedUser('gone@x.il', 'admin', { status: 'deactivated' })

    const repo = createPushDeviceRepository(db)
    await repo.register({ token: 'owner-phone', userId: owner, platform: 'android' })
    await repo.register({ token: 'admin-phone', userId: admin, platform: 'android' })

    const sender = createCapturingPushSender()
    const notifier = createOpsNotifier(db, repo, sender)
    await notifier.alertAdmins({ he: 'יתרה נמוכה', en: 'Balance low' })

    const byToken = new Map(sender.sent.flatMap((m) => m.tokens.map((t) => [t, m.body])))
    expect(byToken.get('owner-phone')).toBe('יתרה נמוכה')
    expect(byToken.get('admin-phone')).toBe('Balance low')
    expect([...byToken.keys()].sort()).toEqual(['admin-phone', 'owner-phone'])
  })

  it('sends nothing when no chain admin has a registered device', async () => {
    await seedUser('owner@x.il', 'super_admin')
    const repo = createPushDeviceRepository(db)
    const sender = createCapturingPushSender()
    const notifier = createOpsNotifier(db, repo, sender)
    await notifier.alertAdmins({ he: 'בדיקה', en: 'check' })
    expect(sender.sent).toHaveLength(0)
  })

  it('reports a transport failure and never throws', async () => {
    const owner = await seedUser('owner@x.il', 'super_admin')
    const repo = createPushDeviceRepository(db)
    await repo.register({ token: 'owner-phone', userId: owner, platform: 'android' })

    const errors: string[] = []
    const failing = {
      send: async () => {
        throw new Error('transport down')
      },
    }
    const notifier = createOpsNotifier(db, repo, failing, (message) => errors.push(message))
    await expect(notifier.alertAdmins({ he: 'בדיקה', en: 'check' })).resolves.toBeUndefined()
    expect(errors).toHaveLength(1)
  })
})
