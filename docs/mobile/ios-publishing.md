# Publishing the Burger's Bar app on iOS

Written 2026-08-16. Companion to [android-publishing.md](./android-publishing.md). Every fact here was
checked against Apple's own pages. All links are at the bottom.

## Words used in this guide, in plain language

| Word | What it means |
|---|---|
| **Apple Developer Program** | Apple's paid membership ($99 a year) that a company must have before it can put any app on iPhones |
| **App Store Connect** | Apple's website where developers manage their apps, uploads, and store pages |
| **D-U-N-S number** | A free 9-digit ID that proves a company really exists. Both Apple and Google ask for it. One number works for both. |
| **Account Holder** | The one person whose Apple Account owns the company's whole developer membership. Permanent, hard to change later. |
| **Unlisted App** | An app that is fully on the App Store but invisible: no search results, no charts, no categories. Only people with the direct link can find and install it. |
| **Bundle ID** | The app's permanent technical name, ours is `com.burgersbar.staff`. Can never change after first publish. |
| **App Review** | Apple's human review that every app must pass before going live. Usually 1 to 2 days. |
| **Xcode** | Apple's development program. Only runs on a Mac, which is why we rent one. |

## Where we are right now

The iOS app works. It runs in the iPhone Simulator on the rented Mac, current with the
latest design, connected to the real server.

What is missing is not code, it is the **account**, and one thing blocks it:

**Apple requires a work email on the company's own domain.** A Gmail address is rejected.
The client may not have a domain at all yet. Until that exists, everything below waits.

## The plan in one line

The client owns an Apple Developer account ($99 a year), the app is published as an
**Unlisted App**, and the branches install it from a private link that we send them.

## Why "unlisted" and not a normal App Store listing

Apple has a rule (guideline 4.2) against apps that are "a repackaged website", and it is
strict about apps meant only for one company's staff appearing in the public store. An
internal tool sitting in public search results invites rejection.

Unlisted distribution is Apple's own answer for exactly our case. Their page literally
names "employee resources" as an intended use. The app:

- goes through normal review and lives on the real App Store
- **updates itself automatically**, like any app
- never appears in search or browsing, only the direct link reaches it
- works on employees' personal iPhones, nothing to enroll or manage

Anyone with the link could technically install it, but without a company login the app
shows nothing, so that is covered.

## Phase 0. What the client must have ready (their part)

- [ ] A **registered legal company**. Apple rejects trade names, DBAs, and branches.
- [ ] The **exact registered legal name and address**
- [ ] A **company phone number**, ideally the one listed in public business registries
- [ ] A **working company website on their own domain**. Not a Facebook page, not an
      empty placeholder.
- [ ] An **email address on that same domain**, for example `apps@theirdomain.com`.
      Shared, not one person's private mailbox.
- [ ] A **credit card** for the $99 yearly fee
- [ ] The **person with authority to sign contracts** for the company: the owner, an
      executive, or someone given that authority in writing. This person becomes the
      permanent Account Holder.

Also warn them: **Apple often phones the company** during verification, on the number in
public registries. Whoever answers should know what the call is about.

## Phase 1. D-U-N-S number (their part, start first, it is the slowest)

The free 9-digit company ID from Dun & Bradstreet. Apple uses it to confirm the company
is real. **Google Play needs the same number**, so this one step serves both stores.

- [ ] Go to https://developer.apple.com/enroll/duns-lookup/ (asks for an Apple sign-in
      first, that is normal)
- [ ] Search for the company. Many registered businesses already have a number without
      knowing, banks and suppliers report to D&B.
- [ ] Already there? Done today, free.
- [ ] Not there? Request it on the same page, also free.

**How long:** Apple says about a week. Google's docs warn it can take **up to 30 days**.
So tell the client: "usually a week, can be a month". Chase D&B by email if it passes
two weeks.

A D&B representative may phone to confirm the business type and employee count.

## Phase 2. The company Apple Account (their part)

- [ ] Create a **new** Apple Account at https://account.apple.com using the company-domain
      email from Phase 0
- [ ] Turn on **two-factor authentication**
- [ ] Use a phone the company controls for it, not a contractor's

**Do not use an owner's personal iCloud.** This account becomes the permanent owner of
the company's entire App Store presence, and moving it later means a support process with
Apple, not a settings switch.

**Known snag:** if signup says "Cannot Verify Email Address", that address most likely
already has an Apple Account. Check at https://iforgot.apple.com before assuming a bug.

## Phase 3. Join the Apple Developer Program, $99 a year (their part, with us on a call)

