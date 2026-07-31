# Gmail SMTP for outbound transactional email (invite and password-reset)

Status: accepted. Fills the email-delivery gap left when ADR-0006 removed Supabase: ADR-0005
sent the invite and reset emails through Supabase Auth's built-in mailer, and ADR-0006 owns
the token primitives those emails carry but left the transport unstated. This does not
supersede either — the invite-only flow, the reset flow, and the shared token primitive all
stand; it only fixes how the mail leaves the system. It arose from a design decision taken while scoping the
email-invite feature, not from a grilling ticket, and there is no upstream issue behind it.
Credential handling makes it security-sensitive under rule 5.

## Context

Two flows send outbound email: the invite link that lands a new user on the set-password
screen (ADR-0005, ADR-0006) and the password-reset link (ADR-0006). Both are transactional —
one message to one known recipient in response to an action — not marketing or notification
mail. Under ADR-0005 they rode Supabase Auth's bundled mailer; with Supabase gone (ADR-0006),
the owned API has to send them itself, and nothing yet says through what.

The client does not own a domain. That rules out, for now, the domain-verified sending
(SPF/DKIM on a branded address) that a transactional provider needs to reach its best
deliverability. The volume is small — a handful of staff invites and the occasional reset
across a few locations — so the mechanism should be the least machinery that delivers
reliably at that scale, chosen delivery-first per the operating standard's right-sizing.

## Decision

Send transactional email over Gmail SMTP from a dedicated Google account.

- Transport: `smtp.gmail.com`, port 587 with STARTTLS.
- Credential: 2-Step Verification enabled on the account, and a Google App Password used as
  the SMTP secret — not the account password. The App Password is held as a secret / env var
  on the API and never committed.
- Sender: a dedicated Google account owned by the project, not a staff member's personal
  mailbox, so App Password rotation and the daily cap never entangle a person's own mail. The
  From address is that account's `…@gmail.com`.
- Seam: the API sends through a thin, transport-agnostic mailer interface (compose message →
  hand to a send port), with Gmail SMTP behind it as the one implementation. The invite and
  reset services depend on the interface, not on SMTP directly, so the provider can be swapped
  without touching either flow.

## Considered options

A transactional provider — Resend, Postmark, or Amazon SES — with single-sender verification
was the main alternative and is the better long-run answer. It authenticates with an API key
rather than a mailbox credential, is built for app-sent mail, and lifts deliverability. But
without a domain it would still send from a bare, unbranded address, so most of its
deliverability edge is unrealised today, and it adds a vendor and an account to stand up for
volume a Gmail account already covers. Deferred, not rejected: when a domain is acquired this
is the thing to move to, and the mailer seam is what keeps that move contained.

Domain-verified sending on a branded address was not an option — there is no domain to verify.

A personal staff Gmail account was rejected in favour of a dedicated one: the App Password
lifecycle and the daily send cap are the app's operational concerns and should not sit on an
individual's personal mailbox.

## Consequences

Gmail's free tier caps sending at roughly 500 recipients per day. That is comfortable for
invites and resets at this scale, but it is a ceiling on this path: no bulk or notification
mail is ever routed through it. This aligns with the PRD, which already excludes email
notifications from v1 (in-app badge only) — the Gmail path is for invite and reset only.

Deliverability is best-effort from a bare Gmail address; an invite may occasionally land in a
recipient's spam. Acceptable for staff who are expecting the invite, and the non-enumerating
reset response (ADR-0006) is unaffected by where the mail lands.

The App Password is tied to the sending account's 2FA: if that account's password is changed
or 2FA is reset, the App Password is invalidated and sending breaks until a new one is issued.
This is an operational note for whoever owns the account, and the credential lives in the same
secret-handling discipline as the rest of the API's secrets.

The mailer interface is the hedge against the one-way-door risk here being low: swapping Gmail
SMTP for a transactional provider once a domain exists is a change behind the seam, not a
rewrite of the invite or reset flows. Revisit this ADR when a domain is acquired.
