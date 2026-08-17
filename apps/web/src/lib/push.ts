import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { devicesApi } from './api.js'
import { queryClient } from './query-client.js'

// Push notifications, the app's half (#59). Everything here is a no-op unless the code is running
// inside one of the two native wrapper shells: `Capacitor.isNativePlatform()` is false in a browser
// and in the test environment, so the SPA, the e2e suite and the unit tests never touch a plugin.
// That guard is why this module can be imported unconditionally from the session provider.
//
// The shape of the thing: the phone asks its platform's push service for a registration token, the
// service hands one back asynchronously through the `registration` listener, and we send it to our
// API. A token is not a secret of ours — it only authorises us to reach that one device, and only
// while the app stays installed — but it does rotate, which is why registration runs on every
// authenticated app start rather than only at sign-in.

// The Android notification channel every task notification is posted to. Android drops a
// notification naming a channel that does not exist, silently, so this string has to match the
// `channelId` the API puts in the FCM envelope (apps/api/src/notifications/fcm-push-sender.ts).
const TASKS_CHANNEL_ID = 'tasks'

// The registration token this device last gave us, kept so sign-out can tell the API which row to
// drop. It outlives a process restart, so a phone that is closed and reopened before signing out
// still releases itself properly. Mirrors token-storage.ts: one key, every access guarded, because
// a WebView with storage disabled must not take the app down.
const PUSH_TOKEN_KEY = 'burgers.push.token'

function readPushToken(): string | null {
  try {
    return window.localStorage.getItem(PUSH_TOKEN_KEY)
  } catch {
    return null
  }
}

function writePushToken(token: string): void {
  try {
    window.localStorage.setItem(PUSH_TOKEN_KEY, token)
  } catch {
    // A device that cannot persist the token still receives notifications; it just cannot
    // release itself on sign-out, which the server's stale-token pruning eventually settles.
  }
}

function clearPushToken(): void {
  try {
    window.localStorage.removeItem(PUSH_TOKEN_KEY)
  } catch {
    // ignore — see writePushToken
  }
}

// Listeners are attached once per process, never per sign-in: attaching them again on a second
// registration would deliver every notification twice over.
let listenersAttached = false

async function attachListeners(): Promise<void> {
  if (listenersAttached) return
  listenersAttached = true

  // The platform's answer to register(), arriving asynchronously and again whenever the token
  // rotates. Sending it on every arrival is what keeps the server's copy live.
  await PushNotifications.addListener('registration', (token) => {
    writePushToken(token.value)
    const platform = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android'
    devicesApi.register({ token: token.value, platform }).catch(() => {
      // Offline, or the session ended between register() and this callback. The next
      // authenticated start registers again, so there is nothing to retry here.
    })
  })

  await PushNotifications.addListener('registrationError', (error) => {
    // Almost always a missing or mismatched google-services.json / APNs entitlement. Worth seeing
    // in a device log; never worth interrupting someone's shift over.
    console.warn('push: registration failed', error)
  })

  // Tapping a notification brings the app to the front, on whatever screen it was last left. The
  // board behind it may be stale by minutes, so drop the cached server state and let it refetch —
  // the person tapped because they want to see the thing that just landed.
  //
  // Opening the specific task rather than the board is the obvious next refinement; it needs a
  // router seam this module deliberately does not have yet.
  await PushNotifications.addListener('pushNotificationActionPerformed', () => {
    queryClient.invalidateQueries()
  })

  // A notification that arrives while the app is open and in the foreground. Android and iOS both
  // suppress the banner in that case, so the only useful response is to refresh what is on screen.
  await PushNotifications.addListener('pushNotificationReceived', () => {
    queryClient.invalidateQueries()
  })
}

// Claim this phone for the signed-in user. Safe to call repeatedly — it is called on every
// authenticated app start — and safe to call in a browser, where it returns immediately.
export async function registerPushDevice(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return

  try {
    await attachListeners()

    // Android 13+ and every iOS version gate notifications behind a permission prompt. Asking only
    // when the state is still `prompt` means a person who said no once is not asked again on every
    // launch; they can still turn it on in the OS settings, and the next start picks that up.
    let { receive } = await PushNotifications.checkPermissions()
    if (receive === 'prompt' || receive === 'prompt-with-rationale') {
      receive = (await PushNotifications.requestPermissions()).receive
    }
    if (receive !== 'granted') return

    // Android only — the channel is what carries the importance, the sound and the user's own
    // per-category toggle. iOS has no equivalent and the call is unimplemented there.
    if (Capacitor.getPlatform() === 'android') {
      await PushNotifications.createChannel({
        id: TASKS_CHANNEL_ID,
        name: 'Tasks',
        description: 'New tasks assigned to you',
        // 4 = high: shows a heads-up banner and makes a sound. Work landing on someone mid-shift
        // is worth the interruption; it is also the only thing this app ever sends.
        importance: 4,
        visibility: 1,
        vibration: true,
      })
    }

    await PushNotifications.register()
  } catch (error) {
    // Push is an enhancement, never a gate on using the app. Anything that goes wrong here — a
    // missing Firebase config on a build that predates it, a plugin unavailable — leaves the app
    // working exactly as it does today.
    console.warn('push: could not register this device', error)
  }
}

// Release this phone on sign-out, so it stops ringing for the person who just left it. Best-effort
// by the same contract as the logout call it sits beside: a failure here must never keep somebody
// signed in.
export async function forgetPushDevice(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  const token = readPushToken()
  if (!token) return
  try {
    await devicesApi.unregister({ token })
  } catch {
    // ignore — the server prunes a token the transport later reports as dead anyway
  }
  clearPushToken()
}
