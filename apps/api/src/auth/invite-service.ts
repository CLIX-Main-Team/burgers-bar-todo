import type { PreferredLanguage, Role } from '@burgers/shared'
import type { Mailer } from './mailer.js'
import type { PasswordHasher } from './password.js'
import type { Principal } from './principal.js'
import type { AuthRepository, UserRow } from './repository.js'
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

export interface InviteService {
  createInvite(principal: Principal, input: CreateInviteInput): Promise<CreateInviteResult>
  // Returns a fresh session bearer on success, or undefined for every failure — an
  // unknown/expired/used token, or a user no longer invited — so the route answers all
  // of them alike and leaks nothing about which branch was taken.
  acceptInvite(input: AcceptInviteInput): Promise<string | undefined>
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
// - An admin may invite any role to any Location. An admin invitee has no Location
//   (its column is null); any other role needs one, and its absence is `invalid`.
// - A manager may create only employee invites, and only for their own Location. Any
//   other role, or a Location other than their own, is `forbidden`.
// - No other role reaches here (the route guard admits only admin and manager).
function resolveBakedFields(
  principal: Principal,
  input: CreateInviteInput,
): { role: Role; locationId: string | null } | { reason: 'forbidden' | 'invalid' } {
  if (principal.role === 'admin') {
    if (input.role === 'admin') {
      return { role: 'admin', locationId: null }
    }
    if (!input.locationId) {
      return { reason: 'invalid' }
    }
    return { role: input.role, locationId: input.locationId }
  }

  if (principal.role === 'manager') {
    if (input.role !== 'employee') {
      return { reason: 'forbidden' }
    }
    if (!principal.locationId) {
      return { reason: 'forbidden' }
    }
    // A manager targeting any Location but their own is refused, not silently
    // redirected (TC-INV-05); an omitted Location defaults to their own.
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
      const rawToken = await tokens.issue(user.id, 'invite', config.inviteTtlMs)
      const link = `${config.appBaseUrl}/accept?token=${rawToken}`
      await mailer.send({
        to: user.email,
        subject: "You've been invited to Burgers Bar",
        text: `You have been invited to Burgers Bar. Open this link to set your password and sign in:\n\n${link}\n\nThis link expires in about a week.`,
      })

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
  }
}
