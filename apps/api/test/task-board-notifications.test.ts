import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type TestHarness, createTestHarness } from './helpers/test-app.js'

// Push notifications for task assignment (#59, delivery side). Everything below the wire out to
// Firebase is the production path: a device registers through the real endpoint, a manager makes a
// real assignment through the real write endpoint, and the assertions read the capturing transport
// the harness injects — the same shape the invite tests use for the capturing mailer.
//
// What these cases pin is the part that is easy to get wrong and expensive to discover in
// production: exactly WHO gets rung. A phone that buzzes for every edit of a task somebody was
// already on is a phone staff turn notifications off on, and once they do, the notification that
// mattered never arrives either.

const SEED_EMAIL = 'admin@burgers.local'
const SEED_PASSWORD = 'seed-password-123'
const GOOD_PASSWORD = 'valid-password-123'

interface ProvisionedUser {
  userId: string
  token: string
}

describe('task board: push notification on assignment (#59)', () => {
  let harness: TestHarness

  let locationAId: string
  let admin: string
  let managerA: ProvisionedUser
  let empHebrew: ProvisionedUser
  let empEnglish: ProvisionedUser

  beforeAll(async () => {
    harness = await createTestHarness()
  })

  afterAll(async () => {
    await harness?.close()
  })

  const adminToken = async (): Promise<string> => {
    const login = await harness.app.inject({
      method: 'POST',
      url: '/auth/sign-in',
      payload: { email: SEED_EMAIL, password: SEED_PASSWORD },
    })
    expect(login.statusCode).toBe(200)
    return login.json<{ token: string }>().token
  }

  const latestInviteToken = (): string => {
    const mail = harness.mailer.sent.at(-1)
    const match = /token=([\w-]+)/.exec(mail?.text ?? '')
    return (match as RegExpExecArray)[1]
  }

  // The language is chosen at invite accept and is what the notification gets written in, so it is
  // a parameter here rather than the fixed 'en' the other board suites use.
  const provision = async (
    email: string,
    displayName: string,
    role: 'manager' | 'employee',
    locationId: string,
    preferredLanguage: 'he' | 'en' = 'en',
  ): Promise<ProvisionedUser> => {
    const invited = await harness.app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: `Bearer ${admin}` },
      payload: { email, displayName, role, locationId },
    })
    expect(invited.statusCode).toBe(201)
    const userId = invited.json<{ id: string }>().id
    const accepted = await harness.app.inject({
      method: 'POST',
      url: '/auth/accept',
      payload: { token: latestInviteToken(), password: GOOD_PASSWORD, preferredLanguage },
    })
    expect(accepted.statusCode).toBe(200)
    return { userId, token: accepted.json<{ token: string }>().token }
  }

  const registerDevice = async (token: string, deviceToken: string): Promise<void> => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/devices',
      headers: { authorization: `Bearer ${token}` },
      payload: { token: deviceToken, platform: 'android' },
    })
    expect(res.statusCode).toBe(200)
  }

  const createTask = (token: string, body: Record<string, unknown>) =>
    harness.app.inject({
      method: 'POST',
      url: '/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    })

  const updateTask = (token: string, taskId: string, body: Record<string, unknown>) =>
    harness.app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/update`,
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    })

  // Every device token the transport was asked to reach, across all messages of this case.
  const rungTokens = (): string[] =>
    harness.pushSender.sent.flatMap((message) => [...message.tokens])

  beforeEach(async () => {
    await harness.reset()
    await seedAdmin(harness.components.repo, harness.components.hasher, {
      email: SEED_EMAIL,
      password: SEED_PASSWORD,
    })
    admin = await adminToken()

    locationAId = (await harness.seedLocation({ name: 'Downtown' })).id
    managerA = await provision('mgr-a@burgers.local', 'Manager A', 'manager', locationAId)
    empHebrew = await provision('emp-he@burgers.local', 'Emp He', 'employee', locationAId, 'he')
    empEnglish = await provision('emp-en@burgers.local', 'Emp En', 'employee', locationAId, 'en')
  })

  it('rings a registered phone when a task is created for its owner', async () => {
    await registerDevice(empEnglish.token, 'device-en-1')

    const created = await createTask(managerA.token, {
      title: 'Prep the grill',
      description: null,
      priority: 'high',
      dueDate: null,
      assigneeIds: [empEnglish.userId],
    })
    expect(created.statusCode).toBe(201)
    const taskId = created.json<{ id: string }>().id

    expect(harness.pushSender.sent).toHaveLength(1)
    const [message] = harness.pushSender.sent
    expect(message.tokens).toEqual(['device-en-1'])
    // The task's own title is the body: it is the part that says what actually landed, and it is
    // left in whatever language it was written in.
    expect(message.body).toBe('Prep the grill')
    // The tap payload carries the task, so opening the notification opens the right thing.
    expect(message.data).toEqual({ type: 'task_assigned', taskId })
  })

  it('writes the notification in each recipient own language, one message per language', async () => {
    await registerDevice(empEnglish.token, 'device-en-1')
    await registerDevice(empHebrew.token, 'device-he-1')

    const created = await createTask(managerA.token, {
      title: 'Prep the grill',
      description: null,
      priority: 'normal',
      dueDate: null,
      assigneeIds: [empEnglish.userId, empHebrew.userId],
    })
    expect(created.statusCode).toBe(201)

    // Two messages, not two-per-device: everyone reading the same language shares one built
    // message, so a whole-branch assignment stays two sends however many phones are on it.
    expect(harness.pushSender.sent).toHaveLength(2)
    const english = harness.pushSender.sent.find((m) => m.tokens.includes('device-en-1'))
    const hebrew = harness.pushSender.sent.find((m) => m.tokens.includes('device-he-1'))
    expect(english?.title).toBe('New task')
    expect(hebrew?.title).toBe('משימה חדשה')
    // The body is the task title in both — never translated.
    expect(english?.body).toBe('Prep the grill')
    expect(hebrew?.body).toBe('Prep the grill')
  })

  it('rings only the people an edit newly added, never those already on the task', async () => {
    await registerDevice(empEnglish.token, 'device-en-1')
    await registerDevice(empHebrew.token, 'device-he-1')

    const created = await createTask(managerA.token, {
      title: 'Prep the grill',
      description: null,
      priority: 'normal',
      dueDate: null,
      assigneeIds: [empEnglish.userId],
    })
    expect(created.statusCode).toBe(201)
    const taskId = created.json<{ id: string }>().id
    harness.pushSender.clear()

    // The edit path replaces the whole assignee set on every save, so the naive reading of this
    // request is "notify both". Only the added one may be rung.
    const updated = await updateTask(managerA.token, taskId, {
      title: 'Prep the grill',
      description: null,
      priority: 'normal',
      dueDate: null,
      assigneeIds: [empEnglish.userId, empHebrew.userId],
    })
    expect(updated.statusCode).toBe(200)

    expect(rungTokens()).toEqual(['device-he-1'])
  })

  it('rings nobody when an edit leaves the assignee set alone', async () => {
    await registerDevice(empEnglish.token, 'device-en-1')

    const created = await createTask(managerA.token, {
      title: 'Prep the grill',
      description: null,
      priority: 'normal',
      dueDate: null,
      assigneeIds: [empEnglish.userId],
    })
    expect(created.statusCode).toBe(201)
    const taskId = created.json<{ id: string }>().id
    harness.pushSender.clear()

    const updated = await updateTask(managerA.token, taskId, {
      title: 'Prep the grill before open',
      description: 'Changed my mind about the wording',
      priority: 'high',
      dueDate: null,
      assigneeIds: [empEnglish.userId],
    })
    expect(updated.statusCode).toBe(200)

    expect(harness.pushSender.sent).toHaveLength(0)
  })

  it('does not ring the person making the assignment when they assign themselves', async () => {
    await registerDevice(managerA.token, 'device-mgr-1')
    await registerDevice(empEnglish.token, 'device-en-1')

    const created = await createTask(managerA.token, {
      title: 'Prep the grill',
      description: null,
      priority: 'normal',
      dueDate: null,
      assigneeIds: [managerA.userId, empEnglish.userId],
    })
    expect(created.statusCode).toBe(201)

    expect(rungTokens()).toEqual(['device-en-1'])
  })

  it('rings nothing for an assignee with no registered device', async () => {
    const created = await createTask(managerA.token, {
      title: 'Prep the grill',
      description: null,
      priority: 'normal',
      dueDate: null,
      assigneeIds: [empEnglish.userId],
    })
    expect(created.statusCode).toBe(201)

    expect(harness.pushSender.sent).toHaveLength(0)
  })

  it('stops ringing a device the moment it unregisters', async () => {
    await registerDevice(empEnglish.token, 'device-en-1')
    const removed = await harness.app.inject({
      method: 'POST',
      url: '/devices/unregister',
      headers: { authorization: `Bearer ${empEnglish.token}` },
      payload: { token: 'device-en-1' },
    })
    expect(removed.statusCode).toBe(200)

    const created = await createTask(managerA.token, {
      title: 'Prep the grill',
      description: null,
      priority: 'normal',
      dueDate: null,
      assigneeIds: [empEnglish.userId],
    })
    expect(created.statusCode).toBe(201)

    expect(harness.pushSender.sent).toHaveLength(0)
  })

  it('moves a device to its new owner when a phone changes hands', async () => {
    // The same physical phone: the token is unchanged, a different member of staff signs in on it.
    await registerDevice(empEnglish.token, 'shared-phone')
    await registerDevice(empHebrew.token, 'shared-phone')

    const created = await createTask(managerA.token, {
      title: 'Prep the grill',
      description: null,
      priority: 'normal',
      dueDate: null,
      assigneeIds: [empEnglish.userId, empHebrew.userId],
    })
    expect(created.statusCode).toBe(201)

    // One message, in the new owner's language — the previous owner no longer has the device, so
    // the phone must not ring for work assigned to them.
    expect(harness.pushSender.sent).toHaveLength(1)
    expect(harness.pushSender.sent[0].tokens).toEqual(['shared-phone'])
    expect(harness.pushSender.sent[0].title).toBe('משימה חדשה')
  })

  it('refuses to register a device without a valid session', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/devices',
      payload: { token: 'device-anon', platform: 'android' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('leaves a device registered when someone else asks to unregister it', async () => {
    await registerDevice(empEnglish.token, 'device-en-1')

    // Answers ok either way — a distinguishable refusal would turn this into a way to probe
    // whether a guessed token exists — but the row is untouched, which the assignment proves.
    const attempt = await harness.app.inject({
      method: 'POST',
      url: '/devices/unregister',
      headers: { authorization: `Bearer ${empHebrew.token}` },
      payload: { token: 'device-en-1' },
    })
    expect(attempt.statusCode).toBe(200)

    const created = await createTask(managerA.token, {
      title: 'Prep the grill',
      description: null,
      priority: 'normal',
      dueDate: null,
      assigneeIds: [empEnglish.userId],
    })
    expect(created.statusCode).toBe(201)
    expect(rungTokens()).toEqual(['device-en-1'])
  })
})
