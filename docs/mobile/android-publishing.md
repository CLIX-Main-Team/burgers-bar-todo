# Publishing the Burger's Bar app on Google Play

Written 2026-08-16. Companion to [ios-publishing.md](./ios-publishing.md). Every fact here was checked
against Google's own help pages. All links are at the bottom.

## Words used in this guide, in plain language

| Word | What it means |
|---|---|
| **Play Console** | Google's website where developers manage and publish their apps |
| **D-U-N-S number** | A free 9-digit ID that proves a company really exists. Both Apple and Google ask for it. One number works for both. |
| **AAB (App Bundle)** | The file format Google Play accepts. Like an APK, but Play generates the final APK from it for each phone. We upload the AAB, users still install a normal app. |
| **Signing / keystore** | Every Android app must be stamped with a digital signature so phones know updates come from the same author. The keystore is the file holding that stamp. |
| **Play App Signing** | Google keeps the real signature key for us. We only keep a smaller "upload key". If we lose ours, Google can reset it. Nothing is ever unrecoverable. |
| **Data safety form** | A questionnaire where we tell Google what user data the app collects. Shown to users on the store page. Mandatory. |
| **versionCode** | A number that goes up by 1 with every upload. Play uses it to know which build is newer. |

## Where we are right now

The Android app works. People install it today from our GitHub link as an APK.

That APK link has one big problem: **it never updates itself**. Every design change means
asking 44 branches to re-download. Publishing on Google Play fixes that, phones update
automatically like any normal app.

To get on Play we are missing three things:

1. **The account.** It must belong to the client, and it is blocked on the same missing
   company email and domain as the Apple account.
2. **A release build.** Play does not accept the debug APK we hand out today. Different
   file format, different signing. Details in Phase 3.
3. **The store page.** Icon, screenshots, descriptions, privacy declarations.

Three platform requirements are already met. All three were verified against a real release
build on 2026-08-30, not read off a checklist:

- **Target API 36.** Google requires it of new apps from 31 August 2026. `variables.gradle`
  sets `targetSdkVersion = 36`, and the merged release manifest confirms it.
- **16 KB page sizes.** Since November 2025 Play blocks a release whose native libraries are
  not 16 KB aligned. The bundle carries exactly one native library, `libdatastore_shared_counter.so`
  (pulled in by androidx/Firebase) in four ABIs; every `PT_LOAD` segment in all four reports
  `p_align = 16384`. Nothing to do, but re-check it if a plugin with native code is ever added.
- **Edge-to-edge.** An app targeting Android 16 cannot opt out — `windowOptOutEdgeToEdgeEnforcement`
  is deprecated and disabled — so the WebView is drawn behind the status and navigation bars.
  The layout pays for that as of 2026-08-30 (see the safe-area tokens in `apps/web/src/index.css`).

One behaviour changed under us and is **not** handled: an app targeting API 36 no longer gets
`onBackPressed` or `KEYCODE_BACK`, because predictive back is on by default. Capacitor 8.5's
Android runtime implements no back navigation of its own (nothing in `@capacitor/android`
touches it) and we do not install `@capacitor/app`, so the system back gesture finishes the
activity — it closes the app from any screen instead of stepping back through the SPA. That
was true before Android 16 too; 16 just removes the hook a fix would once have used. Closing
it means adding `@capacitor/app` and wiring its `backButton` event to the router, and it wants
a real device to judge. Not a store blocker on either platform.
https://developer.android.com/about/versions/16/behavior-changes-16

One thing is **not** done and belongs to the client: from 2026 Google requires apps installed
on certified Android devices to come from a **verified developer**, sideloading included. The
rollout reaches Brazil, Indonesia, Singapore and Thailand on 30 September 2026 and widens from
there. Our GitHub APK link keeps working in Israel for now, but it has an expiry date, and the
Play listing is what replaces it.
https://support.google.com/android-developer-console/answer/16561738

## The plan in one line

The client creates a Google Play **organization** account ($25, one time), we upload the
app, the branches install it from Play, and from then on updates happen by themselves.

## Why an "organization" account and not a personal one

- A personal account created today is forced to run a test phase first: 12 testers who
  stay opted in for 14 straight days, before Google even allows a public release.
  **Organization accounts skip that completely.**
- The app is the company's, so the account should be the company's. If it were on a
  personal account and that person left, the app goes with them.
- The company needs a D-U-N-S number for the Apple account anyway. Same number, both
  stores, one wait.

Price is the same either way. Organization just needs more paperwork, listed next.

## Phase 0. What the client must have ready (their part)

- [ ] The company's **exact registered legal name and address**
- [ ] The **D-U-N-S number** (see the iOS guide, Phase 1. Free. Takes a week to a month,
      so start it first.)
- [ ] A **company Google account**, not someone's personal Gmail
- [ ] A **Google Payments profile with details that match the D-U-N-S record exactly**.
      Google's own rule: if they do not match, the account gets restricted.
