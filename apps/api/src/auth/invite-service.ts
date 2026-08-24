import { type PreferredLanguage, type Role, isChainAdmin } from '@burgers/shared'
import type { Mailer } from './mailer.js'
import type { PasswordHasher } from './password.js'
import type { Principal } from './principal.js'
import type { AuthRepository, InviteActionScope, UserRow } from './repository.js'
import type { SessionService } from './sessions.js'
import type { TokenService } from './tokens.js'

// The invite/provisioning service (#31, ADR-0005, ADR-0007): create an invite enforced
// from the acting principal — never trusting client-supplied role or Location — and
// accept it, setting a password and signing the recipient straight in. Create writes the
// pending user immediately, mints a single-use invite token, and mails the one-time link;
// accept validates the token, activates the user, and issues a session. Resend and revoke
// are #32 and reuse the same token primitive.

export interface InviteServiceConfig {
  // The invite token lifetime (INVITE_TTL_HOURS; ~1 week, ADR-0006/0010).
  inviteTtlMs: number
  // Public base URL the app is reached at, used to build the one-time accept link.
  appBaseUrl: string
}

// Create refuses in three distinguishable ways: `forbidden` when the principal may not
// create this role/Location pair at all (a manager reaching past their remit), `invalid`
// when the request is malformed for the principal's own remit (an admin inviting a
// located role with no Location), and `conflict` when the email is already taken. The
// route maps these to 403, 400, and 409.
export type CreateInviteResult =
  | { ok: true; user: UserRow }
  | { ok: false; reason: 'forbidden' | 'invalid' | 'conflict' }

// Resend and revoke answer with one of two outcomes: `ok`, or `not_found` for every
// case where there is no pending invite this principal may act on — an unknown id, a
// user who is no longer invited, or an invite outside the principal's remit — so the
// route maps all three to one non-enumerating 404 and never confirms an out-of-scope
// row exists.
export type InviteActionOutcome = 'ok' | 'not_found'

export interface InviteService {
  createInvite(principal: Principal, input: CreateInviteInput): Promise<CreateInviteResult>
  // Returns a fresh session bearer on success, or undefined for every failure — an
  // unknown/expired/used token, or a user no longer invited — so the route answers all
  // of them alike and leaks nothing about which branch was taken.
  acceptInvite(input: AcceptInviteInput): Promise<string | undefined>
  // Reissue an invite: invalidate the prior token and mail a fresh one-time link, so the
  // old link stops working and the new one accepts (story 9). Only a pending invite the
  // principal may act on is touched.
  resendInvite(principal: Principal, userId: string): Promise<InviteActionOutcome>
  // Cancel an invite: invalidate the token and remove the pending user, so the link is
  // rejected afterward and the user is gone from the list (story 10). Only a pending
  // invite the principal may act on is touched.
  revokeInvite(principal: Principal, userId: string): Promise<InviteActionOutcome>
}

export interface CreateInviteInput {
  email: string
  displayName: string
  role: Role
  locationId?: string | null
}

export interface AcceptInviteInput {
  token: string
  password: string
  preferredLanguage: PreferredLanguage
}

// Resolve the role and Location to bake into the invite from the acting principal
// (ADR-0007), never from the request body:
//
// - An admin (either admin role) may invite any role to any Location. An admin-level invitee
//   has no Location (its column is null); any other role needs one, and its absence is
//   `invalid`.
// - A manager may create only employee invites, and only for their own Location. Any
//   other role, or a Location other than their own, is `forbidden`.
// - No other role reaches here (the route guard admits only admin and manager).
function resolveBakedFields(
  principal: Principal,
  input: CreateInviteInput,
): { role: Role; locationId: string | null } | { reason: 'forbidden' | 'invalid' } {
  if (isChainAdmin(principal.role)) {
    if (isChainAdmin(input.role)) {
      return { role: input.role, locationId: null }
    }
    if (!input.locationId) {
      return { reason: 'invalid' }
    }
    return { role: input.role, locationId: input.locationId }
  }

  // Any branch-holding role, not `role === 'manager'` (2026-08-24): the tier-one guard is a
  // capability the owner may widen, and a widened role gets the manager lane's rule — employee
  // invites only, own branch only. Identical behavior under the default switches.
  if (principal.locationId) {
    if (input.role !== 'employee') {
      return { reason: 'forbidden' }
    }
    // Targeting any Location but their own is refused, not silently redirected (TC-INV-05);
    // an omitted Location defaults to their own.
    if (input.locationId != null && input.locationId !== principal.locationId) {
      return { reason: 'forbidden' }
    }
    return { role: 'employee', locationId: principal.locationId }
  }

  return { reason: 'forbidden' }
}

