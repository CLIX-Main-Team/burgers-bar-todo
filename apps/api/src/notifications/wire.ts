import type { Db } from '../db/client.js'
import type { PushSender } from './push-sender.js'
import { type PushDeviceRepository, createPushDeviceRepository } from './repository.js'
import { type TaskNotifier, type TaskNotifierOptions, createTaskNotifier } from './task-notifier.js'

// The notifications composition root (#59 delivery side), mirroring auth/wire.ts and
// task-board/wire.ts: build the device repository and the task notifier over an injected db and an
// injected transport, and hand them back for the server and the integration harness to register.
//
// The transport is a parameter rather than something built here, and that is the whole point: the
// running server passes the real FCM sender when Firebase credentials are configured and a no-op
// one when they are not, while the harness passes a capturing fake. Every other line of the feature
// is identical in all three.
export interface NotificationComponents {
  repository: PushDeviceRepository
  notifier: TaskNotifier
}

export function createNotificationComponents(
  db: Db,
  sender: PushSender,
  options: TaskNotifierOptions = {},
): NotificationComponents {
  const repository = createPushDeviceRepository(db)
  const notifier = createTaskNotifier(repository, sender, options)
  return { repository, notifier }
}
