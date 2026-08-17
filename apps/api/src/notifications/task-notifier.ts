import type { PreferredLanguage } from '@burgers/shared'
import type { PushSender } from './push-sender.js'
import type { PushDeviceRepository } from './repository.js'

// The one thing the task board can announce to a phone (#59): somebody was just put on a task.
// This is the seam the write service depends on, and it is deliberately named for the event rather
// than the transport — the write service knows who was newly assigned, and nothing else about
// notifications: not tokens, not languages, not Firebase.
//
// Why only assignment. A push is an interruption, and the one event that genuinely needs to reach
// someone who is not looking at the app is work landing on them. Status moves, edits and reorders
// all reach an open board over the live channel already, and pushing them would train staff to
// ignore the notification that matters.

export interface TaskAssignedNotice {
  taskId: string
  title: string
  // The people this very write newly put on the task — never the whole assignee set. An edit that
  // changes a due date leaves this empty, so an unrelated edit re-notifies nobody.
  userIds: readonly string[]
}

export interface TaskNotifier {
  // Never rejects. A phone that cannot be reached is not a reason for the write that triggered it
  // to fail, and the caller awaits this on the request path, so every failure is reported and
  // swallowed here.
  taskAssigned(notice: TaskAssignedNotice): Promise<void>
}

// The notification copy, in the two interface languages (ADR-0005). It lives on the server because
// the phone is asleep when this is written — there is no running app to translate anything, and the
// text FCM carries is the text that appears on the lock screen. The task's own title is the body:
// it is the part that says what actually landed, and it is already in whatever language it was
// written in, which no translation of ours should touch.
const ASSIGNED_TITLE: Record<PreferredLanguage, string> = {
  en: 'New task',
  he: 'משימה חדשה',
}

export interface TaskNotifierOptions {
  // Where a notification failure goes. Injected rather than console-logged directly so the server
  // owns the sink, matching the assistant indexer's onIndexError.
  onNotifyError?: (message: string) => void
}

export function createTaskNotifier(
  repository: PushDeviceRepository,
  sender: PushSender,
  options: TaskNotifierOptions = {},
): TaskNotifier {
  const report = options.onNotifyError ?? ((message: string) => console.error(message))

  return {
    taskAssigned: async ({ taskId, title, userIds }) => {
      if (userIds.length === 0) return
      try {
        const recipients = await repository.recipientsFor(userIds)
        if (recipients.length === 0) return

        // One message per language, not per device: everyone reading Hebrew gets the same built
        // message, so a five-person assignment is two sends rather than five.
        const byLanguage = new Map<PreferredLanguage, string[]>()
        for (const recipient of recipients) {
          const tokens = byLanguage.get(recipient.language)
          if (tokens) tokens.push(recipient.token)
          else byLanguage.set(recipient.language, [recipient.token])
        }

        const stale: string[] = []
        for (const [language, tokens] of byLanguage) {
          const delivery = await sender.send({
            tokens,
            title: ASSIGNED_TITLE[language],
            body: title,
            // What the app reads when the notification is tapped, so opening it opens the board on
            // the task rather than wherever the app was last left.
            data: { type: 'task_assigned', taskId },
          })
          stale.push(...delivery.staleTokens)
        }
        // Devices the transport says are gone (uninstalled, or the token rotated). Pruning them
        // here is what keeps the table from filling with phones that will never ring again.
        await repository.forget(stale)
      } catch (error) {
        report(`push: task-assigned notification failed for ${taskId} — ${String(error)}`)
      }
    },
  }
}
