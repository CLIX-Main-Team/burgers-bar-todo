# START HERE

## 1. Read me first

This is the staff app of Burger's Bar, an Israeli restaurant chain of about 47 branches and a head office. It holds a task board per branch, projects (such as opening a branch), the people and their roles, a Hebrew AI assistant that answers from the company's own Google Drive documents, a daily WhatsApp group digest, and an Android and iOS wrapper for phones. It runs as a website on a server the company rents and as an Android app installed from a download link; the iOS version exists in the code but was never published. It was built by an agency (CLIX). The company is taking over every account (section 3) and keeps developing it with Claude Code.

**Before Claude (owner, once).** The handover video shows every step.

1. Subscribe to Claude Pro at claude.ai with the company email.
2. Install Visual Studio Code, add the Claude Code extension inside it and sign in with that Claude account.
3. Create an empty folder (for example Documents \ Burgers Bar), open it in VS Code and ask Claude to install Git and to download the project from your GitHub account into the folder. This file sits at the root of the project.
4. Save the keys file (section 4) in that folder under the name `.env`.
5. Type the sentence below.

**How to use this file.** Open this folder in Claude Code and type: "Read START-HERE.md and tell me what to do first". In Hebrew: "קרא את START-HERE.md ותגיד לי מה לעשות קודם". Claude then walks you through the First session checklist (section 9), one step at a time, in plain words.

**Rules for Claude.**

- Answer in the language the owner writes in. If the owner writes Hebrew, explain in Hebrew; keep commands, file names and variable names in English.
- No question needed: read anything in this folder, run the app locally, read GitHub issues and Actions runs, create branches and pull requests, run read-only commands on the server (section 6 lists them).
- A yes is needed every time for: merging to `main` (it goes live within minutes), running Deploy, editing the master env file, any account setting, any spend, installing software.
- Never print, paste or commit a secret line from the keys file. Section 4 says which lines are secret; every other line is a setting Claude may read and show.
- Where this file says "check", open the file or page it names instead of guessing.

**Words used in this file.**

- Repository (repo): the folder with all the code and its history, kept on GitHub and cloned to this PC.
- API: the server side of the app; the website and the phone app talk to it.
- Migration: a script that changes the database's tables.
- Pull request: a proposed change that is reviewed before it goes in.
- Merge: accepting it; a merge to `main` goes live.
- CI: the automatic checks that run on every change.
- Deploy: putting a new version on the server.
- Container: one packaged program running on the server (the API, the website, the digest).
- Env file: a text file of `NAME=value` settings. The keys file is the env file that holds the passwords and keys.
- base64: a way of writing a whole file as one long line of text, so it fits in an env file.
- SSH key: a pair of files that logs in to the server without a password; the private half is the secret.
- Webhook: a web address a service calls to deliver events; Green API delivers WhatsApp messages this way.
- Lint: an automatic check of code style and simple mistakes.

## 2. What the app does

Hebrew and English throughout, right to left for Hebrew, built for phones first. Invite only: nobody can sign up; a person is invited by email by someone whose role allows it. A session ends after 14 days without use.

**How it is built** (Claude reads this; the owner can skip). One repository with four parts: `apps/web` (the website, React and Vite), `apps/api` (the server, Fastify on Node, Postgres through Drizzle), `apps/whatsapp-digest` (the daily digest, its own container) and `packages/shared` (the schemas and the role model both sides use). Permissions are enforced in the API, not in the database. The database is Supabase Postgres, the server is a Hostinger VPS, and the phone app is the website wrapped by Capacitor.

**Roles.** 18 roles in code (`packages/shared/src/index.ts`), in five tiers:

| Tier | Roles | Notes |
| --- | --- | --- |
| Owner | `super_admin` | No branch, sees everything, the only one who edits the Access page. |
| Executive | `ceo`, `chain_manager` | May sit at the head office. |
| Head office | `finance_manager`, `operations_manager`, `procurement_manager`, `marketing_manager`, `brand_manager`, `setup_manager`, `chain_chef` | May sit at the head office. |
| Office | `office_manager`, `hq_secretary`, `bookkeeper` | May sit at the head office. |
| Branch | `admin`, `manager`, `employee`, `driver`, `field_ops` | `admin` is a branch admin: runs exactly one branch, cannot sit at the head office. |

The head office is a location of its own kind, created by a migration, never in the app. Every person belongs to one of seven departments (management, operations, procurement, marketing, call center, finance, customer service). Which pages a role sees, and how far it sees (whole chain, own branch, own department, assigned, own), is data the owner edits on the Access page, not code.

**Screens and features.**

| Screen or feature | What it does | State |
| --- | --- | --- |
| Login, invite link, password reset | Sign in, accept an invite link and set a password, reset a password by email link. | Working. Needs the sender mailbox (section 3). |
| Dashboard | Open, overdue and due-today tasks, team workload. | Working. |
| Tasks | Personal tab, department tab, subject cards, task checklists, live updates. Personal tasks are private to their owner. | Working. |
| Projects | Phased projects with a checklist, built for branch openings; steps can be handed to people. A knowledge scan proposes checklist steps from a matching company procedure. Built for desktop use; on a phone it takes a tab slot like any other page (the bar shows the first four pages a role may see, the rest sit under More). | Working. |
| Assistant | Private chat threads. Answers from company documents first, then app data (tasks, people, branches, projects, WhatsApp summaries), then the company website and the web (at most two searches per answer), then general knowledge. Built never to invent a fact; shows source chips. Runs on OpenRouter, default model `google/gemini-3.1-pro-preview`, backup `anthropic/claude-sonnet-5`. About 2 cents per answer. 20 questions per person per 10 minutes. | Working. |
| Knowledge | The Google Drive folder mirrored as tiles; documents open in Drive. Synced at server start, every 20 minutes, and by a manual resync. Reads Google Docs, Sheets and Slides, PDF, Word, Excel, PowerPoint and HTML; any other file type in the folder is skipped without an error. Each document gets a sensitivity tier (general, internal, confidential) from its folder and file name. | Working. |
| Locations | The branches plus the head office, with staffing per branch. | Working. |
| People | Invite, resend, revoke, deactivate, reactivate, change branch and department, online dot. | Working. |
| Profile, Access | Own name, avatar colour, language. The role-to-capability matrix (owner only). | Working. |
| Company website lookup | The assistant reads burgersbar.co.il live for hours, kashrut, menu items and club terms. | Working. |
| WhatsApp daily digest | A separate container. Reads the chain's WhatsApp groups through Green API, writes one Hebrew summary per group and one merged digest, and sends it at 08:00 Israel time to one number or group, never on Saturday (the keyword still answers that day). A run that fails before spending anything retries every 5 minutes for an hour. In the chat the digest is sent to (the `WHATSAPP_DIGEST_RECIPIENT` number or group), anyone who writes the single word "סיכום" gets a summary back in that chat. The keyword works nowhere else, and not at all while the recipient is blank. | Built. On or off is the `enabled` flag in the `whatsapp_digest_settings` table, not env. The owner opens Supabase, Table editor, `whatsapp_digest_settings`, and reads `enabled`; Claude explains the columns. |
| Push notifications | A push when someone is assigned a task, plus the ops alerts (spend alert, credit guard, sync failures) to chain admins. Android only. | Built. Live only while `FCM_PROJECT_ID` and `FCM_SERVICE_ACCOUNT_JSON` are set on the server (check the names list on the server, section 6). iOS push cannot work yet. Tapping a notification does not open the task yet. |
| Email | Invite and reset links go out through a Gmail mailbox. | Working. The mailbox must become yours. |
| Privacy and delete-account pages | `/privacy` and `/delete-account`, required by the app stores. | Exist, not linked from the app, two placeholders (section 8). |
| Phone app | The same web app wrapped by Capacitor. Android installs from a download link (section 7); iOS builds only on a Mac. | Android sideload only. Not in any store. |

