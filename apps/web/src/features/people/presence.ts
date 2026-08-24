import type { UserSummary } from '@burgers/shared'

// Presence for the People roster (round 12): who is using the app right now, and how long
// ago everyone else put it down. Derived entirely from `lastSeenAt`, which the API stamps on
// the authenticated path — there is no separate heartbeat to keep alive and no `online`
// boolean from the server, which would be stale by the age of the response and would throw
// away the answer that matters once someone is away.
//
// Pure over (user, now) so every boundary is reasonable in a unit test without faking a clock.

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const MONTH_MS = 30 * DAY_MS

// How recently someone must have used the app to read as "Online". The shell re-reads the
// board every 60s while the app is open (tasks/unseen.ts) and the API restamps last_seen_at
// at most once a minute, so an active person touches this value about once a minute; five
// minutes leaves four missed beats of headroom, which is what a phone on restaurant wifi
// needs before it is wrongly called away. Deliberately not longer — "Online" has to mean
// reachable NOW or a manager stops believing it.
export const ONLINE_WINDOW_MS = 5 * MINUTE_MS

export type Presence =
  | { kind: 'online' }
  | { kind: 'ago'; value: number; unit: Intl.RelativeTimeFormatUnit }
  | { kind: 'never' }

export function presenceOf(
  user: Pick<UserSummary, 'status' | 'lastSeenAt'>,
  now: number,
): Presence {
  if (user.lastSeenAt === null) {
    return { kind: 'never' }
  }
  const seenAt = Date.parse(user.lastSeenAt)
  if (Number.isNaN(seenAt)) {
    return { kind: 'never' }
  }

  const elapsed = now - seenAt

  // Only an active account can be online. A deactivated user's sessions are revoked the
  // instant they are cut off (ADR-0006), so they cannot possibly be using the app — but
  // their final stamp can still be seconds old, and reporting the person you just removed
  // as "Online" is the one reading of this column nobody would trust. They fall through to
  // the elapsed-time branch, which is genuinely useful: it says when access last got used.
  // A negative elapsed is clock skew on the reader's device, not time travel; someone whose
  // stamp is "in the future" is plainly here.
  if (elapsed < ONLINE_WINDOW_MS && user.status === 'active') {
    return { kind: 'online' }
  }

  if (elapsed < HOUR_MS) {
    return { kind: 'ago', value: Math.floor(elapsed / MINUTE_MS), unit: 'minute' }
  }
  if (elapsed < DAY_MS) {
    return { kind: 'ago', value: Math.floor(elapsed / HOUR_MS), unit: 'hour' }
  }
  if (elapsed < MONTH_MS) {
    return { kind: 'ago', value: Math.floor(elapsed / DAY_MS), unit: 'day' }
  }
  return { kind: 'ago', value: Math.floor(elapsed / MONTH_MS), unit: 'month' }
}

// "5 minutes ago" / "לפני 5 דקות". Intl carries the plural rules and the idiom both, which is
// why presence formats through it rather than through message strings: Hebrew renders two
// days ago as שלשום, its own single word for it, which no plural rule the catalogue could
// hold would ever have produced. `numeric: 'auto'` is what unlocks that, and what turns
// -1 day into "yesterday" rather than "1 day ago".
export function formatAgo(presence: Extract<Presence, { kind: 'ago' }>, locale: string): string {
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
    -presence.value,
    presence.unit,
  )
}
