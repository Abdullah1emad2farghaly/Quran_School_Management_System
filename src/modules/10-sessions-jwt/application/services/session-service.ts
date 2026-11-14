import { AppError, SystemClock, type Clock, type TransactionContext, type UnitOfWork } from '../../../00-shared-kernel/public';
import type { OutboxService } from '../../../06-domain-events-outbox/public';
import { assertPasswordPolicy, tryNormalizePhone, type IdentityService, type PasswordHasher } from '../../../08-identity-core/public';
import { isAssignableRole, type RoleService } from '../../../09-roles-permissions/public';
import { AuthSession } from '../../domain/entities/auth-session';
import { RefreshTokenRecord } from '../../domain/entities/refresh-token-record';
import { sessionError } from '../../domain/errors/session-errors';
import { MAX_ACTIVE_SESSIONS, firstFreeSlot } from '../../domain/value-objects/session-policy';
import type { SessionRevokeReason } from '../../domain/value-objects/session-revoke-reason';
import type { ActiveRoleResult, AuthPrincipal, AuthResult } from '../dto/auth-result';
import type { DeviceSessionListDto } from '../dto/device-session-dto';
import { effectiveActiveRole } from '../../domain/services/active-role';
import type { ManagedSchoolResolver } from '../ports/managed-school-resolver';
import type { SessionRepository } from '../ports/session-repository';
import type { AccessTokenService, RefreshTokenGenerator, RefreshTokenHasher } from '../ports/token-ports';

export interface SessionServiceDeps {
  readonly repository: SessionRepository;
  readonly identity: Pick<IdentityService, 'findByPhone' | 'findById' | 'verifyPassword' | 'changePassword'>;
  readonly roles: Pick<RoleService, 'listActiveRoles'>;
  /** Optional: supplies `schoolId` in the login/refresh answer. Without it `schoolId` is always null. */
  readonly managedSchools?: ManagedSchoolResolver;
  readonly accessTokens: AccessTokenService;
  readonly refreshTokenHasher: RefreshTokenHasher;
  readonly refreshTokenGenerator: RefreshTokenGenerator;
  /** Used only to spend the same time on unknown phones as on known ones (timing-safe login). */
  readonly passwordHasher: PasswordHasher;
  readonly unitOfWork: UnitOfWork;
  readonly outbox: OutboxService;
  readonly clock?: Clock;
}

/** Racing logins of one account (unique-slot violations and InnoDB deadlocks) are retried this many times before a retryable 409 is returned. */
const MAX_LOGIN_ATTEMPTS = 5;
const DEFAULT_EXPIRY_BATCH = 100;
const DEFAULT_EXPIRY_MAX_BATCHES = 10;
const MAX_REFRESH_TOKEN_LENGTH = 200;

type RefreshOutcome =
  | { kind: 'ok'; session: AuthSession; rawToken: string; token: RefreshTokenRecord; userId: string }
  | { kind: 'failed'; code: 'REFRESH_TOKEN_INVALID' | 'REFRESH_TOKEN_EXPIRED' | 'REFRESH_TOKEN_REUSED' | 'SESSION_REVOKED' | 'ACCOUNT_INACTIVE' };

/**
 * Public application contract of Module 10 (Sessions & JWT): authentication only.
 * Who may do what (roles, permissions, scope, ownership) is decided later by Module 12.
 *
 * Rules implemented (Master Specification §25):
 *  - access token 15 minutes; refresh token 30 days, opaque, stored only as a keyed hash;
 *  - refresh tokens are rotated on every refresh; reusing a rotated token is rejected AND revokes the
 *    session (the user must log in again);
 *  - up to THREE active sessions per account (approved amendment, every role), each with its own slot, tokens and refresh lifecycle;
 *    a new login NEVER revokes another session, and a 4th login is refused (SESSION_LIMIT_REACHED) after the password was verified;
 *  - a session whose refresh token expired no longer counts: it is revoked (SESSION_EXPIRED) at login and by a periodic job;
 *  - logout revokes only the current session; logout-all, deactivation and password reset revoke all sessions; changing the password
 *    revokes every OTHER session; "My devices" lists the sessions and revokes one selected session;
 *  - a revoked session invalidates its access tokens at once because every authenticated request checks the session.
 */
export class SessionService {
  private readonly repository: SessionRepository;
  private readonly identity: SessionServiceDeps['identity'];
  private readonly roles: SessionServiceDeps['roles'];
  private readonly managedSchools: ManagedSchoolResolver | undefined;
  private readonly accessTokens: AccessTokenService;
  private readonly hasher: RefreshTokenHasher;
  private readonly generator: RefreshTokenGenerator;
  private readonly passwordHasher: PasswordHasher;
  private readonly unitOfWork: UnitOfWork;
  private readonly outbox: OutboxService;
  private readonly clock: Clock;
  private dummyHash: Promise<string> | undefined;