## 3. Accounts and what each one is for

After the handover every account below is the company's. "Master env file" means `/docker/burgers-bar/.env.prod` on the server (section 6). The lettered notes follow the table.

One rule for Google accounts: use one plain Google account owned by the company for Drive, Google Cloud and Firebase. Workspace can come later for mail and the Apple account. If you only have Workspace, do not accept the Drive transfer (note B); make a copy of the subfolder inside the knowledge-base folder and ask the agency to delete its copy.

| Account | What it provides | Owner after handover | Where its key or setting goes | What the owner must do |
| --- | --- | --- | --- | --- |
| GitHub, repository `burgers-bar-todo` | The code, CI, the deploy workflow, the issue list (24 open at handover), and until now the `apk-latest` release staff installed from. | The company's GitHub account (transferred from the agency's GitHub organisation). | Actions secrets `DATABASE_URL` and `VPS_SSH_KEY`. | Before the first session (section 9): create the account with a company email, send the username to the agency, accept the transfer email within 24 hours, set the repository private. Then add the two secrets (section 9, step 5). Once the repository is private, the old APK download link stops working for staff (section 9, step 3). |
| Claude Pro (claude.ai, about 20 USD a month) | Claude Code, which reads this file. Pro has a usage limit per few hours; long sessions can hit it. Wait for the reset or move to the Max plan. | The company. | Nothing in the app. | Open it. |
| Supabase project (Postgres, Frankfurt, with pgvector); the project ref is on the dashboard and inside `DATABASE_URL` | The one production database, with all the data. | The company's Supabase organisation (today the agency's, on the free plan). | `DATABASE_URL` in the master env file and in the GitHub secret, always changed together. | Open it, then take the project over (note A). Needs the agency. |
| Google Cloud project (name in the password manager) | The Drive robot: a service account whose address is the `client_email` field of its key file, a Google account with no person behind it that can read the knowledge-base folder because the folder is shared with it. | The company's Google account as Owner (today under the agency's Google login). | `GOOGLE_SERVICE_ACCOUNT_JSON` (the robot's key file, base64) in the master env file. | Get added as Owner, let the agency remove itself, generate a new key, delete the old one, update the variable. The robot's address stays the same, so the folder sharing keeps working. Needs the agency. |
| Firebase project (name in the password manager) | Push notifications (FCM) for the phone app. | The company's Google account (today the agency's). | `FCM_PROJECT_ID` and `FCM_SERVICE_ACCOUNT_JSON` (base64) in the master env file. | Same owner swap, new key, delete the old one. Download `google-services.json` (Android) and `GoogleService-Info.plist` (iOS) from the Firebase console for the next phone builds; neither is in the repo. Needs the agency. |
| Google Drive folder `מאגר מידע לפי מחלקות` (its id is `DRIVE_FOLDER_ID` in the keys file, the last part of the folder's Drive URL) | The knowledge base the assistant answers from. Shared as Viewer to the robot. | Already the company's. | `DRIVE_FOLDER_ID` in the master env file (not a secret). | Accept the transfer of one subfolder (note B). Keep the Viewer share to the robot. Needs the agency. |
| OpenRouter | The AI provider for the assistant, the embeddings, the assistant's web search (engine chosen by `ASSISTANT_WEB_SEARCH_ENGINE`, no separate search key) and the WhatsApp digest. | Already the company's (the live key is on its account). | `OPENROUTER_API_KEY` in the master env file. | Create a new key after the handover, because the agency has seen the current one; give it a credit limit; delete the old key. The app has no spend cap, only alerts. |
| Green API (WhatsApp gateway) | The instance that reads the group chats and sends the digest. Paid Business tier, authorised by QR. | Already the company's. | `GREEN_API_URL`, `GREEN_API_ID_INSTANCE`, `GREEN_API_TOKEN_INSTANCE`, `GREEN_API_WEBHOOK_TOKEN`, `WHATSAPP_WEBHOOK_URL`, `WHATSAPP_DIGEST_RECIPIENT` in the master env file. | Replace the instance token and the webhook token with new ones (the webhook token is also set on the instance's `webhookUrlToken` field in the console). Keep the paid plan and the QR authorisation: if the plan lapses or the phone is unlinked, no messages are read and the digest goes quiet. The fix is to scan the QR again in the Green API console. |
| Hostinger VPS `srv1928986.hstgr.cloud` | The live server: `https://burgers.srv1928986.hstgr.cloud` (website plus `/api`), Traefik with Let's Encrypt, Docker, the three containers (note C). | Already the company's. | `DEPLOY_HOST` in the master env file; the private SSH key in the GitHub secret `VPS_SSH_KEY`; the public key in the server's `authorized_keys`. SSH is key-only. | Add your own SSH key and remove the agency's deploy key, today the only key on the box (section 9, step 4). |
| Sender mailbox | The address invite and reset emails are sent from. | The company's mailbox (today an agency Gmail with an app password). | `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` in the master env file. | Open it: Gmail with 2-step verification and an app password, or Google Workspace. |

Production runs on the VPS only. Earlier hosting on Render and Vercel was shut down and its configuration removed from the repository. The names in this table are copied from the consoles; the repository does not hold them, so check the console if one looks wrong.

- Note A, Supabase takeover. Supabase gives every project a public web address and a public key. In September 2026 the agency locked every table by hand (row-level security plus revoked grants) so that key cannot read data. That lock is not in the migrations, so keep the transferred project rather than building a new one from the migrations alone. Steps: open an account and an organisation, invite the agency's account, let the agency transfer the project (same data, same address), remove the agency, reset the database password, then update `DATABASE_URL` in the master env file and in the GitHub secret together. The free plan pauses the database after 7 idle days.
- Note B, Drive: the subfolder `דרייב ישן` (old copied files) is still owned by an agency Google account and is transferred to the company's plain Google account, folder and files together. That transfer works only between plain Google accounts, not to a Workspace account (the rule above the table).
- Note C, Hostinger. If you ever need a different server: a VPS cannot move between Hostinger accounts. A new server means a new hostname, so the phone app must be rebuilt (its address is baked in) and the host key pinned in `.github/workflows/deploy.yml` must change.

**What it costs.**

| Item | Cost | Paid by |
| --- | --- | --- |
| Hostinger VPS plan | The amount and the renewal date are on the Hostinger invoice. | The company's Hostinger account. |
| Supabase | Free plan today; it pauses the database after 7 idle days. The paid tier removes the pause (price on the Supabase pricing page). | Nothing today. |
| OpenRouter | Prepaid credit: about 2 cents an answer, plus the daily digest and embeddings. | The company's OpenRouter account. |
| Green API | The Business tier; the amount is in the Green API console. | The company's Green API account. |
| Claude Pro | About 20 USD a month. | The company. |
| Google Play | 25 USD once, when the company publishes (section 7). | Not opened yet. |
| Apple Developer | 99 USD a year, when the company publishes (section 7). | Not opened yet. |

Live secrets live in three places: the master env file on the server, the two GitHub secrets, and the password manager as the backup. Your local `.env` holds local values, plus the OpenRouter key and the robot key if you use the assistant locally. It never holds the production database line.

