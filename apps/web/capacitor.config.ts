import type { CapacitorConfig } from '@capacitor/cli'

// The native wrapper shell (mobile plan in ios-android-wrapper-notes.md): Capacitor
// serves the built SPA from `dist` inside a WebView. The appId is the permanent
// store identity for both platforms — it can never change after first publish.
const config: CapacitorConfig = {
  appId: 'com.burgersbar.staff',
  appName: "Burger's Bar",
  webDir: 'dist',
}

export default config