  constructor(deps: SessionServiceDeps) {
    this.repository = deps.repository;
    this.identity = deps.identity;
    this.roles = deps.roles;
    this.managedSchools = deps.managedSchools;
    this.accessTokens = deps.accessTokens;
    this.hasher = deps.refreshTokenHasher;
    this.generator = deps.refreshTokenGenerator;
    this.passwordHasher = deps.passwordHasher;
    this.unitOfWork = deps.unitOfWork;
    this.outbox = deps.outbox;
    this.clock = deps.clock ?? new SystemClock();
  }

  /**
   * Phone + password -> new session. Unknown phone, malformed phone and wrong password all give the same
   * INVALID_CREDENTIALS (no account enumeration). The inactive-account error is only shown after the
   * password was verified, so SESSION_LIMIT_REACHED is only ever shown to someone who knows the password. No existing session is revoked
   * to make room (expired ones are cleaned up first). `deviceLabel` is the safe device description for "My devices".
   */
  async login(input: { phone: unknown; password: unknown; deviceLabel?: string | null }): Promise<AuthResult> {
    const phone = typeof input.phone === 'string' ? tryNormalizePhone(input.phone) : undefined;
    const password = typeof input.password === 'string' ? input.password : undefined;
    const user = phone ? await this.identity.findByPhone(phone) : undefined;

    if (!user || password === undefined) {
      await this.spendHashingTime(password ?? '');
      throw sessionError('INVALID_CREDENTIALS');
    }
    if (!(await this.identity.verifyPassword(user.id, password))) throw sessionError('INVALID_CREDENTIALS');
    if (!user.isActive) throw sessionError('ACCOUNT_INACTIVE');

    // Approved rule: an account with exactly ONE role starts its session already acting as it; with several roles the session starts with no
    // active role and the user chooses (switch-role). Never an arbitrary pick.
    const roles = await this.roles.listActiveRoles(user.id);
    const issued = await this.startSession(user.id, input.deviceLabel ?? null, roles.length === 1 ? (roles[0] as string) : null);
    return this.buildResult({ userId: user.id, phone: user.phone, mustChangePassword: user.mustChangePassword }, issued.session, issued.rawToken, issued.token);
  }

  /**
   * Exchanges a refresh token for a new access token AND a new refresh token (rotation). The presented token
   * is revoked. Presenting an already-rotated token is a security violation: it is rejected and the session
   * is revoked (REFRESH_TOKEN_REUSE).
   */
  async refresh(rawRefreshToken: unknown): Promise<AuthResult> {
    if (typeof rawRefreshToken !== 'string' || rawRefreshToken === '' || rawRefreshToken.length > MAX_REFRESH_TOKEN_LENGTH) {
      throw sessionError('REFRESH_TOKEN_INVALID');
    }
    const tokenHash = this.hasher.hash(rawRefreshToken);

    // Decisions are returned (not thrown) so a reuse detection can COMMIT the session revocation first.
    const outcome = await this.unitOfWork.run<RefreshOutcome>(async (tx) => {
      const probe = await this.repository.findRefreshTokenByHash(tokenHash, tx);
      if (!probe) return { kind: 'failed', code: 'REFRESH_TOKEN_INVALID' };

      // Lock order: session, then token. Both are re-read under lock; the probe is only used to find the session.
      const session = await this.repository.lockSession(probe.sessionId, tx);
      const token = await this.repository.lockRefreshToken(probe.id, tx);
      if (!session || !token) return { kind: 'failed', code: 'REFRESH_TOKEN_INVALID' };

      if (token.isRevoked) {
        if (!token.wasRotated) return { kind: 'failed', code: 'SESSION_REVOKED' }; // revoked together with its session
        if (session.isActive) await this.endSession(session, 'REFRESH_TOKEN_REUSE', tx);
        return { kind: 'failed', code: 'REFRESH_TOKEN_REUSED' };
      }
      if (!session.isActive) return { kind: 'failed', code: 'SESSION_REVOKED' };

      const now = this.clock.now();
      if (token.isExpired(now)) return { kind: 'failed', code: 'REFRESH_TOKEN_EXPIRED' };

      const user = await this.identity.findById(session.userId, tx);
      if (!user || !user.isActive) {
        await this.endSession(session, 'USER_DEACTIVATED', tx);
        return { kind: 'failed', code: 'ACCOUNT_INACTIVE' };
      }

      const rawToken = this.generator.generate();
      const next = RefreshTokenRecord.issue({
        sessionId: session.id,
        userId: session.userId,
        tokenHash: this.hasher.hash(rawToken),
        clock: this.clock,
      });
      token.revoke(now, next.id);
      await this.repository.updateRefreshToken(token, tx);
      await this.repository.insertRefreshToken(next, tx);
      return { kind: 'ok', session, rawToken, token: next, userId: user.id };
    });

    if (outcome.kind === 'failed') throw sessionError(outcome.code);
    const user = await this.identity.findById(outcome.userId);
    if (!user) throw sessionError('SESSION_REVOKED');
    return this.buildResult({ userId: user.id, phone: user.phone, mustChangePassword: user.mustChangePassword }, outcome.session, outcome.rawToken, outcome.token);
  }

