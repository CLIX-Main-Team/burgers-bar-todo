import type { CapacitorConfig } from '@capacitor/cli'

// The native wrapper shell (mobile plan in ios-android-wrapper-notes.md): Capacitor
// serves the built SPA from `dist` inside a WebView. The appId is the permanent
// store identity for both platforms — it can never change after first publish.
//
// Android is committed under apps/web/android. **iOS is not, on purpose**: `cap add ios`
// runs CocoaPods, which is macOS-only, so the Xcode project has to be created on a Mac.
// Everything that does not need one is already here — the @capacitor/ios dependency, the
// `sync:ios` script, and the icon generator, which writes the 1024 app icon into the iOS
// asset catalogue as soon as that catalogue exists. On the Mac the whole sequence is:
//
//   npm ci
//   npm -w apps/web exec -- cap add ios
//   node assets/brand/generate-app-icons.mjs     # fills in the app icon
//   npm -w apps/web run sync:ios                 # builds with .env.mobile and copies it in
//   npm -w apps/web exec -- cap open ios         # then set the signing team and Run
//
// then commit the generated ios/ directory the way android/ is committed. No `ios` config
// block yet: every option there (backgroundColor, contentInset, scrollEnabled) is a
// judgement call that wants a Simulator to check, and guessing them here would be worse
// than the defaults. Note scrollEnabled in particular — switching it off is the usual
// recipe for killing iOS rubber-banding, but the pre-auth frame can legitimately overflow
// a short phone, and it would have nothing left to scroll with.
const config: CapacitorConfig = {
  appId: 'com.burgersbar.staff',
  appName: "Burger's Bar",
  webDir: 'dist',
}

export default config
