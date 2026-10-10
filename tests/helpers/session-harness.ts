import type { TransactionContext, UnitOfWork } from '../../src/modules/00-shared-kernel/public';
import { InMemoryOutboxStore, OutboxService } from '../../src/modules/06-domain-events-outbox/public';
import { BcryptPasswordHasher, IdentityService, InMemoryUserRepository } from '../../src/modules/08-identity-core/public';
import {
  InMemoryRoleAssignmentRepository,
  PermissionRegistry,
  RoleService,
  type RoleCode,
} from '../../src/modules/09-roles-permissions/public';
import {
  CryptoRefreshTokenGenerator,
  HmacRefreshTokenHasher,
  InMemorySessionRepository,
  JwtAccessTokenService,
  SessionService,
} from '../../src/modules/10-sessions-jwt/public';

export const ACCESS_SECRET = 'test-access-secret-0123456789abcdef-A';
export const REFRESH_SECRET = 'test-refresh-secret-0123456789abcdef-B';

const tx = {} as TransactionContext;

/** In-memory wiring of Modules 08, 09 and 10 with a controllable clock. */
export function createSessionHarness() {
  let current = new Date('2026-10-09T10:00:00Z');
  const clock = { now: () => current };
  const advance = (ms: number) => {
    current = new Date(current.getTime() + ms);
  };

  const store = new InMemoryOutboxStore();
  const outbox = new OutboxService(store, clock);
  const unitOfWork: UnitOfWork = { run: (work) => work(tx) };

  const identity = new IdentityService({
    repository: new InMemoryUserRepository(),
    hasher: new BcryptPasswordHasher(4),
    unitOfWork,
    outbox,
    clock,
  });
  const roles = new RoleService({
    repository: new InMemoryRoleAssignmentRepository(),
    identity,
    permissions: new PermissionRegistry(),
    unitOfWork,
    outbox,
    clock,
  });
  const repository = new InMemorySessionRepository();
  const refreshTokenHasher = new HmacRefreshTokenHasher(REFRESH_SECRET);
  const accessTokens = new JwtAccessTokenService(ACCESS_SECRET);
  const service = new SessionService({
    repository,
    identity,
    roles,
    accessTokens,
    refreshTokenHasher,
    refreshTokenGenerator: new CryptoRefreshTokenGenerator(),
    passwordHasher: new BcryptPasswordHasher(4),
    unitOfWork,
    outbox,
    clock,
  });

  let n = 0;
  /** Creates a user (with one role) and returns its credentials. */
  async function createUser(options: { password?: string; role?: RoleCode } = {}) {
    const phone = `010${String(20000000 + ++n)}`;
    const password = options.password ?? 'secret1';
    const user = await identity.createUser({ phone, password });
    await roles.assignRole({ userId: user.id, roleCode: options.role ?? 'PARENT', assignedBy: null });
    return { id: user.id, phone, password };
  }

  const sessionEvents = () =>
    store.messages
      .filter((m) => m.aggregateType === 'AuthSession')
      .map((m) => ({ type: m.eventType, payload: JSON.parse(m.payload) as Record<string, unknown> }));

  return { service, identity, roles, repository, store, outbox, unitOfWork, clock, advance, createUser, sessionEvents, refreshTokenHasher, accessTokens };
}
