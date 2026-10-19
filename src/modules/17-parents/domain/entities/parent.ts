import { AggregateRoot, newUuid, type Clock } from '../../../00-shared-kernel/public';
import { createDomainEvent } from '../../../06-domain-events-outbox/public';
import { ParentEventTypes, PARENT_AGGREGATE_TYPE, type ParentEventPayload } from '../events/parent-events';
import { normalizeParentName } from '../value-objects/parent-name';

export interface ParentSnapshot {
  readonly id: string;
  /** The login account (Module 08). One Parent record per account, ever. */
  readonly userId: string;
  /** The organization the Parent belongs to (through the school that registered them); fixed for the life of the record. */
  readonly organizationId: string;
  /** Normalized three-part name (§32). */
  readonly fullName: string;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Optimistic-lock counter, incremented by the repository on every update. */
  readonly version: number;
}

/**
 * The Parent entity (Master Specification §32): `User -> Parent role -> Parent entity`. It owns the Parent's name and organization;
 * the address history and the per-school relationships are separate records of this module (never deleted). The account itself
 * (phone, password, status) belongs to Module 08 and is never changed from here.
 */
export class Parent extends AggregateRoot<string> {
  private constructor(private state: ParentSnapshot) {
    super(state.id);
  }

  static register(input: { userId: string; organizationId: string; fullName: unknown; createdBy: string; clock: Clock; id?: string }): Parent {
    const now = input.clock.now();
    const parent = new Parent({
      id: input.id ?? newUuid(),
      userId: input.userId,
      organizationId: input.organizationId,
      fullName: normalizeParentName(input.fullName),
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
    parent.record(ParentEventTypes.PARENT_REGISTERED, input.createdBy, input.clock);
    return parent;
  }

  static rehydrate(snapshot: ParentSnapshot): Parent {
    return new Parent(snapshot);
  }

  get snapshot(): ParentSnapshot {
    return this.state;
  }
  get userId(): string {
    return this.state.userId;
  }
  get organizationId(): string {
    return this.state.organizationId;
  }
  get fullName(): string {
    return this.state.fullName;
  }
  get version(): number {
    return this.state.version;
  }

  /** Corrects the name. Returns false (and records nothing) when the normalized name is unchanged. */
  rename(fullName: unknown, actorId: string, clock: Clock): boolean {
    const next = normalizeParentName(fullName);
    if (next === this.state.fullName) return false;
    this.state = { ...this.state, fullName: next, updatedAt: clock.now() };
    this.record(ParentEventTypes.PARENT_UPDATED, actorId, clock);
    return true;
  }

  /** Called by the service when a NEW current address was stored (the history row itself is written by the repository). */
  addressChanged(actorId: string, clock: Clock): void {
    this.state = { ...this.state, updatedAt: clock.now() };
    this.record(ParentEventTypes.PARENT_ADDRESS_CHANGED, actorId, clock);
  }

  private record(eventType: (typeof ParentEventTypes)[keyof typeof ParentEventTypes], actorId: string, clock: Clock): void {
    this.addDomainEvent(
      createDomainEvent<ParentEventPayload>(
        {
          eventType,
          aggregateType: PARENT_AGGREGATE_TYPE,
          aggregateId: this.id,
          payload: { parentId: this.id, userId: this.state.userId, organizationId: this.state.organizationId, actorId },
        },
        clock,
      ),
    );
  }
}