- [ ] A **company bank account or card**. Google verifies it with a small test deposit or
      by asking for bank documents. Can take up to 5 days.
- [ ] **Business registration papers** and proof of the company's physical address
- [ ] The **ID of the person signing up**, and that person must be named in the company
      registration
- [ ] The **company website**, plus access to prove they own it (done through a free
      Google tool called Search Console, we can help with that part)
- [ ] An **email address and phone number that will be visible to the public** on the
      store page. Must be a company address and a company number, never a personal mobile.

## Phase 1. Create the account ($25, one time) (their part, with us on a call)

- [ ] Go to https://play.google.com/console/signup signed in with the company Google
      account
- [ ] Choose **Organization**
- [ ] Fill in the D-U-N-S and company details, exactly as they appear at D&B
- [ ] Pay the **$25 one-time fee**. Prepaid cards are refused.
- [ ] Finish the verification steps: upload the documents, verify the payment method,
      verify the website, confirm email and phone with one-time codes

This all happens in a normal web browser on any computer. Best done as a screen share:
the client types their own passwords and card, we guide.

## Phase 2. The client gives us access (their part, two minutes, free)

- [ ] In Play Console: **Users and permissions** → invite our Google account
- [ ] Give us release permissions for this app only

From then on we do all the actual work from our own login. We never need theirs again.

## Phase 3. What we build and prepare (our part, can start today)

None of this waits on the account, it can all run while the client does Phases 0-2.

### The app file itself

- [ ] **The client's own domain must be decided first.** The app bakes the server address
      into itself when we build it. If we publish pointing at the temporary server address
      and it later changes, every phone would need to reinstall. Settle the domain, then
      build.
- [x] **Build an AAB, release-signed.** Done 2026-08-18. `npm -w apps/web run bundle:android`
      builds the web app, syncs it into the Android project and produces a signed
      `app-release.aab`. The old `assembleDebug` APK is still what the sideload link
      serves; Play only accepts the bundle.
      **A release build cannot install over a debug one.** They carry different
      signatures, so anyone holding the current APK has to uninstall before installing a
      release build. Worth knowing before the boss's phone is the one that finds out.
- [x] **Back up the keystore file** somewhere safe. Generated 2026-08-18 at
      `C:\Users\ADMIN\keystores\burgers-bar-upload.jks`, outside the repository, with its
      passwords in `KEYSTORE_INFO.txt` beside it and in `~/.gradle/gradle.properties`.
      **Move both into a password manager**, they exist in one place today. Google can
      reset an upload key if it is lost, but that is a support ticket, not a click.
      Two related things are already fixed (2026-08-16), so the trap they set is gone:
      the Android `.gitignore` now ignores `*.jks` and `*.keystore` (the template ships
      those patterns commented out, so a keystore created in the project folder would
      have been committed), and `allowBackup` is now off, so the stored login session no
      longer rides Android's cloud backups onto whatever device restores them next.
- [x] Set a real version: name "1.0.0", and remember every future upload needs a higher
      versionCode. Both now live in `apps/web/android/version.properties`, one edit per
      release, read by the Gradle build.

### The store page

- [x] **App icon:** 512 x 512 PNG, `assets/store/play-icon-512.png` (2026-08-30). Not
      `apps/web/public/icon-512.png`, which this checklist used to name: that one is the
      maskable PWA tile, and its safe-zone padding renders the mark small on a store page.
      The launcher icons and the launch screen are done too.
- [x] **Feature graphic:** a 1024 x 500 banner image shown at the top of the store page.
      Built 2026-08-18 from the brand's own wordmark and mark:
      `assets/store/feature-graphic-1024x500.png`, regenerated by
      `node assets/store/generate-feature-graphic.mjs`.
- [x] **Screenshots:** at least 2 required, Google recommends 4 or more, portrait,
      1080px wide or better. Three shot at 1080 x 2400 in both languages,
      `assets/store/screenshots/android/{he,en}/`. They photograph a demo shift at a branch
      that does not exist, never the client's real board. Re-shoot with
      `assets/store/seed-demo.mjs` + `apps/web/scripts/store-screenshots.mjs`.
- [x] **Texts:** app name (up to 30 characters), short description (80), full description
      (4000), in both Hebrew and English. Written and character-counted in
      [store-listing.md](store-listing.md).

### The declarations Google requires

- [x] **Privacy policy**, a public web page. Required for every app. Written 2026-08-18 and
      served by the web app itself at `/privacy`, in Hebrew and English, with no login: the
      URL for both store listings is the deployed site plus `/privacy`. Its wording was
      written against the database schema, so it matches the Data safety answers below.
      Revised 2026-08-30 to disclose the "last active" timestamp the staff list shows, which
      shipped after the policy was first written, and to link on to the deletion page.
      **Two placeholders remain** in `apps/web/src/routes/privacy-content.ts`, the client's
      registered business name and a contact mailbox. Both must be real before either
      listing is submitted, and the page should be linked from the app once they are.