  /**
   * Verifies an access token for a protected request. Besides the signature and the 15-minute expiry, the
   * SESSION must still be active and the user active, so logout, replacement by a new login and deactivation
   * take effect immediately, not after the token expires.
   */
  async authenticate(accessToken: unknown): Promise<AuthPrincipal> {
    if (typeof accessToken !== 'string' || accessToken === '') throw sessionError('AUTHENTICATION_REQUIRED');
    const verified = this.accessTokens.verify(accessToken, this.clock.now());
    if (!verified.ok) throw sessionError(verified.reason === 'expired' ? 'ACCESS_TOKEN_EXPIRED' : 'ACCESS_TOKEN_INVALID');

    const { userId, sessionId } = verified.claims;
    const session = await this.repository.findSessionById(sessionId);
    if (!session || session.userId !== userId || !session.isActive) throw sessionError('SESSION_REVOKED');

    const user = await this.identity.findById(userId);
    if (!user || !user.isActive) throw sessionError('ACCOUNT_INACTIVE');
    // The active role is read from the PERSISTED session on every request (the access token carries no role), so a role switch takes effect at once
    // and an old token can never keep acting as the previous role. It is checked against the account's CURRENT roles: a revoked role is never active.
    const activeRole = effectiveActiveRole(session.activeRole, await this.roles.listActiveRoles(userId));
    return { userId, sessionId, mustChangePassword: user.mustChangePassword, activeRole };
  }

  /**
   * The authenticated session chooses the role it acts as. ONLY this session changes: no other session is touched or revoked, no token is rotated
   * (authorization reads the persisted active role on every request, so the previous role stops authorizing immediately), and it does not count as a
   * new session. One transaction: lock the session, check it is still active and unexpired, check the role against the account's CURRENT assignments,
   * persist. Concurrent switches of the same session are serialized by the session lock. Choosing the role already active is a no-op (idempotent).
   */
  async switchRole(userId: string, sessionId: string, requestedRole: unknown): Promise<ActiveRoleResult> {
    if (typeof requestedRole !== 'string' || !isAssignableRole(requestedRole)) throw sessionError('ROLE_NOT_ASSIGNED');
    const role = requestedRole;
    const roles = await this.unitOfWork.run(async (tx) => {
      const session = await this.repository.lockSession(sessionId, tx);
      if (!session || session.userId !== userId || !session.isActive) throw sessionError('SESSION_REVOKED');
      const token = await this.repository.lockActiveRefreshTokenBySession(session.id, tx);
      if (!token || token.isExpired(this.clock.now())) throw sessionError('SESSION_REVOKED');

      const assigned = await this.roles.listActiveRoles(userId, tx);
      if (!assigned.includes(role)) throw sessionError('ROLE_NOT_ASSIGNED');
      if (session.activeRole !== role) {
        session.selectRole(role);
        await this.repository.updateSession(session, tx);
      }
      return assigned;
    });
    return { roles, activeRole: role, schoolId: (await this.managedSchools?.findManagedSchoolId(userId)) ?? null };
  }

  /**
   * The authenticated user changes their own password: the CURRENT password must be right and the new one must differ and follow the
   * password policy (4-12 characters). It is also the way out of the mandatory first-login password change (Module 08 clears the flag).
   * Approved rule: the session that made the change stays active and EVERY OTHER active session of the account is revoked
   * (PASSWORD_CHANGED, one AuthSessionRevoked each), in the same transaction as the password change. No token is reissued.
   */
  async changePassword(userId: string, sessionId: string, input: { currentPassword: unknown; newPassword: unknown }): Promise<void> {
    assertPasswordPolicy(input.newPassword);
    if (typeof input.currentPassword !== 'string' || !(await this.identity.verifyPassword(userId, input.currentPassword))) {
      throw sessionError('CURRENT_PASSWORD_INCORRECT');
    }
    if (input.newPassword === input.currentPassword) throw sessionError('NEW_PASSWORD_SAME_AS_CURRENT');
    await this.unitOfWork.run(async (tx) => {
      await this.identity.changePassword(userId, input.newPassword as string, tx);
      await this.revokeUserSessions(userId, 'PASSWORD_CHANGED', tx, sessionId);
    });
  }

