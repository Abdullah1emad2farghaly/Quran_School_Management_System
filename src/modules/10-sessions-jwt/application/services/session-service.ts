import { AppError, SystemClock, type Clock, type TransactionContext, type UnitOfWork } from '../../../00-shared-kernel/public';
import type { OutboxService } from '../../../06-domain-events-outbox/public';
import { tryNormalizePhone, type IdentityService, type PasswordHasher } from '../../../08-identity-core/public';
import type { RoleService } from '../../../09-roles-permissions/public';
import { AuthSession } from '../../domain/entities/auth-session';
import { RefreshTokenRecord } from '../../domain/entities/refresh-token-record';
import { sessionError } from '../../domain/errors/session-errors';
import type { SessionRevokeReason } from '../../domain/value-objects/session-revoke-reason';
import type { AuthPrincipal, AuthResult } from '../dto/auth-result';
import type { SessionRepository } from '../ports/session-repository';
import type { AccessTokenService, RefreshTokenGenerator, RefreshTokenHasher } from '../ports/token-ports';

export interface SessionServiceDeps {
  readonly repository: SessionRepository;
  readonly identity: Pick<IdentityService, 'findByPhone' | 'findById' | 'verifyPassword'>;
  readonly roles: Pick<RoleService, 'listActiveRoles'>;
  readonly accessTokens: AccessTokenService;
  readonly refreshTokenHasher: RefreshTokenHasher;
  readonly refreshTokenGenerator: RefreshTokenGenerator;
  /** Used only to spend the same time on unknown phones as on known ones (timing-safe login). */
  readonly passwordHasher: PasswordHasher;
  readonly unitOfWork: UnitOfWork;
  readonly outbox: OutboxService;
  readonly clock?: Clock;
}

const MAX_LOGIN_ATTEMPTS = 3;
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
 *  - only ONE active session per user: a new login revokes the previous session (history is kept);
 *  - logout current session, logout all sessions; a revoked session invalidates its access tokens at once
 *    because every authenticated request checks the session.
 */
export class SessionService {
  private readonly repository: SessionRepository;
  private readonly identity: SessionServiceDeps['identity'];
  private readonly roles: SessionServiceDeps['roles'];
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
   * password was verified. Any previous active session of the user is revoked (LOGIN_REPLACED).
   */
  async login(input: { phone: unknown; password: unknown }): Promise<AuthResult> {
    const phone = typeof input.phone === 'string' ? tryNormalizePhone(input.phone) : undefined;
    const password = typeof input.password === 'string' ? input.password : undefined;
    const user = phone ? await this.identity.findByPhone(phone) : undefined;

    if (!user || password === undefined) {
      await this.spendHashingTime(password ?? '');
      throw sessionError('INVALID_CREDENTIALS');
    }
    if (!(await this.identity.verifyPassword(user.id, password))) throw sessionError('INVALID_CREDENTIALS');
    if (!user.isActive) throw sessionError('ACCOUNT_INACTIVE');

    const issued = await this.startSession(user.id);
    return this.buildResult({ userId: user.id, phone: user.phone }, issued.session, issued.rawToken, issued.token);
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
        if (session.isActive) await this.revokeSession(session, 'REFRESH_TOKEN_REUSE', tx);
        return { kind: 'failed', code: 'REFRESH_TOKEN_REUSED' };
      }
      if (!session.isActive) return { kind: 'failed', code: 'SESSION_REVOKED' };

      const now = this.clock.now();
      if (token.isExpired(now)) return { kind: 'failed', code: 'REFRESH_TOKEN_EXPIRED' };

      const user = await this.identity.findById(session.userId, tx);
      if (!user || !user.isActive) {
        await this.revokeSession(session, 'USER_DEACTIVATED', tx);
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
    return this.buildResult({ userId: user.id, phone: user.phone }, outcome.session, outcome.rawToken, outcome.token);
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
    return { userId, sessionId };
  }

  /** Logout of the current session. Idempotent. */
  async logout(sessionId: string): Promise<void> {
    await this.unitOfWork.run(async (tx) => {
      const session = await this.repository.lockSession(sessionId, tx);
      if (session?.isActive) await this.revokeSession(session, 'LOGOUT', tx);
    });
  }

  /** Logout of all the user's sessions (there is at most one active session). Idempotent. */
  async logoutAll(userId: string): Promise<void> {
    await this.revokeAllForUser(userId, 'LOGOUT_ALL');
  }

  /**
   * Revokes every active session of a user and returns how many were revoked. Used by logout-all, by the
   * UserDeactivated handler, and by Module 11 after a password reset (`PASSWORD_RESET`). Idempotent.
   */
  async revokeAllForUser(userId: string, reason: SessionRevokeReason, tx?: TransactionContext): Promise<number> {
    const work = async (t: TransactionContext): Promise<number> => {
      const session = await this.repository.lockActiveSessionByUser(userId, t);
      if (!session) return 0;
      await this.revokeSession(session, reason, t);
      return 1;
    };
    return tx ? work(tx) : this.unitOfWork.run(work);
  }

  // ---------------------------------------------------------------------------------------------

  private async startSession(userId: string) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.unitOfWork.run(async (tx) => {
          const existing = await this.repository.lockActiveSessionByUser(userId, tx);
          if (existing) await this.revokeSession(existing, 'LOGIN_REPLACED', tx);

          const session = AuthSession.start({ userId, clock: this.clock });
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
        // Two logins of the same user raced; the unique index let only one win. Retry so the loser replaces it.
        const raced = error instanceof AppError && error.code === 'SESSION_CONCURRENT_MODIFICATION';
        if (!raced || attempt >= MAX_LOGIN_ATTEMPTS) throw error;
      }
    }
  }

  /** Revokes the session and its current refresh token, and publishes AuthSessionRevoked. */
  private async revokeSession(session: AuthSession, reason: SessionRevokeReason, tx: TransactionContext): Promise<void> {
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
    user: { userId: string; phone: string },
    session: AuthSession,
    rawToken: string,
    token: RefreshTokenRecord,
  ): Promise<AuthResult> {
    const access = this.accessTokens.sign({ userId: user.userId, sessionId: session.id }, this.clock.now());
    return {
      tokenType: 'Bearer',
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: rawToken,
      refreshTokenExpiresAt: token.expiresAt,
      user: { id: user.userId, phone: user.phone },
      roles: await this.roles.listActiveRoles(user.userId),
    };
  }

  private async spendHashingTime(password: string): Promise<void> {
    this.dummyHash ??= this.passwordHasher.hash('not-a-real-password');
    await this.passwordHasher.verify(password, await this.dummyHash);
  }
}
