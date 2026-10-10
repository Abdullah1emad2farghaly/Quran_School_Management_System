import { SystemClock, type Clock, type UnitOfWork } from '../../../00-shared-kernel/public';
import type { IdentityService } from '../../../08-identity-core/public';
import type { RoleService } from '../../../09-roles-permissions/public';
import { authorizationError } from '../../domain/errors/authorization-errors';
import type { BootstrapGuard } from '../ports/bootstrap-guard';

export interface BootstrapMainAdminInput {
  /** Any accepted phone format (normalized by Module 08). */
  readonly phone: string;
  /** Plain password: validated and hashed by Module 08, never stored, logged or returned. */
  readonly password: string;
}

export interface BootstrapMainAdminResult {
  readonly userId: string;
}

export interface BootstrapMainAdminDeps {
  readonly identity: Pick<IdentityService, 'createUser'>;
  readonly roles: Pick<RoleService, 'assignRole' | 'countActiveByRole'>;
  readonly guard: BootstrapGuard;
  readonly unitOfWork: UnitOfWork;
  readonly clock?: Clock;
}

/**
 * Creates the FIRST Main Admin. Run only from the one-time CLI (`npm run bootstrap:main-admin`); there is no endpoint.
 *
 * One transaction: lock (serializes concurrent runs) -> refuse if an ACTIVE Main Admin assignment already exists ->
 * create the user through Module 08 -> assign MAIN_ADMIN through Module 09 (`assignedBy: null` = the system).
 * Any failure rolls everything back, so a failed run leaves nothing behind and can simply be repeated.
 * It never reuses or merges an existing user: an already-registered phone fails with USER_PHONE_ALREADY_EXISTS.
 */
export class BootstrapMainAdmin {
  private readonly identity: BootstrapMainAdminDeps['identity'];
  private readonly roles: BootstrapMainAdminDeps['roles'];
  private readonly guard: BootstrapGuard;
  private readonly unitOfWork: UnitOfWork;
  private readonly clock: Clock;

  constructor(deps: BootstrapMainAdminDeps) {
    this.identity = deps.identity;
    this.roles = deps.roles;
    this.guard = deps.guard;
    this.unitOfWork = deps.unitOfWork;
    this.clock = deps.clock ?? new SystemClock();
  }

  execute(input: BootstrapMainAdminInput): Promise<BootstrapMainAdminResult> {
    return this.unitOfWork.run(async (tx) => {
      await this.guard.lockExclusive(tx);
      if ((await this.roles.countActiveByRole('MAIN_ADMIN', tx)) > 0) throw authorizationError('MAIN_ADMIN_ALREADY_EXISTS');

      const user = await this.identity.createUser({ phone: input.phone, password: input.password }, tx);
      await this.roles.assignRole({ userId: user.id, roleCode: 'MAIN_ADMIN', assignedBy: null }, tx);
      await this.guard.recordBootstrap({ userId: user.id, at: this.clock.now() }, tx);
      return { userId: user.id };
    });
  }
}