- [x] **Account deletion.** Play's data-deletion policy wants a page that opens with no
      login for any app with accounts, and the Data safety form asks for its URL. Served by
      the web app at `/delete-account` (2026-08-30), Hebrew and English, saying how to ask,
      what is deleted, what is kept and why, and how long it takes. It promises only what the
      system can do: there is no self-service delete — the API deactivates rather than erases,
      and `tasks.created_by` has no cascade — so it describes an operator handling a request,
      which is what Play accepts. It carries the same contact placeholder the policy does.
- [ ] **Data safety form.** We honestly declare what the app collects: account email,
      name, role, tasks, chat messages, the "last active" timestamp the staff list shows,
      all sent encrypted. Google checks apps against
      their declarations and blocks updates if they do not match, so accuracy matters.
      The code audit (2026-08-16) confirmed the easy part: the app has **zero**
      third-party trackers, analytics or ad SDKs, everything goes only to our own
      server over HTTPS. That makes this form short and safe to fill honestly.
- [ ] **A demo login for Google's reviewers.** The app is locked behind a login, so
      reviewers get a working test account, same as Apple requires.
- [ ] **Content rating questionnaire** (a work app, it will come out "Everyone")
- [ ] Target audience declaration (not aimed at children)

## Phase 4. Upload and release (our part)

- [ ] In Play Console: **Release → Production → Create new release**
- [ ] Upload the AAB. First upload automatically enrolls the app in Play App Signing.
- [ ] Write the release notes
- [ ] The dashboard shows a checklist and blocks submission until every section is green.
      Work through whatever it still flags.
- [ ] Submit for review

**Review time:** usually a few hours to 3 days. A first-ever submission can take up to
a week.

**Do we need to hide the app like on iOS?** No. Google does not have Apple's strictness
about employee-only apps. The listing is public, but the app is useless without a company
login, and that is a normal, accepted pattern on Play. Truly hiding it would require every
employee phone to be enrolled in Google's business management system, which does not fit
personal phones.

## After it is live

- **Design change?** We upload a new AAB (5 minutes once set up). Phones update
  themselves within about a day. No more "please re-download" messages to 44 branches.
- **Server-side change** (assistant, API, data)? Nothing to upload, reaches everyone
  instantly, same as now.
- The GitHub APK link can retire, or stay as an emergency backup. Just remember it never
  self-updates.

## Costs

| Item | Cost |
|---|---|
| D-U-N-S number | Free (shared with Apple) |
| Google Play organization account | $25, one time. Not yearly. |
| Our access | Free |
| Publishing and every update after | Free |

## Timeline, honestly

| Stage | How long |
|---|---|
| D-U-N-S | 1 week to 1 month. Same wait as Apple, one number covers both. |
| Google's verification of the company | Up to about a week |
| Our build + store page prep | Days, runs in parallel with the above |
| First review | Hours to about a week |

Roughly the same 3 to 6 week window as iOS, and mostly the **same** wait, not an extra
one. Both store setups should run at the same time.

## Every link, in order

| Step | Link |
|---|---|
| Check / request the D-U-N-S | https://developer.apple.com/enroll/duns-lookup/ |
| What the account requires | https://support.google.com/googleplay/android-developer/answer/13628312 |
| Account types compared | https://support.google.com/googleplay/android-developer/answer/13634885 |
| Create the account | https://play.google.com/console/signup |
| The 12-tester rule (personal accounts only) | https://support.google.com/googleplay/android-developer/answer/14151465 |
| Prepare and roll out a release | https://support.google.com/googleplay/android-developer/answer/9859348 |
| App bundle + signing requirements | https://support.google.com/googleplay/android-developer/answer/9859152 |
| Play App Signing | https://support.google.com/googleplay/android-developer/answer/9842756 |
| Target API level policy | https://support.google.com/googleplay/android-developer/answer/11926878 |
| Store listing asset sizes | https://support.google.com/googleplay/android-developer/answer/9866151 |
| Data safety form | https://support.google.com/googleplay/android-developer/answer/10787469 |
| Search Console (website verification) | https://search.google.com/search-console |

## Things that will bite if forgotten

1. **Google Payments profile must match the D-U-N-S record exactly**, or the account gets
   restricted. This is the Google-specific trap.
2. **The developer email and phone are shown publicly** on the store page. Company
   contacts only.
3. **Play does not take APKs.** The debug APK from our GitHub link can never be uploaded.
   Release-signed AAB only.
4. **versionCode only goes up.** Every upload needs a higher number.
5. **The Data safety form is enforced.** A wrong declaration can get updates blocked or
   the app removed.
6. **Reviewers need a working login**, and it must stay alive during review.
7. **Back up the upload keystore**, even though Google can reset it.
8. **Do not downgrade targetSdk.** It is already at 36, which is exactly what the
   31 August 2026 rule demands.