export function createInviteService(
  repo: AuthRepository,
  tokens: TokenService,
  mailer: Mailer,
  hasher: PasswordHasher,
  sessions: SessionService,
  clock: { now(): Date },
  config: InviteServiceConfig,
): InviteService {
  // Mint a fresh single-use invite token for a pending user and mail the one-time link.
  // The raw token exists outside the DB exactly once, here in the link (ADR-0006); only
  // its hash is stored. Shared by create and resend so both build the identical message.
  const issueAndMailInvite = async (user: UserRow): Promise<void> => {
    const rawToken = await tokens.issue(user.id, 'invite', config.inviteTtlMs)
    const link = `${config.appBaseUrl}/accept?token=${rawToken}`
    await mailer.send({
      to: user.email,
      subject: "You've been invited to Burgers Bar",
      text: `You have been invited to Burgers Bar. Open this link to set your password and sign in:\n\n${link}\n\nThis link expires in about a week.`,
    })
  }

  // The remit for a by-id invite action, read from the acting principal (ADR-0007): the
  // repository bakes it into the query, so an out-of-scope id resolves nothing.
  const actionScope = (principal: Principal): InviteActionScope => ({
    role: principal.role,
    locationId: principal.locationId,
  })

  return {
    createInvite: async (principal, input) => {
      const baked = resolveBakedFields(principal, input)
      if ('reason' in baked) {
        return { ok: false, reason: baked.reason }
      }

      const now = clock.now()
      const user = await repo.createInvitedUser({
        email: input.email,
        displayName: input.displayName,
        role: baked.role,
        locationId: baked.locationId,
        now,
      })
      // The email is already taken (case-insensitively). No token is minted and no mail
      // goes out — re-inviting an existing address is a resend concern (#32), not a
      // second user.
      if (!user) {
        return { ok: false, reason: 'conflict' }
      }

      // Mint the single-use invite token and carry its raw value in the link exactly
      // once — it is never stored, only its hash is (ADR-0006).
      await issueAndMailInvite(user)

      return { ok: true, user }
    },

    acceptInvite: async ({ token, password, preferredLanguage }) => {
      // Spend the token first (atomic single-use); an unknown, expired, or already-used
      // token stops here with no user touched.
      const userId = await tokens.consume(token, 'invite')
      if (!userId) return undefined

      const passwordHash = await hasher.hash(password)
      const user = await repo.activateInvitedUser({
        userId,
        passwordHash,
        preferredLanguage,
        now: clock.now(),
      })
      // The token resolved to a user who is no longer invited (already accepted, or
      // deactivated): nothing to activate, and no session issued.
      if (!user) return undefined

      // Signed straight in — the recipient gets a session with no separate login step.
      return sessions.issue(user.id)
    },

    resendInvite: async (principal, userId) => {
      // Resolve the pending invite within the principal's remit; an unknown id, an
      // already-accepted user, or an out-of-scope invite all read as no invite here.
      const user = await repo.findInvitedUserInScope(userId, actionScope(principal))
      if (!user) return 'not_found'

      // Invalidate the prior link before minting the new one, so the old token is dead
      // the instant the fresh one is issued and there is never a window with two live
      // links (story 9). Then mail the replacement one-time link.
      await repo.invalidateInviteTokens(user.id, clock.now())
      await issueAndMailInvite(user)
      return 'ok'
    },

    revokeInvite: async (principal, userId) => {
      // Delete the pending user within the principal's remit; the token cascades away
      // with the row, so the link is rejected afterward (story 10). A miss — unknown id,
      // active user, or out-of-scope — removes nothing and is reported as not-found.
      const removed = await repo.revokeInviteInScope(userId, actionScope(principal))
      return removed ? 'ok' : 'not_found'
    },
  }
}