- [ ] Go to https://developer.apple.com/programs/enroll/ and start the enrollment
- [ ] Choose **Company / Organization**, not Individual
- [ ] Fill in the D-U-N-S, legal name, address, website, and work email
- [ ] Confirm the signing authority question
- [ ] Submit and wait. Apple verifies the company, may ask for notarized documents, and
      often calls the company phone number.
- [ ] Pay the **$99** after Apple approves. It renews every year.

This all happens in a normal web browser on any computer. No Mac needed for this part.
Best done as a screen share: the client types their own passwords and card, we guide.

## Phase 4. The client gives us access (their part, two minutes, free)

- [ ] In App Store Connect → **Users and Access** → invite our Apple Account
      (https://appstoreconnect.apple.com/access/users)
- [ ] Roles: **App Manager** and **Developer**

From then on we do all the real work from our own login. We never need theirs again.

- [ ] We register the app's Bundle ID `com.burgersbar.staff` at
      https://developer.apple.com/account/resources/identifiers/list
      (permanent, can never change after first publish)

## Phase 5. What we build and prepare (our part, can start today)

None of this waits on the account, it can all run while the client does Phases 0-4.

- [ ] **The client's own domain must be decided first.** The app bakes the server address
      into itself when we build it. Publish pointing at the temporary server and every
      installed iPhone would need a reinstall when it changes. Settle the domain, then
      build.

- [ ] **Make the app more than a wrapped website.** Apple's guideline 4.2, their exact
      words: "Your app should include features, content, and UI that elevate it beyond a
      repackaged website." Right now our app is close to exactly that, which is the
      single biggest rejection risk. Before submitting we add real phone features:
      push notifications for task assignments, Face ID login, camera for attachments,
      and sensible behaviour when offline.

- [ ] **A demo login for Apple's reviewers.** Apple's rule for apps behind a login:
      provide "an active demo account or fully-featured demo mode". Mandatory for us.
      The credentials go in the review notes, and the account and our server must stay
      up during review.

- [ ] **Screenshots.** 1 to 10 allowed. Take them at **iPhone 17 Pro Max size,
      1320 x 2868**, straight from the Simulator. Apple auto-scales that one size to
      every smaller iPhone, so one set covers everything.

- [x] **Privacy policy**, a public web page, plus Apple's privacy questionnaire about
      what data the app collects. Written 2026-08-18, served by the web app at `/privacy`
      in Hebrew and English with no login, so the URL for App Store Connect is the deployed
      site plus `/privacy`. The questionnaire's answers are the five data types listed in
      `PrivacyInfo.xcprivacy`. **Two placeholders remain**, the client's registered business
      name and a contact mailbox, both in `apps/web/src/routes/privacy-content.ts`.

- [ ] The store page texts: app name, subtitle, description, keywords, support URL,
      category, age rating

### Checked against our actual code (audit ran 2026-08-16)

Good news first, these are already done in the repo:

- The app icon is correct: the ( B ) mark, right size, no transparency (Apple rejects
  icons with transparency, ours already strips it)
- No special permission texts needed, the app asks for nothing sensitive
- Network security settings are already correct as-is
- Version numbers are set and valid for a first submission

Corrected 2026-08-18: that audit also said the privacy manifest was fine as-is. It was not
there at all. App Store Connect has rejected uploads without one since May 2024, so it has
now been written (below).

Fixed since the audit, no longer outstanding:

- The launch screen was still the stock Capacitor logo, a blue third-party mark on white,
  flashed on every cold start. It is now the ( B ) mark on the brand's paper canvas,
  generated by `assets/brand/generate-app-icons.mjs` alongside the icons.
- `ITSAppUsesNonExemptEncryption = false` added, which skips Apple's encryption
  questionnaire on every upload. We use only standard HTTPS, so false is the truthful
  answer.
- The project is now **iPhone-only**. It previously claimed iPad support, which would have
  forced a second set of iPad screenshots and handed reviewers a tablet layout the app was
  never designed for.
- **Landscape is gone** (2026-08-18). `Info.plist` now lists portrait only, closing the
  rejection risk of a reviewer rotating into a layout nobody has ever looked at.
- **The privacy manifest exists** (2026-08-18): `ios/App/App/PrivacyInfo.xcprivacy`,
  declaring the five data types the app collects, all linked to the account and none used
  for tracking, plus the user-defaults required-reason category. It was written on Windows,
  so **one step is still owed on the Mac**: open `App.xcodeproj`, drag the file into the
  App group, tick the App target, and confirm it lands in Build Phases > Copy Bundle
  Resources. A manifest that is not a target member ships as nothing.

Still open:

- [ ] The reviewer demo account already exists in production (our test employee login).
      It only needs typing into the review form once the account exists.

## Phase 6. Build and upload (our part, on the Mac)

- [ ] `git pull`, then `npm ci` at the repo root
- [ ] `npm -w apps/web run sync:ios`
- [ ] `npm -w apps/web exec -- cap open ios`
- [ ] In Xcode: select the client's team under Signing & Capabilities
- [ ] Set the version and build number
- [ ] Device selector → **Any iOS Device (arm64)**
- [ ] Menu: **Product → Archive**
- [ ] In the window that opens, click **Validate App** first. It runs Apple's automated
      checks without submitting, and catches problems before they cost us a review round.
- [ ] Then **Distribute App → App Store Connect → Upload**

One caution: doing this on the rented Mac puts the client's signing certificate on a
machine they do not own. Fine for now, worth moving to a company Mac eventually.

## Phase 7. Submit, then request unlisted (our part)

- [ ] In App Store Connect: create the app, attach the uploaded build, fill in the store
      page, screenshots, privacy answers, age rating
- [ ] In the **review notes**, write two things:
      - the demo account credentials
      - that the app is intended for **unlisted distribution**, for the company's own
        staff across its branches
- [ ] Click **Add for Review → Submit to App Review**
- [ ] **Then** submit Apple's unlisted request form:
      https://developer.apple.com/contact/request/unlisted-app/

The order matters: the unlisted request goes in **after** the app is submitted to review,
and the app must be a finished build, not marked as beta.

Review normally takes **1 to 2 days**.

- [ ] Once approved, the app's distribution flips to "Unlisted App" and Apple generates
      the install link
- [ ] That link goes out to the branches. New employee? Send them the link. Done.

## After it is live

- **Design change?** We upload a new build from the Mac (Phase 6 again, about 15
  minutes). Phones update themselves. No more re-download instructions.
- **Server-side change** (assistant, API, data)? Nothing to upload, reaches everyone
  instantly.

## Costs

| Item | Cost |
|---|---|
| D-U-N-S number | Free (shared with Google) |
| Apple Developer Program, organization | $99 a year, renews |
| Our access as App Manager + Developer | Free |
| Unlisted distribution | Free |

## Timeline, honestly

| Stage | How long |
|---|---|
| D-U-N-S | 1 week to 1 month. Start first, everything waits on it. |
| Apple's verification of the company | A few days, plus a phone call |
| Our app improvements (Phase 5) | Runs in parallel, should start now |
| App Review | 1 to 2 days |
| Unlisted approval | A few days |

**3 to 6 weeks from the client starting to a live install link.** The clock does not
start until the D-U-N-S request goes in. Run the Google Play setup in the same window,
it shares the D-U-N-S wait.

## Every link, in order

| Step | Link |
|---|---|
| Check / request the D-U-N-S | https://developer.apple.com/enroll/duns-lookup/ |
| Create the company Apple Account | https://account.apple.com |
| Check if an email already has an account | https://iforgot.apple.com |
| Program requirements and cost | https://developer.apple.com/programs/ |
| Start the enrollment | https://developer.apple.com/programs/enroll/ |
| Invite us as App Manager + Developer | https://appstoreconnect.apple.com/access/users |
| Register the Bundle ID | https://developer.apple.com/account/resources/identifiers/list |
| The rules the app is judged on (see 2.1 and 4.2) | https://developer.apple.com/app-store/review/guidelines/ |
| Exact screenshot sizes | https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/ |
| The privacy questionnaire | https://developer.apple.com/app-store/app-privacy-details/ |
| Uploading builds from Xcode | https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds |
| Create the app and submit | https://appstoreconnect.apple.com/ |
| What unlisted distribution is | https://developer.apple.com/support/unlisted-app-distribution/ |
| **The unlisted request form** | https://developer.apple.com/contact/request/unlisted-app/ |

## Things that will bite if forgotten

1. **A Gmail address will not pass.** Apple demands a work email on the company's own
   domain. This is our current blocker.
2. **The Account Holder is permanent.** Whoever enrolls owns it. Never an individual's
   personal Apple ID.
3. **The app ships a frozen copy of the design.** Server changes reach phones instantly,
   visual changes need a new build and upload.
4. **The server address is baked in at build time.** Settle the client's domain before
   release.
5. **The Bundle ID `com.burgersbar.staff` can never change** after first publish.
6. **Guideline 4.2 is the real rejection risk.** A bare website-in-an-app is what it
   exists to reject. The native features in Phase 5 are not optional polish.
7. **The demo account and the server must stay up** for the whole review.
8. **The unlisted request comes after submission**, not before, and never on a beta
   build.