  /** Logout of the current session ONLY; the account's other sessions stay valid. Idempotent. */
  async logout(sessionId: string): Promise<void> {
    await this.unitOfWork.run(async (tx) => {
      const session = await this.repository.lockSession(sessionId, tx);
      if (session?.isActive) await this.endSession(session, 'LOGOUT', tx);
    });
  }

  /** Logout of ALL the user's sessions (up to three). Idempotent. */
  async logoutAll(userId: string): Promise<void> {
    await this.revokeAllForUser(userId, 'LOGOUT_ALL');
  }

  /**
   * Revokes every active session of a user and returns how many were revoked (one AuthSessionRevoked each). Used by logout-all, by the
   * UserDeactivated handler, and by Module 11 after a password reset (`PASSWORD_RESET`). Idempotent.
   */
  async revokeAllForUser(userId: string, reason: SessionRevokeReason, tx?: TransactionContext): Promise<number> {
    return tx ? this.revokeUserSessions(userId, reason, tx) : this.unitOfWork.run((t) => this.revokeUserSessions(userId, reason, t));
  }

  /** "My devices": the caller's active, unexpired sessions (never any token or secret), oldest first. */
  async listDevices(userId: string, currentSessionId: string): Promise<DeviceSessionListDto> {
    const views = await this.repository.listActiveSessionViews(userId, this.clock.now());
    return {
      maxActiveSessions: MAX_ACTIVE_SESSIONS,
      items: views.map((v) => ({
        id: v.session.id,
        deviceLabel: v.session.deviceLabel,
        createdAt: v.session.createdAt,
        lastActiveAt: v.lastActiveAt,
        expiresAt: v.expiresAt,
        isCurrent: v.session.id === currentSessionId,
      })),
    };
  }

  /**
   * "My devices": revokes ONE selected session of the caller's account (DEVICE_REVOKED; LOGOUT when it is the caller's own session).
   * The other sessions stay valid. A session that does not exist, belongs to another account or has already ended answers the same
   * SESSION_NOT_FOUND, so ids of other accounts cannot be probed.
   */
  async revokeDevice(userId: string, targetSessionId: string, currentSessionId: string): Promise<void> {
    if (typeof targetSessionId !== 'string' || targetSessionId === '') throw sessionError('SESSION_NOT_FOUND');
    await this.unitOfWork.run(async (tx) => {
      const session = await this.repository.lockSession(targetSessionId, tx);
      if (!session || session.userId !== userId || !session.isActive) throw sessionError('SESSION_NOT_FOUND');
      await this.endSession(session, targetSessionId === currentSessionId ? 'LOGOUT' : 'DEVICE_REVOKED', tx);
    });
  }

