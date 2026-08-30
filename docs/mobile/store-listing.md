# The store listing copy

Everything the two consoles ask you to type, written once here so it is reviewed before it is
pasted rather than invented in the form. Character limits are the stores' own, and each field
below is inside its limit.

The app is a staff tool, not a consumer product: nobody is browsing the store for it, they are
sent to it by their manager. So the copy is written to be recognised by someone who was told
to install it, not to compete for a download.

**Both listings need the client's business name and a support mailbox before submission.** The
same two placeholders block the privacy policy, see `apps/web/src/routes/privacy-content.ts`.

## App name

Play allows 30 characters, App Store 30.

| | Text | Length |
|---|---|---|
| Hebrew | `ברגרס בר - צוות` | 15 |
| English | `Burger's Bar Staff` | 18 |

## Subtitle (App Store only, 30 characters)

| | Text | Length |
|---|---|---|
| Hebrew | `משימות, נהלים והמשמרת` | 21 |
| English | `Shifts, tasks, answers` | 22 |

## Short description (Play only, 80 characters)

| | Text | Length |
|---|---|---|
| Hebrew | `לוח המשימות של הסניף ועוזר שעונה על נהלי העבודה, בעברית ובאנגלית.` | 65 |
| English | `Your branch's task board, and an assistant that answers from your own SOPs.` | 75 |

## Full description (4000 characters, both stores)

### Hebrew

```
ברגרס בר - צוות היא האפליקציה הפנימית של עובדי הרשת. היא מרכזת את מה שמשמרת צריכה: מי עושה מה היום, מה כבר נסגר, ומה הנוהל כשלא זוכרים אותו.

לוח המשימות
כל משימה שייכת לסניף, עם אחראי, תיאור ותאריך יעד. שלושה מצבים בלבד - לביצוע, בתהליך, הושלם - כדי שמבט אחד יספיק. מנהל רואה את כל הסניף, עובד רואה את מה שנוגע אליו.

עוזר שמכיר את הנהלים שלכם
שואלים בשפה חופשית ומקבלים תשובה מתוך מסמכי החברה עצמה, לא מהאינטרנט. שואלים בעברית - עונה בעברית. שואלים באנגלית - עונה באנגלית. כשהתשובה לא נמצאת במסמכים, העוזר אומר את זה במקום להמציא.

התראות
כשמקצים לכם משימה, הטלפון מודיע. רק למי שנוסף למשימה, ובשפה של אותו אדם.

מאגר ידע
הנהלים, ההדרכות והטפסים של הרשת במקום אחד, מסודרים לפי נושא ומתעדכנים מעצמם.

עברית מלאה
כל האפליקציה בנויה מימין לשמאל, לא תרגום שהודבק על עיצוב לועזי. אפשר להחליף שפה בכל רגע, וכל אחד עובד בשפה שנוחה לו.

מצב יום ומצב לילה
כדי שהמסך יהיה קריא גם באור של מטבח וגם במשמרת לילה.

הגישה לאפליקציה היא בהזמנה מההנהלה בלבד. אין הרשמה עצמית, ואין בה פרסומות, מעקב או כלי אנליטיקה.
```

### English

```
Burger's Bar Staff is the internal app for people who work at Burger's Bar. It holds what a shift actually needs: who is doing what today, what is already closed, and what the procedure says when nobody remembers it.

The task board
Every task belongs to a branch and carries an owner, a description and a due date. Three states only - to-do, in progress, done - so one look is enough. Managers see the whole branch, staff see what concerns them.

An assistant that knows your procedures
Ask in plain language and get the answer out of the company's own documents, not off the internet. Ask in Hebrew, it answers in Hebrew. Ask in English, it answers in English. When the answer is not in the documents it says so instead of inventing one.

Notifications
When someone assigns you a task, your phone tells you. Only the people newly added to it, and each in their own language.

Knowledge base
The chain's procedures, training material and forms in one place, filed by subject and kept up to date on their own.

Built for Hebrew
The whole app is laid out right to left, not a translation pasted over a Latin design. The language switches at any moment, so everyone works in the one they prefer.

Day and night
So the screen stays readable under kitchen lights and on a late shift.

Access is by invitation from management only. There is no self sign-up, and there are no ads, no tracking and no analytics.
```

## Keywords (App Store only, 100 characters, comma-separated, no spaces)

```
משמרת,משימות,מסעדה,צוות,נהלים,shift,tasks,restaurant,staff,sop,checklist
```

72 characters. Do not repeat the app name or subtitle words, Apple already indexes those.

## The rest of the form

| Field | Answer |
|---|---|
| Category | Business (both stores) |
| Content rating | Everyone / 4+. It is a work tool with no user-generated public content. |
| Ads | None. Declare "no ads" on both. |
| Privacy policy URL | The deployed site plus `/privacy`, e.g. `https://burgers-bar-todo.vercel.app/privacy` until the client's domain exists |
| Account deletion URL (Play) | The same site plus `/delete-account`. Play's data-deletion policy asks for a page that opens with no login, names the app as the listing does, and says how to ask; that page is it. Answer "yes, users can request account deletion", and "no" to in-app deletion, since accounts are opened by management and there is no public sign-up. |
| Support URL / email | The client's mailbox, same one as the privacy policy |
| Data safety (Play) / App Privacy (Apple) | Name, email address, user ID, device ID, other user content, and product interaction (the "last active" timestamp the staff list shows). All linked to the account, none used for tracking. This matches `apps/web/ios/App/App/PrivacyInfo.xcprivacy` exactly, and both consoles compare the two. |
| Reviewer demo account | Required, the app is entirely behind a login. Use the production test employee, and say in the notes that content is in Hebrew and the language can be switched from the toggle on the sign-in screen. |
| Countries | Israel is enough for a staff tool. |

## The assets themselves

| Asset | Where | Notes |
|---|---|---|
| Feature graphic | `assets/store/feature-graphic-1024x500.png` | Play only. Regenerate with `node assets/store/generate-feature-graphic.mjs`. |
| Play icon 512 | `assets/store/play-icon-512.png` | Generated with the app icons. Not `apps/web/public/icon-512.png` — that one is the maskable PWA tile, whose safe-zone padding renders the mark small on a store page. |
| Screenshots | `assets/store/screenshots/{ios-6.9,android}/{he,en}/` | 1320x2868 for Apple, 1080x2400 for Play. Dark first, since dark is what the app opens in. |

The screenshots are shot against a demo shift at a branch that does not exist, seeded by
`assets/store/seed-demo.mjs`. That is deliberate: the client's real board is their operational
data and does not belong on a public store page. To re-shoot after a design change, see the
header comments in that script and in `apps/web/scripts/store-screenshots.mjs`.
