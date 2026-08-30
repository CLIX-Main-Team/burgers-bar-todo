import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

// Android's back gesture, the app's half. Everything here is a no-op off a native shell —
// `Capacitor.isNativePlatform()` is false in a browser and under the tests — so the SPA and the
// e2e suite never touch a plugin, the same contract push.ts keeps.
//
// Why this has to exist at all. An app targeting Android 16 (API 36) no longer receives
// `onBackPressed` or `KEYCODE_BACK`: predictive back is on by default and the only supported way
// to intercept the gesture is AndroidX's OnBackPressedDispatcher. Capacitor 8.5's own bridge
// registers nothing there — grep the runtime for OnBackPressed and you get no hits — so with no
// plugin listening, the dispatcher falls through to finishing the activity. The result on a phone
// is that back closes the whole app from any screen, three levels into a project as readily as
// from the board. @capacitor/app is the piece that registers the callback, which is why it is a
// dependency now rather than a nicety.
//
// The plugin hands us the WebView's own `canGoBack`, which counts the router's pushState entries
// because the SPA is loaded as a single document. Every guard and the sign-in redirect navigate
// with `replace`, so that history holds real screens only — there is no login entry to reverse
// into and no redirect to bounce off.

// A back press has to close what is on top before it moves the page underneath, or "cancel this
// dialog" throws you off the screen you opened it from. Rather than a registry every overlay has
// to remember to join, this replays the key those overlays already answer: Dialog, AlertDialog,
// Sheet, Select, DropdownMenu, the account menu and the date picker all close on Escape and all
// call `preventDefault()` when they do, which is the signal that somebody took it.
//
// Dispatching from the focused element rather than at the document is what makes the replay
// faithful. Each of those overlays traps focus inside itself, and the event then travels exactly
// the path a real key press would — up through React's listeners, including the ones React binds
// on a portal container, to the document handlers underneath. Anything Escape cannot close, back
// cannot either, and the two stay wrong together instead of separately.
function dismissTopLayer(): boolean {
  const focused = document.activeElement ?? document.body
  const press = new KeyboardEvent('keydown', {
    key: 'Escape',
    code: 'Escape',
    bubbles: true,
    cancelable: true,
  })
  focused.dispatchEvent(press)
  return press.defaultPrevented
}

// Attached once per process, from main.tsx, before anyone has signed in: back is a system gesture
// and it has to answer on the login screen too.
export async function registerBackButton(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return

  try {
    await App.addListener('backButton', ({ canGoBack }) => {
      if (dismissTopLayer()) return
      if (canGoBack) {
        // Not the router's own navigate: popstate is what BrowserRouter listens to, so going
        // through the History API keeps the WebView's back-forward list and the router in step.
        window.history.back()
        return
      }
      // The first screen of the session. Leaving is what back means here, and finishing the
      // activity is what every other Android app does at this point.
      App.exitApp()
    })
  } catch (error) {
    // A shell built before this plugin existed still runs; it just keeps the old behaviour.
    console.warn('back button: could not attach the handler', error)
  }
}