  /**
   * Periodic cleanup: revokes active sessions whose current refresh token has expired (SESSION_EXPIRED, one AuthSessionRevoked each), so
   * the slot is freed and dependent modules can clean up. Idempotent and concurrency-safe: each session is re-checked under its own lock
   * in its own transaction, a session that was refreshed or ended meanwhile is left alone, and one failing session never blocks the rest.
   */
  async expireSessions(options: { limit?: number; maxBatches?: number } = {}): Promise<{ expired: number; failed: number }> {
    const limit = options.limit ?? DEFAULT_EXPIRY_BATCH;
    const maxBatches = options.maxBatches ?? DEFAULT_EXPIRY_MAX_BATCHES;
    let expired = 0;
    let failed = 0;
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const ids = await this.repository.findExpiredActiveSessionIds(this.clock.now(), limit);
      if (ids.length === 0) break;
      let progressed = 0;
      for (const id of ids) {
        try {
          if (await this.unitOfWork.run((tx) => this.expireOne(id, tx))) {
            expired += 1;
            progressed += 1;
          }
        } catch {
          failed += 1;
        }
      }
      if (ids.length < limit || progressed === 0) break;
    }
    return { expired, failed };
  }

  // ---------------------------------------------------------------------------------------------

  /**
   * Starts a NEW session in the lowest free slot. One transaction: lock the account's active sessions, release the expired ones, pick a free
   * slot, insert. Nothing existing is revoked to make room. Two simultaneous logins are made safe by the database: the unique
   * `(user_id, slot)` index (and the 1..3 CHECK) lets only one of them take a slot, the loser gets a retryable error and is retried here,
   * then either takes another free slot or is refused with SESSION_LIMIT_REACHED. The account can never exceed three active sessions.
   */
  private async startSession(userId: string, deviceLabel: string | null, activeRole: string | null) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.unitOfWork.run(async (tx) => {
          const locked = await this.repository.lockActiveSessionsByUser(userId, tx);
          const live: AuthSession[] = [];
          for (const existing of locked) {
            const token = await this.repository.lockActiveRefreshTokenBySession(existing.id, tx);
            // Only a session whose current refresh token has really expired is released here. (A session without a visible token is left alone: this
            // code always inserts the session and its first token in one transaction; the periodic job cleans up any inconsistent leftover.)
            if (token && token.isExpired(this.clock.now())) await this.endSession(existing, 'SESSION_EXPIRED', tx);
            else live.push(existing);
          }
          const slot = firstFreeSlot(live.flatMap((s) => (s.slot === null ? [] : [s.slot])));
          if (slot === undefined) throw sessionError('SESSION_LIMIT_REACHED', { maxActiveSessions: MAX_ACTIVE_SESSIONS });

          const session = AuthSession.start({ userId, slot, deviceLabel, activeRole, clock: this.clock });
          await this.repository.insertSession(session, tx);
          await this.outbox.publishFrom(session, tx);

          const rawToken = this.generator.generate();
          const token = RefreshTokenRecord.issue({
            sessionId: session.id,
            userId,
            tokenHash: this.hasher.hash(rawToken),
            clock: this.clock,
          });
          await this.repository.insertRefreshToken(token, tx);
          return { session, rawToken, token };
        });
      } catch (error) {
        // Two logins of the same account raced (unique slot or deadlock). Retry: the loser sees the winner and takes another slot or is refused.
        const raced = error instanceof AppError && error.code === 'SESSION_CONCURRENT_MODIFICATION';
        if (!raced || attempt >= MAX_LOGIN_ATTEMPTS) throw error;
      }
    }
  }

  /** Revokes every active session of the user (except `exceptSessionId`, when given) and returns how many were revoked. */
  private async revokeUserSessions(userId: string, reason: SessionRevokeReason, tx: TransactionContext, exceptSessionId?: string): Promise<number> {
    const sessions = await this.repository.lockActiveSessionsByUser(userId, tx);
    let revoked = 0;
    for (const session of sessions) {
      if (session.id === exceptSessionId) continue;
      await this.endSession(session, reason, tx);
      revoked += 1;
    }
    return revoked;
  }

  /** Ends the session only if its current refresh token is really expired (or missing), re-checked under the session lock. */
  private async expireOne(sessionId: string, tx: TransactionContext): Promise<boolean> {
    const session = await this.repository.lockSession(sessionId, tx);
    if (!session || !session.isActive) return false;
    const token = await this.repository.lockActiveRefreshTokenBySession(session.id, tx);
    if (token && !token.isExpired(this.clock.now())) return false;
    await this.endSession(session, 'SESSION_EXPIRED', tx);
    return true;
  }

  /** Revokes the session and its current refresh token, frees its slot, and publishes AuthSessionRevoked. */
  private async endSession(session: AuthSession, reason: SessionRevokeReason, tx: TransactionContext): Promise<void> {
    session.revoke(reason, this.clock);
    await this.repository.updateSession(session, tx);
    const current = await this.repository.lockActiveRefreshTokenBySession(session.id, tx);
    if (current) {
      current.revoke(this.clock.now());
      await this.repository.updateRefreshToken(current, tx);
    }
    await this.outbox.publishFrom(session, tx);
  }

  private async buildResult(
    user: { userId: string; phone: string; mustChangePassword: boolean },
    session: AuthSession,
    rawToken: string,
    token: RefreshTokenRecord,
  ): Promise<AuthResult> {
    const access = this.accessTokens.sign({ userId: user.userId, sessionId: session.id }, this.clock.now());
    const roles = await this.roles.listActiveRoles(user.userId);
    return {
      tokenType: 'Bearer',
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: rawToken,
      refreshTokenExpiresAt: token.expiresAt,
      user: { id: user.userId, phone: user.phone },
      mustChangePassword: user.mustChangePassword,
      roles,
      activeRole: effectiveActiveRole(session.activeRole, roles),
      schoolId: (await this.managedSchools?.findManagedSchoolId(user.userId)) ?? null,
    };
  }

  private async spendHashingTime(password: string): Promise<void> {
    this.dummyHash ??= this.passwordHasher.hash('not-a-real-password');
    await this.passwordHasher.verify(password, await this.dummyHash);
  }
}
