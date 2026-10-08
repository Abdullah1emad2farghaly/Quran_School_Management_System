import { SystemClock, type Clock, type TransactionContext, type UnitOfWork } from '../../../00-shared-kernel/public';
import type { OutboxService } from '../../../06-domain-events-outbox/public';
import { User } from '../../domain/entities/user';
import { identityError } from '../../domain/errors/identity-errors';
import { assertPasswordPolicy } from '../../domain/value-objects/password-policy';
import { normalizePhone } from '../../domain/value-objects/phone-number';
import { toUserDto, type UserDto } from '../dto/user-dto';
import type { PasswordHasher } from '../ports/password-hasher';
import type { UserRepository } from '../ports/user-repository';

export interface CreateUserInput {
  /** Any accepted phone format; it is normalized to E.164. */
  readonly phone: string;
  /** Plain password, validated against the §23 policy and hashed here. Never logged or stored. */
  readonly password: string;
}

export interface IdentityServiceDeps {
  readonly repository: UserRepository;
  readonly hasher: PasswordHasher;
  readonly unitOfWork: UnitOfWork;
  readonly outbox: OutboxService;
  readonly clock?: Clock;
}

/**
 * Public application contract of Module 08 (Identity Core).
 *
 * It owns the login IDENTITY only. It does NOT authorize callers: Module 12 (authorization) and
 * the calling module's own rules decide who may create/deactivate users. It also never decides
 * identity reuse vs. conflict between people (parents/teachers): callers use `findByPhone`
 * and decide; `createUser` always fails with USER_PHONE_ALREADY_EXISTS when the phone is taken,
 * so identities are never silently merged (§21, §86).
 *
 * Every method accepts an optional transaction so a caller can make its own changes atomic
 * with the user change; without one, the service opens its own transaction.
 */
export class IdentityService {
  private readonly repository: UserRepository;
  private readonly hasher: PasswordHasher;
  private readonly unitOfWork: UnitOfWork;
  private readonly outbox: OutboxService;
  private readonly clock: Clock;

  constructor(deps: IdentityServiceDeps) {
    this.repository = deps.repository;
    this.hasher = deps.hasher;
    this.unitOfWork = deps.unitOfWork;
    this.outbox = deps.outbox;
    this.clock = deps.clock ?? new SystemClock();
  }

  async createUser(input: CreateUserInput, tx?: TransactionContext): Promise<UserDto> {
    const phone = normalizePhone(input.phone);
    assertPasswordPolicy(input.password);
    const passwordHash = await this.hasher.hash(input.password);

    return this.inTransaction(tx, async (t) => {
      if (await this.repository.findByPhone(phone, t)) throw identityError('USER_PHONE_ALREADY_EXISTS');
      const user = User.create({ phone, passwordHash, clock: this.clock });
      await this.repository.insert(user, t);
      await this.outbox.publishFrom(user, t);
      return toUserDto(user);
    });
  }

  async findById(id: string, tx?: TransactionContext): Promise<UserDto | undefined> {
    const user = await this.repository.findById(id, tx);
    return user ? toUserDto(user) : undefined;
  }

  /** Throws USER_NOT_FOUND. Password-recovery flows must not turn this into an existence leak (§86). */
  async getById(id: string, tx?: TransactionContext): Promise<UserDto> {
    const user = await this.findById(id, tx);
    if (!user) throw identityError('USER_NOT_FOUND');
    return user;
  }

  /** Normalizes the phone first. Throws INVALID_PHONE_NUMBER for malformed input. */
  async findByPhone(phone: string, tx?: TransactionContext): Promise<UserDto | undefined> {
    const user = await this.repository.findByPhone(normalizePhone(phone), tx);
    return user ? toUserDto(user) : undefined;
  }

  /**
   * Checks a plain password against the stored hash. Returns false for unknown users.
   * It does NOT look at the user's status: the login flow (Module 10) must also require `isActive`.
   */
  async verifyPassword(userId: string, plain: string): Promise<boolean> {
    const user = await this.repository.findById(userId);
    if (!user) return false;
    return this.hasher.verify(plain, user.passwordHash);
  }

  /** ACTIVE -> INACTIVE. Emits UserDeactivated; Module 10 revokes sessions on it. Reversible. */
  async deactivateUser(id: string, tx?: TransactionContext): Promise<UserDto> {
    return this.mutate(id, tx, (user) => user.deactivate(this.clock));
  }

  /** INACTIVE -> ACTIVE. */
  async activateUser(id: string, tx?: TransactionContext): Promise<UserDto> {
    return this.mutate(id, tx, (user) => user.activate(this.clock));
  }

  /**
   * Replaces the password (policy-checked, hashed). Verifying the OLD password, OTP, or
   * authorization is the caller's job (Modules 10/11).
   */
  async changePassword(id: string, newPassword: string, tx?: TransactionContext): Promise<UserDto> {
    assertPasswordPolicy(newPassword);
    const passwordHash = await this.hasher.hash(newPassword);
    return this.mutate(id, tx, (user) => user.replacePasswordHash(passwordHash, this.clock));
  }

  private async mutate(id: string, tx: TransactionContext | undefined, change: (user: User) => void): Promise<UserDto> {
    return this.inTransaction(tx, async (t) => {
      const user = await this.repository.findById(id, t);
      if (!user) throw identityError('USER_NOT_FOUND');
      change(user);
      await this.repository.update(user, t);
      await this.outbox.publishFrom(user, t);
      return toUserDto(user);
    });
  }

  private inTransaction<T>(tx: TransactionContext | undefined, work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return tx ? work(tx) : this.unitOfWork.run(work);
  }
}
