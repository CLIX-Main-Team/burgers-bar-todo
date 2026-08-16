# mobile — map

How the staff app reaches phones. The web app is wrapped by **Capacitor** into a native shell
per platform (`apps/web/android`, `apps/web/ios`, both committed, both generated); this folder
holds the guides for getting those shells into the two app stores.

The wrapper's own configuration and the build commands live with the code:
[`apps/web/capacitor.config.ts`](../../apps/web/capacitor.config.ts) and the `sync:android` /
`sync:ios` scripts in [`apps/web/package.json`](../../apps/web/package.json).

## The update model, which drives everything else

`capacitor.config.ts` sets `webDir: 'dist'` and **no** `server.url`, so each build ships a
frozen copy of the SPA inside the native app:

- **API, assistant and data changes** reach installed apps instantly, nothing to rebuild.
- **Anything visual** needs a rebuild and a reinstall, per platform.

That is the whole argument for publishing on the stores rather than continuing to hand out an
APK link: stores update phones by themselves, the link never does.

A second consequence: `VITE_API_BASE_URL` from
[`apps/web/.env.mobile`](../../apps/web/.env.mobile) is baked in at build time, and an installed
app keeps whatever URL it was built with. The client-owned API domain has to exist before any
store release, or every phone needs a reinstall the day it changes.

## Documents

- ios-publishing.md — publishing to the App Store as an **Unlisted App**: the client's
  organization Apple Developer account ($99/yr), the D-U-N-S prerequisite, App Review guidelines
  2.1 and 4.2, the Mac build and upload, and the unlisted request that follows submission.
- android-publishing.md — publishing to Google Play under the client's **organization** account
  ($25 once): why organization skips the 12-tester rule, the release AAB and signing key, the
  store listing assets, and the Data safety declaration.

Both guides open with a plain-language glossary and label every phase as the client's part or
ours. Both are blocked on the same thing: the client owning a domain and a work email on it.

## Status

Neither store account exists yet. What is already done in the repo is marked in each guide
(app icons, launch screens, `targetSdk 36`, permissions); what is still missing is marked too,
with the reason.
