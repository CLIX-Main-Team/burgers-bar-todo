import { JWT } from 'google-auth-library'
import type { PushDelivery, PushMessage, PushSender } from './push-sender.js'

// The real Firebase Cloud Messaging adapter behind the PushSender port (#59 delivery side). Thin by
// design — service-account auth plus one REST call per device, no business logic — the same posture
// createGoogleDriveClient and createHttpLlmClient take: a fetch-backed implementation of a
// transport-agnostic port, verified once against the live service and then left alone.
//
// Why FCM for both platforms. Only Apple (APNs) and Google (FCM) can wake a phone; there is no
// third option and no way to reach a device directly. FCM will forward to APNs on our behalf once
// an APNs key is uploaded to the Firebase project, so one credential and one code path serve both
// shells instead of two. That decision costs nothing — FCM is free at any volume this app will see.
//
// Two things live here and nowhere else:
//   - Auth: a service-account JWT client (google-auth-library, already a dependency for Drive)
//     minted for the messaging scope, whose access token is attached to every request.
//   - The envelope: FCM's HTTP v1 body is nested and per-platform, so the Android channel id and
//     the APNs aps block are built here from the port's flat message. Callers never see either.

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.cloud-platform'
const FCM_API = 'https://fcm.googleapis.com/v1'

// The Android notification channel every message is posted to. It must match the channel the app
// creates at registration (apps/web/src/lib/push.ts) — Android drops a notification naming a
// channel that does not exist, silently, with nothing in the response to say so.
const ANDROID_CHANNEL_ID = 'tasks'

// FCM's own words for "this device is gone": the app was uninstalled, or the token rotated and the
// old one died with it. Both mean the row should go. Anything else — a network blip, a quota, a
// malformed request of ours — is a transient or a bug, and must never delete a live device.
const UNREGISTERED_ERRORS = new Set(['UNREGISTERED', 'INVALID_ARGUMENT'])

// The service-account credentials the JWT client authenticates with. Structurally the parsed
// ServiceAccountKey env.ts produces, kept as its own type so this adapter never imports the env —
// the same separation the Drive adapter draws.
export interface FcmServiceAccount {
  clientEmail: string
  privateKey: string
}

export interface FcmPushSenderConfig {
  serviceAccount: FcmServiceAccount
  // The Firebase project the messages are sent through — the `project_id` of the same
  // service-account key, named separately so a misconfigured pair fails loudly rather than sending
  // into someone else's project.
  projectId: string
  // Where a send failure goes. Injected rather than console-logged directly so the server decides
  // the sink, matching the assistant indexer's onIndexError.
  onSendError?: (message: string) => void
}

// What FCM answers with on a rejected send. Only the status code is contractual; the nested
// error status is best-effort, so a missing one is read as "not a stale token".
interface FcmErrorBody {
  error?: {
    status?: string
    details?: { errorCode?: string }[]
  }
}

export function createFcmPushSender(config: FcmPushSenderConfig): PushSender {
  const auth = new JWT({
    email: config.serviceAccount.clientEmail,
    key: config.serviceAccount.privateKey,
    scopes: [FCM_SCOPE],
  })
  const report = config.onSendError ?? ((message: string) => console.error(message))

  // FCM v1 addresses exactly one device per request — the batch endpoint the Firebase Admin SDK
  // exposes is a client-side loop over this same call, so looping here costs nothing extra and
  // keeps the adapter to plain fetch, with no vendor SDK on the data plane.
  const sendOne = async (
    token: string,
    message: PushMessage,
  ): Promise<'ok' | 'stale' | 'failed'> => {
    const { token: accessToken } = await auth.getAccessToken()
    if (!accessToken) {
      throw new Error('push: failed to obtain a service-account access token')
    }

    const res = await fetch(`${FCM_API}/projects/${config.projectId}/messages:send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: message.title, body: message.body },
          ...(message.data ? { data: message.data } : {}),
          android: {
            // A task landing on someone is worth waking the screen for; without high priority
            // Android may hold it until the device next comes out of doze.
            priority: 'high',
            notification: { channelId: ANDROID_CHANNEL_ID },
          },
          apns: {
            payload: { aps: { sound: 'default' } },
          },
        },
      }),
    })

    if (res.ok) return 'ok'

    const body = (await res.json().catch(() => ({}))) as FcmErrorBody
    const status = body.error?.status ?? body.error?.details?.[0]?.errorCode ?? ''
    if (res.status === 404 || UNREGISTERED_ERRORS.has(status)) {
      return 'stale'
    }
    report(`push: FCM refused a send (${res.status} ${status || 'unknown'})`)
    return 'failed'
  }

  return {
    send: async (message): Promise<PushDelivery> => {
      const staleTokens: string[] = []
      // Settled, not all: one dead device must not cancel the notification to the others, and a
      // thrown auth error must not escape into the write that triggered this (the port's contract
      // is that a delivery failure is never the caller's problem).
      const outcomes = await Promise.allSettled(
        message.tokens.map(async (token) => ({ token, outcome: await sendOne(token, message) })),
      )
      for (const result of outcomes) {
        if (result.status === 'rejected') {
          report(`push: send failed — ${String(result.reason)}`)
          continue
        }
        if (result.value.outcome === 'stale') {
          staleTokens.push(result.value.token)
        }
      }
      return { staleTokens }
    },
  }
}