## 4. The keys file (.env)

Owner: the only thing you do here is keep the keys file in the password manager. The rest is for Claude.

The keys file is a plain text file named `.env`. Every line is `NAME=value`. It holds every password, token and key the app needs. The agency sends it separately, through a password manager, never by email or chat. Save it in the root folder of this repository, next to `package.json`; the API reads it from there and nowhere else. `.gitignore` already keeps `.env` out of git; keep it that way. Never paste a line of it into a chat with Claude, a GitHub issue or a commit. The keys file you receive has the local database line; the production line is a separate entry in the password manager.

Secret lines: `DATABASE_URL`, the two `*_JSON` lines, every `*_KEY`, every `*_TOKEN*`, every `*_PASSWORD`, `SMTP_USER`, `VPS_SSH_KEY`. Claude never shows these. Every other line is a setting and Claude may read and show it. To list names only: `grep -oE '^[A-Z_0-9]+=' .env`. The table in the appendix marks each variable.

Two more files hold settings. `apps/web/.env.local` has one harmless line, `VITE_API_BASE_URL=http://localhost:3000` (copy it from `apps/web/.env.example`). On the live server the master copy of the keys is `/docker/burgers-bar/.env.prod` (template: `.env.prod.example`); it exists only on the server and is never in git. For work on this PC, `DATABASE_URL` must be the local Docker line from `.env.example`, never the production database: `npm run db:migrate` and `npm run seed` act on whatever that line says. Claude's check before any database command: `grep -E '^DATABASE_URL=' .env | grep -qE 'localhost|127\.0\.0\.1' && echo local || echo 'NOT LOCAL, stop'`. Keep the production line in the password manager; the one exception is section 9, step 11.

Two format rules. A line written as `KEY=` is an empty value, not a missing one, and the API checks it; "optional" means delete the line, not leave it blank. The API refuses to start without three values: **`DATABASE_URL`**, **`GOOGLE_SERVICE_ACCOUNT_JSON`** and **`DRIVE_FOLDER_ID`**. A fourth, **`OPENROUTER_API_KEY`**, is checked right after, because the provider defaults to OpenRouter (any non-empty text lets the API boot; the assistant then fails until the key is real). Blank lines that stop the API: `ASSISTANT_WEB_SEARCH_ENGINE=`, `FCM_PROJECT_ID=`, `FCM_SERVICE_ACCOUNT_JSON=`. Blank lines that stop the digest container: `GREEN_API_URL=`, `GREEN_API_ID_INSTANCE=`, `GREEN_API_TOKEN_INSTANCE=`, `DATABASE_URL=`, and a `WHATSAPP_DIGEST_RECIPIENT` that is not digits only (a plus sign or a leading 0).

To turn a JSON key file into the base64 form the two `*_JSON` lines want: `base64 -w0 key.json > key.b64` in Git Bash, so nothing prints; the one line in `key.b64` is the value. Then delete both files; `credentials.json` and `*-service-account.json` are gitignored, but they should not sit on disk.

The full variable list is the appendix at the end of this file.

## 5. Run it on this computer

Owner: nothing to do here except say yes or no when Claude asks about installing software. The rest is for Claude.

Steps for Claude. "Ask the owner first" marks a step that installs software, rewrites files on disk or may spend money.

| Tool | Version | Why |
| --- | --- | --- |
| Node.js | 22 LTS (the code needs 22 or newer; CI and the server images use 22) | runs the API and builds the web app |
| Docker Desktop | current, with Compose v2 | the local database, the mail catcher, and the API tests |
| Git for Windows | current | the repo and Git Bash |

`make` is not needed and is not in Git Bash; the commands below replace the Makefile targets.

1. Check the tools: `node -v` (22 or newer), `npm -v`, `docker --version` and `docker compose version` (Compose v2), `git --version`. Anything missing: ask the owner first, then install.
2. Check line endings: `git config core.autocrlf`. If it is `true` (the Git for Windows default), every file is CRLF on disk, `npx biome ci .` fails on every file and hides the real lint errors, and the `.sh` scripts break in Git Bash. For a fresh clone: `git clone -c core.autocrlf=false <repo-url>`. For this clone, with `git status` clean and the owner's yes (it rewrites every file on disk): `git config core.autocrlf false && git rm --cached -r -q . && git reset --hard`. Until then `npx biome lint .` runs the rules alone.
3. Env files, in Git Bash from the project folder:
   - Put the keys file from the password manager at `./.env`; it carries the local database line. Without a keys file: `cp .env.example .env`, keep the local `DATABASE_URL`, set `SEED_ADMIN_PASSWORD` to something private, and give the three required values placeholders: `DRIVE_FOLDER_ID=local`, any non-empty `OPENROUTER_API_KEY`, and for `GOOGLE_SERVICE_ACCOUNT_JSON` the output of `printf '{"client_email":"dev@example.com","private_key":"placeholder"}' | base64 -w0`.
   - `cp apps/web/.env.example apps/web/.env.local` (one line, keep the default; without this file every API call fails).
   - With placeholders everything works except the assistant and the knowledge sync; both log a failure and carry on (a Drive error at boot and every 20 minutes, an OpenRouter 401 at boot and every hour). For work on anything but the assistant, keep the placeholder robot key.
