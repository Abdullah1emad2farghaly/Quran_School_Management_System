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
import {
  AuthorizationPolicyRegistry,
  AuthorizationResolvers,
  AuthorizationService,
  InMemoryBootstrapGuard,
  type GlobalScopeRoles,
} from '../../src/modules/12-authorization-engine/public';
import type { Logger } from '../../src/modules/05-logging-request-context/public';

const tx = {} as TransactionContext;

export interface RecordedLog {
  level: string;
  message: string;
  fields?: Record<string, unknown>;
}

/** In-memory wiring of Modules 08, 09, 10 and 12. Registers NO permissions: each test declares what it needs. */
export function createAuthorizationHarness(options: { globalScopeRoles?: GlobalScopeRoles } = {}) {
  const clock = { now: () => new Date('2026-10-10T10:00:00Z') };
  const outbox = new OutboxService(new InMemoryOutboxStore(), clock);
  const unitOfWork: UnitOfWork = { run: (work) => work(tx) };

  const identity = new IdentityService({
    repository: new InMemoryUserRepository(),
    hasher: new BcryptPasswordHasher(4),
    unitOfWork,
    outbox,
    clock,
  });
  const permissions = new PermissionRegistry();
  const roleRepository = new InMemoryRoleAssignmentRepository();
  const roles = new RoleService({ repository: roleRepository, identity, permissions, unitOfWork, outbox, clock });

  const policies = new AuthorizationPolicyRegistry(permissions);
  const resolvers = new AuthorizationResolvers();
  const logs: RecordedLog[] = [];
  const makeLogger = (): Logger => ({
    error: (message, fields) => void logs.push({ level: 'error', message, fields: fields as Record<string, unknown> }),
    warn: (message, fields) => void logs.push({ level: 'warn', message, fields: fields as Record<string, unknown> }),
    info: (message, fields) => void logs.push({ level: 'info', message, fields: fields as Record<string, unknown> }),
    debug: () => undefined,
    child: () => makeLogger(),
  });
  const engine = new AuthorizationService({
    identity,
    roles,
    permissions,
    policies,
    resolvers,
    globalScopeRoles: options.globalScopeRoles,
    logger: makeLogger(),
  });

  const sessions = new SessionService({
    repository: new InMemorySessionRepository(),
    identity,
    roles,
    accessTokens: new JwtAccessTokenService('test-access-secret-0123456789abcdef-A'),
    refreshTokenHasher: new HmacRefreshTokenHasher('test-refresh-secret-0123456789abcdef-B'),
    refreshTokenGenerator: new CryptoRefreshTokenGenerator(),
    passwordHasher: new BcryptPasswordHasher(4),
    unitOfWork,
    outbox,
    clock,
  });

  let n = 0;
  /** A user holding the given roles. */
  async function createUser(...roleCodes: RoleCode[]) {
    const phone = `010${String(30000000 + ++n)}`;
    const password = 'secret1';
    const user = await identity.createUser({ phone, password });
    for (const roleCode of roleCodes) await roles.assignRole({ userId: user.id, roleCode, assignedBy: null });
    return { id: user.id, phone, password };
  }

  return {
    clock, outbox, unitOfWork, identity, permissions, roles, roleRepository, policies, resolvers, engine, sessions, logs,
    createUser, guard: new InMemoryBootstrapGuard(),
  };
}
export type AuthorizationHarness = ReturnType<typeof createAuthorizationHarness>;
