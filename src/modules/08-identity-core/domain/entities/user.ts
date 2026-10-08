import { AggregateRoot, newUuid, type Clock } from '../../../00-shared-kernel/public';
import { createDomainEvent } from '../../../06-domain-events-outbox/public';
import { identityError } from '../errors/identity-errors';
import { IdentityEventTypes, USER_AGGREGATE_TYPE, type UserEventPayload } from '../events/user-events';
import { normalizePhone } from '../value-objects/phone-number';
import type { UserStatus } from '../value-objects/user-status';

export interface UserSnapshot {
  readonly id: string;
  readonly phone: string;
  readonly passwordHash: string;
  readonly status: UserStatus;
  readonly statusChangedAt: Date;
  /** Optimistic-lock counter, incremented by the repository on every update. */
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * The login identity (Master Specification §21-22). A User has a normalized phone, a password
 * HASH and a status. Names, roles, and business profiles live in other modules.
 */
export class User extends AggregateRoot<string> {
  private constructor(private state: UserSnapshot) {
    super(state.id);
  }

  /** `passwordHash` must already be hashed; plaintext passwords never reach the domain. */
  static create(input: { phone: string; passwordHash: string; clock: Clock; id?: string }): User {
    const now = input.clock.now();
    const user = new User({
      id: input.id ?? newUuid(),
      phone: normalizePhone(input.phone),
      passwordHash: input.passwordHash,
      status: 'ACTIVE',
      statusChangedAt: now,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    user.record(IdentityEventTypes.USER_CREATED, input.clock);
    return user;
  }

  static rehydrate(snapshot: UserSnapshot): User {
    return new User(snapshot);
  }

  get phone(): string {
    return this.state.phone;
  }
  get passwordHash(): string {
    return this.state.passwordHash;
  }
  get status(): UserStatus {
    return this.state.status;
  }
  get isActive(): boolean {
    return this.state.status === 'ACTIVE';
  }
  get statusChangedAt(): Date {
    return this.state.statusChangedAt;
  }
  get version(): number {
    return this.state.version;
  }
  get createdAt(): Date {
    return this.state.createdAt;
  }
  get updatedAt(): Date {
    return this.state.updatedAt;
  }

  /** Reversible; history is preserved (nothing is deleted). Sessions are revoked by the event consumer. */
  deactivate(clock: Clock): void {
    if (!this.isActive) throw identityError('USER_ALREADY_INACTIVE');
    this.changeStatus('INACTIVE', clock);
    this.record(IdentityEventTypes.USER_DEACTIVATED, clock);
  }

  activate(clock: Clock): void {
    if (this.isActive) throw identityError('USER_ALREADY_ACTIVE');
    this.changeStatus('ACTIVE', clock);
    this.record(IdentityEventTypes.USER_ACTIVATED, clock);
  }

  replacePasswordHash(passwordHash: string, clock: Clock): void {
    const now = clock.now();
    this.state = { ...this.state, passwordHash, updatedAt: now };
    this.record(IdentityEventTypes.USER_PASSWORD_CHANGED, clock);
  }

  private changeStatus(status: UserStatus, clock: Clock): void {
    const now = clock.now();
    this.state = { ...this.state, status, statusChangedAt: now, updatedAt: now };
  }

  private record(eventType: string, clock: Clock): void {
    this.addDomainEvent(
      createDomainEvent<UserEventPayload>(
        { eventType, aggregateType: USER_AGGREGATE_TYPE, aggregateId: this.id, payload: { userId: this.id } },
        clock,
      ),
    );
  }
}