4. Install: `npm ci`. One dependency (`xlsx`) downloads from `cdn.sheetjs.com`; a network that blocks that host breaks the install.
5. Start Docker Desktop, then the database and the mail catcher (mailpit, a fake mailbox on this PC that shows every email the app would send, at http://localhost:8025): `docker compose up -d --wait`.
6. Create the tables: `npm run db:migrate`. Create the first admin: `npm run seed`.
7. Two terminals: `npm run dev:api` (API on http://localhost:3000, health at http://localhost:3000/health) and `npm run dev:web` (website on http://localhost:5173). If `.env` holds the real keys, the first `npm run dev:api` syncs the whole Drive folder and spends OpenRouter credit on embeddings (cents, not dollars, at the folder's size today; the embedding model costs about 1 cent per million tokens). Ask the owner before the first start. To avoid it, keep the placeholder robot key when the assistant is not needed.
8. Sign in at http://localhost:5173 with `SEED_ADMIN_EMAIL` (`admin@burgers.local` in the template) and the `SEED_ADMIN_PASSWORD` you set. This account is `super_admin`. Re-running the seed never changes a stored password; to change it, use "forgot password" and read the mail at http://localhost:8025 (mailpit), or start over with `docker compose down -v` and then steps 5 and 6.

Ports: 3000 API, 5173 website, 5432 Postgres (`POSTGRES_PORT`), 1025 SMTP (the mail catcher), 8025 mailpit web UI, 4173 website preview (browser tests only).

Everyday commands (the Makefile targets need `make`; these are their exact equivalents):

| Task | Command |
| --- | --- |
| Start the database and the mail catcher (`make up`) | `docker compose up -d --wait` |
| Stop them, keep the data (`make down`) | `docker compose down` |
| Wipe the local database and start fresh (`make reset`) | `docker compose down -v`, then `docker compose up -d --wait`, `npm run db:migrate`, `npm run seed` |
| Tail their logs (`make logs`) | `docker compose logs -f` |
| Lint, typecheck, tests | `npx biome ci .`, `npm run typecheck`, `npm test` (web only: `npm -w apps/web test`) |
| Run the digest once from this PC | `npm run digest:once`. This reads the live groups and sends a real WhatsApp message to the live recipient. Never run it from this PC with the real values unless the owner asks for exactly that. For a dry run, blank `WHATSAPP_DIGEST_RECIPIENT` first. |

Before pushing code: `npm run typecheck`, `npx biome ci .`, `npm test` (the API suite starts a throwaway Postgres in Docker, so Docker Desktop must be running).

Browser tests (optional; the first run downloads Chromium, ask the owner first). Stop the dev API first: the tests start their own API on port 3000 against a separate `burgers_e2e` database, and a dev API already on 3000 is reused against the wrong one, so every test login fails with 401. Details in `apps/web/e2e/readme.md`.

```sh
docker compose up -d db mailpit
cd apps/web
npx playwright install chromium
npx playwright test
```

Windows traps:

- Reserved port ranges. Windows blocks ranges of ports, the ranges move between reboots, and they can swallow 3000 or 4173. List them in PowerShell with `netsh interface ipv4 show excludedportrange protocol=tcp`. Knobs: `API_PORT` (then `VITE_API_BASE_URL` in `apps/web/.env.local`), `POSTGRES_PORT` together with `DATABASE_URL`, and `npm -w apps/web run dev -- --port <n>` together with `CORS_ORIGIN` and `APP_BASE_URL`.
- If 5173 is busy, Vite moves to 5174 silently, `CORS_ORIGIN` no longer matches, and the API rejects every call. Free the port or change the three values together.
- `base64 -w0` is Git Bash syntax, not PowerShell.
- The `.sh` scripts and the Makefile need Git Bash, and CRLF line endings break them.
- Docker Desktop must be running before `docker compose up` and before `npm test`.

## 6. The live server

Owner: you do two things here, run Deploy on GitHub when Claude asks, and edit a line in the master env file on the server when a value changes (the recipe is below). The rest is for Claude.

The app lives at https://burgers.srv1928986.hstgr.cloud (the website) and https://burgers.srv1928986.hstgr.cloud/api (the API). The database is not on the server; it is the Supabase project.

**How code changes are made.** Branch from `main`. Run `npm run typecheck`, `npx biome ci .` and `npm test` locally. Open a pull request and wait for CI to be green. The owner says yes before any merge. Never push to `main` directly. A merge goes live within minutes.

**How a change reaches production.**

1. A pull request is merged into `main` on GitHub.
2. CI (`.github/workflows/ci.yml`) runs five jobs: lint, typecheck, API tests, digest tests, browser tests. The checks are advisory and do not block the merge button until the branch rule of section 9, step 15, is set.
3. The Deploy workflow (`.github/workflows/deploy.yml`) starts only after a green CI on `main`. A red CI means no deploy, shown as a grey "skipped" tick, not a red cross. Always look at CI after a merge.
4. Deploy applies new database migrations to Supabase with the `DATABASE_URL` secret. A failing migration stops everything here, before any code ships.
5. Deploy connects to the VPS with the `VPS_SSH_KEY` secret and runs `scripts/deploy-vps.sh`. The server's SSH host key is pinned in `deploy.yml` and changes only if the server is rebuilt.
6. Deploy can also be started by hand from the Actions tab (Deploy, Run workflow). That repeats steps 4 and 5, and it is how the server picks up an edited master env file.

**On the server.** Files live in `/docker/burgers-bar`. The script:

1. Ships the committed code into `src`; the previous tree stays in `src.prev`.
2. Copies the master env file `/docker/burgers-bar/.env.prod` to `src/.env.prod` and writes the short commit id to `src/DEPLOYED_SHA`.
3. Builds the three images on the box and runs, inside `src`, `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build --remove-orphans`.
4. Waits up to two minutes for the API container to report healthy and fails the deploy otherwise. Only the API container is checked.

Containers: `burgers-bar-api-1`, `burgers-bar-web-1` (nginx serving the website) and `burgers-bar-whatsapp-digest-1`. No container publishes a port. Traefik, configured at `/docker/traefik` outside this repo, terminates TLS with Let's Encrypt and routes `DEPLOY_HOST` plus `/api` to the API (stripping `/api`) and everything else to the website. SSH is key-only, user `root`. The only volume is the digest's "already sent today" marker. Containers are replaced with a short gap; there is no zero-downtime swap.

**Reading and changing the server.** Read-only on the server needs no question: `docker ps`, `docker logs <container>`, `cat /docker/burgers-bar/src/DEPLOYED_SHA`, the names-only check `grep -oE '^[A-Z_0-9]+=' /docker/burgers-bar/.env.prod`, and `grep -E '^NAME=' /docker/burgers-bar/.env.prod` for one line that is not a secret (section 4). Claude runs them as `ssh -i ~/.ssh/burgers_vps root@srv1928986.hstgr.cloud '<command>'` once the key from section 9, step 4, exists. Anything that changes the server needs a yes.

To change a line in the master env file: the owner logs in to the server (Hostinger panel: VPS, Manage, then the Terminal button at the top right of the Overview page, which logs in without a key; or `ssh -i ~/.ssh/burgers_vps root@srv1928986.hstgr.cloud` in Git Bash with the key from section 9, step 4), runs `nano /docker/burgers-bar/.env.prod`, edits the line, saves (Ctrl+O, Enter) and leaves (Ctrl+X), then runs Deploy on GitHub. Claude names the variable and says where the new value comes from. Claude never types a value.

Hand deploy from this PC: use the Deploy workflow on GitHub. The hand deploy, `./scripts/deploy-vps.sh` from the repo root in Git Bash with the private key at `~/.ssh/burgers_vps` (or `VPS_SSH_KEY=<path>` in `.env`), is for when GitHub Actions is down. It changes the live server, so ask first, and never use it for a change that carries a migration: it ships the committed `HEAD` only and does not run migrations. Rollback: there is no command. Revert the change on `main` (a new merge, the normal path) or run the script with the older commit checked out. Neither undoes a migration. `src.prev` on the server is a copy of the previous code, not a rollback button.

After every deploy, check four things: the Deploy run on GitHub is green (not grey); https://burgers.srv1928986.hstgr.cloud/api/health answers ok; `docker logs burgers-bar-whatsapp-digest-1` on the server shows the digest switch state and no crash loop; `cat /docker/burgers-bar/src/DEPLOYED_SHA` matches the merged commit.

**Where to look when something is down.**

| Symptom | Look at |
| --- | --- |
| Change merged, site unchanged | GitHub, Actions: is CI red (deploy skipped)? Did Deploy fail (migration error, SSH, health wait)? |
| Site does not open at all | Hostinger panel (is the VPS running?); `docker ps` on the server; Traefik on the box |
| Site opens, API errors | https://burgers.srv1928986.hstgr.cloud/api/health (503 = database unreachable); `docker logs burgers-bar-api-1`; the Supabase dashboard (the free plan pauses a database after 7 idle days; wake it there) |
| No digest this morning | `docker logs burgers-bar-whatsapp-digest-1`. This container has no health check, so a crash loop passes a deploy as green; its log is the only signal |
| Assistant stopped answering | OpenRouter credit balance; `docker logs burgers-bar-api-1`; the alerts the app pushes to chain admins (only while push is on) |
| Emails not arriving | The mailbox's app password; Gmail's daily sending caps |

**Two traps.**

1. Never run `docker compose up` by hand inside `src` without `--env-file .env.prod`. `DEPLOY_HOST` is then empty, Traefik's routes break and the site drops. Use the deploy script, the Deploy workflow, or the full command above.
2. Edit only the master file `/docker/burgers-bar/.env.prod`, never `src/.env.prod`. The copy in `src/` is overwritten on every deploy, so an edit there vanishes with the next merge. After editing the master file, run Deploy again so the containers pick it up.

**Migration rules** (`apps/api/drizzle/`).

1. A migration is a hand-written SQL file `NNNN_name.sql` with the next free number, statements separated by `--> statement-breakpoint`, plus an entry in `meta/_journal.json`. Update `apps/api/src/db/schema.ts` to match, by hand. `npm run db:generate` (drizzle-kit) would re-propose every hand change made since `0019`; if you use it, review every statement against the live schema before keeping it. Never `drizzle-kit push`: it changes the live tables directly and leaves no migration file, so the next deploy and the next reader cannot see what happened.
2. The journal entry goes last in the file: `idx` the next number, `version` `"7"`, `tag` the file name without `.sql`, `breakpoints` `true`, and `when` = the previous entry's `when` + 86400000 (one day). The migrator applies only entries whose `when` is greater than the last applied one; a smaller stamp is skipped silently while the deploy prints `Migrations applied.` and goes green. The last entry at handover is `0053_branch_subjects` (number `0049` does not exist, on purpose; do not fill it).
3. Never edit an applied migration. Old files are not re-checked against the database, so the edit changes nothing live and misleads the next reader. Write a new migration instead.
4. Every new table gets `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;` in its migration, like the existing tables on production. Row-level security was enabled on the live tables by hand in September 2026 and is not in the migrations; the same lockdown revoked every grant on the `public` schema from Supabase's `anon` and `authenticated` roles, also for tables created later. The app is not affected: it connects as the owner of the tables, which bypasses row-level security. Without the line, a table is open to Supabase's REST API with the anon key if a grant ever comes back, and the Supabase dashboard flags it. The owner can confirm in the dashboard (Table editor) that the new table shows "RLS enabled".
5. Verify in the database, not from the exit message. After a deploy, look for the table or column in the Supabase Table editor or SQL editor, or check that the newest row of `drizzle.__drizzle_migrations` carries your `when` as `created_at`. All pending migrations run in one transaction; one failing statement rolls back the whole batch and stops the deploy before the code ships.
6. Locally, `npm run db:migrate` applies migrations to the Docker database. On the live database only the Deploy workflow applies them; never run the migrate command against Supabase from this computer.

## 7. Phone app

Owner: nothing here until you decide on a domain and the stores (section 8), with one thing to plan now: the first APK built on your PC will not install over the current one, so every staff phone must uninstall the app and install the new file once. Plan a message to staff.

The app on phones is this same web app (`apps/web`) wrapped by Capacitor; `apps/web/android` and `apps/web/ios` are committed. App id `com.burgersbar.staff`, name "Burger's Bar". There is no custom native code.

**Baked in at build time.** A frozen copy of the website, and the API address from `apps/web/.env.mobile`: `VITE_API_BASE_URL=https://burgers.srv1928986.hstgr.cloud/api`. The `/api` suffix is load-bearing. Server-side changes reach phones at once; any visual change needs a rebuild and a reinstall. An installed app keeps the address it was built with, so a new hostname or domain means every phone reinstalls. The Android version lives in `apps/web/android/version.properties` (`versionCode=5`, `versionName=1.0.4`); bump `versionCode` for every build, including sideload builds, so phones can report which build they hold.

**Build the Android app.** Needs Android Studio (the Android SDK and a JDK; the project wants Java 21); installing it is "ask the owner first". After installing, set `JAVA_HOME` (the JDK folder) and `ANDROID_HOME` (the SDK folder) as Windows environment variables, then open a new terminal.

1. Put `google-services.json` from the Firebase console at `apps/web/android/app/google-services.json` (gitignored). Without it the build skips the Google Services plugin and push silently does not work.
2. `npm -w apps/web run sync:android` builds the website in mobile mode and copies it into the Android project.
3. Sideload APK: the repo has no script for it. It is the debug build, Gradle task `assembleDebug`, run from `apps/web/android` with the Gradle wrapper (`./gradlew assembleDebug` in Git Bash, `gradlew.bat assembleDebug` in PowerShell); the build prints where the APK landed, under `apps/web/android/app/build/outputs/`. Check `docs/mobile/android-publishing.md`. Staff downloaded the file as `burgers-bar-latest.apk` from the GitHub release tagged `apk-latest` while the repository was public; a private repository's releases need a GitHub login, so from now on host the file on a company Drive link (or a second, public, releases-only repository), keep the link the same between builds, and name the commit next to the file.
4. Store bundle: `npm -w apps/web run bundle:android` builds a signed `.aab` for Google Play and fails loudly unless `BURGERS_UPLOAD_STORE_FILE`, `BURGERS_UPLOAD_STORE_PASSWORD`, `BURGERS_UPLOAD_KEY_ALIAS` and `BURGERS_UPLOAD_KEY_PASSWORD` are set (environment or `~/.gradle/gradle.properties`).

**Signing key facts.** Nothing was ever uploaded to Google Play, so the company creates its own upload keystore when it first publishes; the agency deletes its keystore. The current sideload APK is signed with the agency machine's debug key, so a build from any other machine will not install over it: staff must uninstall first. Keep the new keystore and its passwords in the password manager; `*.jks` and `*.keystore` are gitignored. Losing it later is a support request to Google, not a click.

**Needs a Mac.** Everything iOS beyond editing the committed project: `npm -w apps/web run sync:ios` (run it on the Mac; from Windows it writes backslashes into `Package.swift`), Xcode 26 or later (App Store Connect refuses older SDKs since April 2026), the signing team, archive, upload, and the `GoogleService-Info.plist` file. iOS push cannot work today: the plugin returns an Apple token while the server sends through FCM; the fix needs an APNs key, which needs the Apple account. Details in `docs/mobile/ios-publishing.md`.

**Store publishing still needs.**

- A company-owned domain and a work email on it (owner; Apple rejects Gmail).
- A rebuild against that domain (Claude; `apps/web/.env.mobile`, then every phone reinstalls).
- A Google Play organisation account (owner; 25 USD once).
- An Apple Developer organisation account (owner; 99 USD a year, D-U-N-S number first).
- The two privacy placeholders filled (owner supplies the names, Claude edits; section 8).
- The Data safety form, a reviewer demo login, the content rating and the target audience (owner, with Claude drafting).
- The Hebrew store text brought in line with the English (Claude; `docs/mobile/store-listing.md`).
- `GoogleService-Info.plist` for iOS (owner downloads it from the Firebase console).

The store copy is in `docs/mobile/store-listing.md`, the images and screenshots in `assets/store/`, shot against a seeded demo branch so no real data appears. Google is phasing in developer verification for apps installed outside the Play Store (check the current date on Google's Android developer site). Before it applies in Israel, the company needs either a Play Store listing or a verified developer account. Put a date in the calendar.

## 8. Unfinished and known gaps

**Decisions for the owner.** One line of consequence each.

1. Keep or pause the server: section 9, step 0.
2. A domain: the company owns none. The Hostinger hostname is baked into the phone app and sits in every invite link. Cutover is `DEPLOY_HOST` in the master env file, a web rebuild, a phone rebuild and every phone reinstalls. Nothing in the stores can start without one.
3. Lease and franchise visibility: a document's audience comes from its sensitivity tier (general, internal, confidential), decided by folder and file name at sync time. Confidential documents are readable by the owner, every branch admin, the CEO, the chain manager and the finance manager, so every branch admin can read every branch's lease and franchise terms through the Knowledge page and the assistant. "No" is a small code change; "own branch only" means head office splits the lease documents per branch. Until it is decided, keep documents that branch admins must not see out of the synced folder.
4. Privacy page: the two placeholders, `[registered business name]` and `[contact email]`, in `apps/web/src/routes/privacy-content.ts`, both languages. Until they are filled, `/privacy` and `/delete-account` stay unlinked and no store listing can be submitted.
5. WhatsApp digest: on or off (`enabled` in `whatsapp_digest_settings`) and who receives it (`WHATSAPP_DIGEST_RECIPIENT`). Off means no morning summary; on spends OpenRouter credit every day and needs the paid Green API plan.
6. WhatsApp retention: raw messages are kept 3 days and summaries 10 days (`WHATSAPP_MESSAGE_RETENTION_DAYS`, `WHATSAPP_SUMMARY_RETENTION_DAYS`). This is how long staff chat text sits in the company's database.
7. WhatsApp purpose statement, a notice in each ingested group (what is stored, who reads it, for how long), and an opt-out for non-employees in those groups. The privacy page rewrite waits on this.
8. Assistant retention: how long assistant threads and the answer log are kept, and whether a WhatsApp summary quoted into a thread is removed when its source row is purged after ten days.
9. Store accounts: neither exists. Google Play 25 USD once, Apple 99 USD a year with a D-U-N-S number first (section 7).
10. OpenRouter spend: the app has no cap, only alerts (daily spend above `ASSISTANT_DAILY_SPEND_ALERT_USD`, prepaid balance below `ASSISTANT_CREDIT_ALERT_USD`), and the alerts go out only through push. Set a limit on the key in the OpenRouter dashboard.
11. Third language: Hebrew and English only today; a question in Arabic or Russian has undefined behaviour. Recommended: answer in the asker's language, keep retrieval in Hebrew.
12. Hebrew address form in answers: neutral for everyone (recommended, free), or neutral plus a preference on the Profile page.
13. Whether an app fact a person may not view stays refused when the same fact is public on the web (recommended: yes).
14. The responsible person for sexual harassment prevention, and the crisis routing text in both languages, for the assistant's sensitive-topics rules.
15. A zero-data-retention setting on OpenRouter: one paid test request to confirm the model still answers under it, and acceptance of what it does not cover (the broker's own metadata and the web-search leg).
16. The backup model: confirm `anthropic/claude-sonnet-5` as the model a failed call retries on, and whether such answers carry a muted note.
17. Whether the assistant may ever write (create a task, for example). Recommended: a few writes, each confirmed by the person every time. The largest single change to the safety posture.
18. Who may read the text of a refused or unanswered question (recommended: `super_admin` only, kept 90 days).
19. Content from head office: prep cards and equipment manuals as Drive folders; an owner per Knowledge folder; the head-office facts (legal name, address, phone, kashrut posture); branch hours and the kashrut certifier per branch, or written permission to read them from the public site; the first 40 to 60 terms of chain jargon; the menu export if menu answers are ever wanted.
20. Governance paperwork: a one-page impact assessment per AI feature, a data-security tier decision for the staff database, and whether to name a privacy contact.

**Technical gaps (for Claude).**

- Per-department document access was never built; the sensitivity tier above is all there is (`apps/api/src/assistant/document-metadata.ts`). Department-scoped folders were parked; the people `department` column is the hook for them.
- Store publishing is not done (section 7).
- iOS: project committed, never built for a device, only run in a simulator; push impossible until the Apple account and an APNs key exist; a Mac with Xcode 26 or later is required.
- Push works only while the Firebase pair is set on the server (check the names list on the server, section 6) and the phone build carried `google-services.json`; tapping a notification does not open the task yet; iOS push cannot work. The `gemini` and `groq` providers are declared alternates, not in use.
- WhatsApp: no chat-to-branch mapping (summaries are matched by group name); no "quiet day" message, by choice; the digest container has no health check.
- Spend alerts go out only through push, so without Firebase they reach nobody.
- `apps/api/eval/` holds the assistant's test questions, written from the company's own documents. Keep the repository private.
- One agency super-admin login still exists in the production database so the agency can help with the takeover. Deactivate it in section 9, step 11, once you hold your own.
- Row-level security on production was enabled by hand and is not in the migrations (sections 3 and 6).
- The Supabase free plan pauses the database after 7 idle days. The running server keeps it awake; a stopped server does not.
- The current sideload APK is debug-signed by the agency machine; the first company build will not install over it (section 7).
- CI checks do not block merging until the branch rule of section 9, step 15, is set; until then a red check is fixed by discipline, and a red CI skips the deploy silently.
- A deploy replaces the containers with a short gap. Rollback: revert the change on `main` and let Deploy run, or hand-deploy an older commit. Neither undoes a migration. `src.prev` on the server is a copy of the previous code, not a rollback button.
- Offline behaviour of the phone app is unspecified; it needs a connection.
- Assistant: per-role tool lists in the prompt are not built (every tool still checks permissions itself); no retry safety on a dropped connection, no streaming, no inline citations. The technical roadmap is `docs/assistant-research/03-roadmap.md`.
- `docs/prd.md`, `CONTEXT.md` and `docs/engineering-design.md` predate push, the 18 roles and embeddings; trust the code and this file.

## 9. First session checklist

Claude: do these in order, one at a time, and explain each in the owner's language, in plain words, before acting. The rules in section 1 apply: a yes before a merge, a Deploy, an edit to the master env file, any account setting, any spend, or installing software.

**Before the first session (owner, in a browser, no Claude).**

- A Claude subscription and Claude Code installed (section 1).
- A GitHub account created with a company email; the username sent to the agency; the transfer accepted within 24 hours of the agency's email (the email expires after that); the repository set private (Settings, General, Danger Zone, Change visibility). The reason: `apps/api/eval/` carries questions and answers written from the company's own documents.
- Before the repository goes private: download `burgers-bar-latest.apk` from the `apk-latest` release (Releases) and keep it in the password manager or the company Drive. A private repository's downloads need a GitHub login, so the old link stops working for staff.
- The keys file received in the password manager.
- A `super_admin` login for the owner: before the agency leaves, it invites the owner from the People page. The owner signs in on the live site once.

The Supabase, Google Cloud, Firebase and Drive takeovers (steps 6 to 8) need the agency. Schedule them in the first week, while it is still reachable.

0. Decide: keep the app running (do everything below) or pause it (export the database from Supabase first, then stop the containers on the VPS and cancel the plans; the phone app stops working until a server exists again; Claude guides, the owner clicks). The costs are in section 3. The rest of this list assumes keep. Claude does nothing here without a clear yes.
1. Confirm the keys file is in place. Claude checks that `.env` exists at the repo root and `apps/web/.env.local` exists, lists variable names only (never values), and runs the `DATABASE_URL` check from section 4 before any database command. If `.env` is missing, stop and get it from the password manager.
2. Run it locally (section 5). Claude installs nothing without asking, runs the steps, and the owner signs in at http://localhost:5173 and clicks through the pages.
3. Check the clone points at the transferred repository: `git remote -v`; if it shows the agency's organisation, `git remote set-url origin <new url>`. Then the staff download link: once the repository is private, the GitHub link no longer works for staff. Host the saved `burgers-bar-latest.apk` on a company Drive link (or a second, public, releases-only repository) and send staff the new link.
4. Put your own SSH key on the VPS and remove the agency's. Why: so the agency can no longer log in to the server. In this order:
   1. Claude generates the key: `ssh-keygen -t ed25519 -N "" -f ~/.ssh/burgers_vps -C burgers-deploy` (no passphrase; Deploy needs that). On Windows the two files land in `C:\Users\<you>\.ssh\`: `burgers_vps` (private, secret) and `burgers_vps.pub` (public).
   2. The owner logs in through the Hostinger panel (VPS, Manage, the Terminal button at the top right of the Overview page) and appends the one line of `burgers_vps.pub` to `/root/.ssh/authorized_keys`.
   3. Claude tests `ssh -i ~/.ssh/burgers_vps root@srv1928986.hstgr.cloud echo ok`.
   4. The owner adds the GitHub secret and runs Deploy (step 5).
   5. Only after Deploy is green, the owner removes the agency's line from `authorized_keys`.
5. Add the two GitHub Actions secrets. Owner: GitHub, the repository, Settings, Secrets and variables, Actions, New repository secret. Name `DATABASE_URL`, value the production connection string from the password manager (until step 6 changes it). Then again for `VPS_SSH_KEY`: open `burgers_vps` (the file without `.pub`) in Notepad and paste its whole text. Claude does not print it. Then run Deploy by hand (Actions, Deploy, Run workflow) and check it goes green and `/api/health` answers. From here on every change to the master env file reaches the server by running Deploy again (recipe in section 6).
6. Take over Supabase (section 3, note A; needs the agency): account, transfer, remove the agency, reset the database password, `DATABASE_URL` updated in the master env file (recipe in section 6) and the GitHub secret together, Deploy, check `/api/health`. Claude writes the exact steps; the owner does the clicks.
7. Take over the Google Cloud project and the Firebase project (needs the agency): get added as Owner, agency removed, new keys generated, old keys deleted. Claude writes the click path for the Google Cloud and Firebase consoles. For each downloaded JSON key, Claude runs `base64 -w0 key.json > key.b64` so nothing prints. The owner opens `key.b64` in Notepad, copies the one line into the master env file on the server (`GOOGLE_SERVICE_ACCOUNT_JSON`, then `FCM_SERVICE_ACCOUNT_JSON`), then deletes both files. Claude confirms with `ls` that they are gone. Then Deploy; a manual resync on the Knowledge page proves the robot still reads the folder.
8. Accept the transfer of the Drive subfolder `דרייב ישן` into the company's plain Google account (needs the agency), and check the robot still has Viewer access to the whole folder.
9. Change every key the agency ever saw: a new OpenRouter key with a credit limit (old key deleted); new Green API instance token and webhook token (also on the instance in the Green API console); the database password (step 6); the service-account keys (step 7). Each new value goes into the master env file (recipe in section 6), and into your local `.env` if you use that service locally. Claude lists the exact variable names and asks before each change on the server. Then change the password of every account the agency used (Hostinger, OpenRouter, Green API, the sender mailbox) and turn on 2-step verification. Open the knowledge-base folder's Share dialog and remove every agency address; keep the robot as Viewer. Then Deploy, and check `/api/health`, one assistant question, and `docker logs burgers-bar-whatsapp-digest-1`.
10. Set the sender mailbox: your own Gmail with 2-step verification and an app password (or Workspace), into `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` in the master env file (recipe in section 6), Deploy, then send a test invite from the People page.
11. Deactivate the agency's super-admin on the People page, now that you hold your own login. If no owner login exists, the last resort is the seed, run by the owner in their own Git Bash window, not through Claude. Claude writes the command with placeholders: `DATABASE_URL='<production string>' SEED_ADMIN_EMAIL='<you>' SEED_ADMIN_PASSWORD='<private>' npm run seed`. It adds a second super admin and leaves existing rows alone. Git Bash, not PowerShell, where the variable would stay set for every later command in that window. This is the one exception to the rule in section 4 against touching the production database from this PC.
12. Decide on the WhatsApp digest: on or off, who receives it, and that the Green API plan stays paid. The owner opens Supabase, Table editor, `whatsapp_digest_settings`, and reads `enabled`. Claude explains the columns and what each change does; the recipient is `WHATSAPP_DIGEST_RECIPIENT` in the master env file.
13. Decide on a domain. Nothing in the stores can start without one. Claude explains the cutover: `DEPLOY_HOST`, a web rebuild, `apps/web/.env.mobile`, a phone rebuild, every phone reinstalls.
14. Fill the privacy page placeholders in `apps/web/src/routes/privacy-content.ts` with the registered business name and a contact mailbox, then link `/privacy` from the app. A code change: a branch and a pull request (section 6).
15. Protect `main`. Owner: GitHub, Settings, Branches, add a rule for `main` that requires the CI checks to pass before merging. Claude explains the clicks.
16. Review the open GitHub issues (24 at handover) and section 8 with the owner and pick what matters first.

## 10. Where things are

| Path | What it is |
| --- | --- |
| `README.md`, `CONTEXT.md` | The developer front door, and the glossary of business terms (Location, Headquarters, Department, Subject, Task, Thread, Knowledge Doc); `CONTEXT.md` predates the 18 roles and push (section 8). |
| `CLAUDE.md`, `AGENTS.md` | What Claude Code reads at the start of every session: `CLAUDE.md` points to `AGENTS.md`, which points here. Put your own working rules in `AGENTS.md` when you have them. |
| `docs/readme.md` | The map of the docs folder. Start there. Every docs folder carries a `readme.md`; read it before the files. |
| `docs/prd.md`, `docs/engineering-design.md` | What the product is, and how it is built; partly out of date (section 8). |
| `docs/adr/` | The numbered decision records with their reasons; `docs/adr/readme.md` is the index. |
| `docs/features/` | Per-feature plans and test cases; `docs/features/assistant/provisioning-runbook.md` sets up the Drive robot. |
| `docs/assistant-research/`, `docs/rag-research/` | How the assistant and its retrieval were tuned and what is left (`03-roadmap.md`, `04-status.md`). |
| `docs/mobile/` | The phone app and the store guides: Android, iOS, store listing text. |
| `docs/specs/` | The design specifications of four shipped features (locations redesign, project step owners, profile page, departments and task subjects): what was decided and why. |
| `docs/design-system/`, `docs/flowchart/`, `docs/research/` | Design tokens and components, the business flowchart, early research notes. |
| `apps/api/` | The API (Fastify, Node, Postgres through Drizzle). `src/server.ts` boots it; `src/env.ts` validates the keys file; `src/routes/` the endpoints; `src/assistant/` the AI; `src/notifications/` push; `drizzle/` the migrations and `meta/_journal.json`; `eval/` the private test questions. |
| `apps/web/` | The web app (React, Vite). `src/features/` one folder per screen; `android/` and `ios/` the phone shells; `e2e/` browser tests; `.env.mobile` the phone API address. |
| `apps/whatsapp-digest/` | The daily digest job, its own container. |
| `packages/shared/` | The role model, capabilities and validation schemas both sides use (`src/index.ts`). |
| `assets/` | Brand files and the store images and screenshots (`assets/store/`). |
| `scripts/deploy-vps.sh` | The server deploy script. |
| `.github/workflows/` | `ci.yml` (the checks) and `deploy.yml` (migrate, then deploy). |
| `docker-compose.yml`, `docker-compose.prod.yml` | Local Postgres and mailpit; the three live containers and their Traefik labels. |
| `.env.example`, `.env.prod.example` | Templates for the local keys file and the server's master file, with comments and no secrets. |

## Appendix. Variable reference

Claude reads this; the owner can skip. "Secret" follows the definition in section 4.

| Variable | One line | Secret | Note |
| --- | --- | --- | --- |
| **Database** | | | |
| `DATABASE_URL` | The one Postgres connection string. Local: the Docker Postgres. Production: the Supabase session pooler, with the `sslmode` value the template shows. | yes | REQUIRED, 1 of 3 |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` | Credentials and port of the local database container; must match `DATABASE_URL`. | the password | local only, not read in production |
| **Google Drive and Google Cloud (knowledge base)** | | | |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | The robot's key file as base64, checked at boot for `client_email` and `private_key`. | yes | REQUIRED, 2 of 3; blank or malformed stops boot |
| `DRIVE_FOLDER_ID` | The id of the knowledge-base folder (the last part of its Drive URL). | no | REQUIRED, 3 of 3 |
| **Assistant (OpenRouter)** | | | |
| `ASSISTANT_PROVIDER` | `openrouter` (default), `gemini` or `groq`; only the selected provider's key is required. | no | |
| `OPENROUTER_API_KEY` | One key for answers, embeddings, web search and the digest. | yes | needed at boot while the provider is `openrouter`; blank stops boot |
| `GEMINI_API_KEY`, `GROQ_API_KEY` | Keys for the two other providers. | yes | blank is fine while the provider is `openrouter` |
| `ASSISTANT_MODEL` | The answer model. Blank or absent = the code default, `google/gemini-3.1-pro-preview`. | no | |
| `ASSISTANT_BACKUP_MODEL` | The model a failed call retries on. Line absent: `anthropic/claude-sonnet-5`. Line blank: backup off. | no | commented out in the templates |
| `ASSISTANT_WEB_SEARCH_ENGINE` | `native` or `exa`. To read the live value, use the single-line check in section 6. | no | blank stops boot: delete the line for the default `native` |
| `ASSISTANT_RATE_LIMIT_PER_USER`, `ASSISTANT_RATE_LIMIT_WINDOW_MINUTES` | Questions per person per window; defaults 20 and 10. | no | |
| `ASSISTANT_DAILY_SPEND_ALERT_USD` | A day's spend past this (default 3) pushes an alert to the chain admins. | no | |
| `ASSISTANT_CREDIT_ALERT_USD`, `ASSISTANT_EMBEDDING_MODEL`, `ASSISTANT_REASONING_MAX_TOKENS`, `COMPANY_WEBSITE_URL` | Credit floor (5 USD), embedding model (`qwen/qwen3-embedding-8b` on OpenRouter), reasoning cap (256), the public site (`https://burgersbar.co.il`). | no | not in the templates; defaults in `apps/api/src/env.ts` (credit floor, website) and in `apps/api/src/assistant/llm-client.ts` and `embedding-client.ts` (reasoning cap, embedding model) |
| **Firebase (push)** | | | |
| `FCM_PROJECT_ID` | The Firebase project id. | no | blank stops boot: delete the line to keep push off |
| `FCM_SERVICE_ACCOUNT_JSON` | The messaging key file as base64. Both lines must be present together for push to work. | yes | blank stops boot: same rule |
| **Mail** | | | |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | Local: `localhost`, `1025`, `false` (mailpit). Production: `smtp.gmail.com`, `465`, `true`. | no | |
| `SMTP_USER`, `SMTP_PASSWORD` | The sender mailbox and its app password. | yes | blank is fine locally |
| `MAIL_FROM` | The From line on outgoing mail. | no | |
| **WhatsApp (Green API) and the digest** | | | |
| `GREEN_API_URL` | The instance's API host from its console page; it differs between instances. | no | digest only; blank stops the digest |
| `GREEN_API_ID_INSTANCE` | The instance id. | no | digest only; blank stops the digest |
| `GREEN_API_TOKEN_INSTANCE` | The instance token. It sits in every request URL, which is why URLs are never logged. | yes | digest only; blank stops the digest |
| `GREEN_API_WEBHOOK_TOKEN` | The shared secret the gateway sends with every webhook; the same value is set on the instance's `webhookUrlToken`. | yes | blank = the webhook route does not exist and no messages are stored |
| `WHATSAPP_WEBHOOK_URL` | `https://<host>/api/whatsapp/webhook`; the digest compares it with what the instance reports. | no | blank = no check |
| `WHATSAPP_DIGEST_RECIPIENT` | Who receives the digest: a number (digits only, international format, no leading 0) or a group id ending `@g.us`. The keyword "סיכום" is answered only in this chat. | no | blank = the digest runs every step and sends nothing; the API then ignores the keyword and stores every group's messages. A plus sign or leading 0 stops the digest container only |
| `WHATSAPP_DIGEST_GROUPS` | Comma-separated chat ids. The API stores messages only from these groups and the digest reads only these; blank means every group the number is in, written to the database. Set it whenever the linked number is someone's personal phone; otherwise the digest reads and summarises every group that phone is in, including private ones. | no | |
| `DIGEST_FIRE_HOUR` | The Israel local hour to send; default 8. Never on Saturday, whatever the hour. | no | |
| `DIGEST_STATE_FILE` | The "already sent today" marker. | no | local only; production pins it to a volume in compose |
| `WHATSAPP_SUMMARY_MODEL` | The per-group summary model; blank = the preset `google/gemini-3.1-flash-lite`. | no | production file only |
| `WHATSAPP_MESSAGE_RETENTION_DAYS`, `WHATSAPP_SUMMARY_RETENTION_DAYS` | Raw messages are kept 3 days, summaries and digests 10 days. The first is a decision about the company's data (section 8). | no | production file only |
| **App settings (no account behind them)** | | | |
| `API_PORT` | The local listen port; default 3000. Not in the production file; Traefik talks to 3000. | no | |
| `CORS_ORIGIN`, `APP_BASE_URL` | The browser origin allowed to call the API, and the base of invite and reset links. Locally `http://localhost:5173`; in production both are derived from `DEPLOY_HOST`. | no | |
| `SESSION_TTL_DAYS`, `INVITE_TTL_HOURS`, `RESET_TTL_HOURS` | A session ends after 14 days without use; invite link 168 hours (7 days); reset link 1 hour. | no | |
| `RESET_RATE_LIMIT_PER_EMAIL`, `RESET_RATE_LIMIT_PER_IP`, `RESET_RATE_LIMIT_WINDOW_MINUTES` | Throttle on password-reset requests; 5, 20, 60. | no | |
| `TRUST_PROXY` | `true` behind Traefik, so the real client IP is read from `X-Forwarded-For`. | no | production file only |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_DISPLAY_NAME` | The first owner login, created once by `npm run seed`. Re-running never changes a stored password. Production is already seeded. | the password | not read at boot |
| **Server and deploy only** | | | |
| `DEPLOY_HOST` | The public hostname Traefik routes and certifies. Changing it, plus a web rebuild, is the domain cutover. | no | `.env.prod` only; required there |
| `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` | Target of a hand deploy from this PC, read by `scripts/deploy-vps.sh` from `.env`. Defaults: the live server, `root`, `~/.ssh/burgers_vps`. `VPS_SSH_KEY` has the same name as the GitHub secret but different content: here a file path, there the key text. | the key file | optional; not in the templates |
| `VITE_API_BASE_URL` | Where the web app sends API calls; the only value the browser bundle sees. Lives in `apps/web/.env.local` (local, `http://localhost:3000`) and `apps/web/.env.mobile` (phones, the server hostname plus `/api`); the website on the server is built with `/api`. | no | not in `.env` |
