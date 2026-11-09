import { AggregateRoot, newUuid, type Clock } from '../../../00-shared-kernel/public';
import { createDomainEvent } from '../../../06-domain-events-outbox/public';
import { SubscriptionEventTypes, COLLECTOR_SCHOOL_LINK_AGGREGATE_TYPE, type CollectorSchoolLinkEventPayload } from '../events/subscription-events';

export interface CollectorSchoolLinkSnapshot {
  readonly id: string;
  /** The Subscription Collector's login account (Module 08). */
  readonly userId: string;
  /** The organization of the school; every link of one account is in the SAME organization. */
  readonly organizationId: string;
  readonly schoolId: string;
  readonly linkedAt: Date;
  readonly linkedBy: string;
  readonly unlinkedAt: Date | null;
  readonly unlinkedBy: string | null;
  readonly version: number;
}

/**
 * The Subscription Collector-to-School relationship (approved Module 33 Option A, Teacher-link conventions): a Collector may serve several schools of the SAME
 * organization, one record per school. Records are never deleted: ending a link keeps it as history, and an ended link grants NO access (only ACTIVE links count).
 * At most one active link per (account, school), enforced here and by a unique index.
 */
export class CollectorSchoolLink extends AggregateRoot<string> {
  private constructor(private state: CollectorSchoolLinkSnapshot) {
    super(state.id);
  }

  static link(input: { userId: string; organizationId: string; schoolId: string; linkedBy: string; clock: Clock; id?: string }): CollectorSchoolLink {
    const link = new CollectorSchoolLink({
      id: input.id ?? newUuid(),
      userId: input.userId,
      organizationId: input.organizationId,
      schoolId: input.schoolId,
      linkedAt: input.clock.now(),
      linkedBy: input.linkedBy,
      unlinkedAt: null,
      unlinkedBy: null,
      version: 1,
    });
    link.record(SubscriptionEventTypes.COLLECTOR_SCHOOL_LINKED, input.linkedBy, input.clock);
    return link;
  }

  static rehydrate(snapshot: CollectorSchoolLinkSnapshot): CollectorSchoolLink {
    return new CollectorSchoolLink(snapshot);
  }

  get snapshot(): CollectorSchoolLinkSnapshot {
    return this.state;
  }
  get isActive(): boolean {
    return this.state.unlinkedAt === null;
  }

  unlink(actorId: string, clock: Clock): void {
    if (!this.isActive) throw new Error('Collector school link already removed');
    this.state = { ...this.state, unlinkedAt: clock.now(), unlinkedBy: actorId };
    this.record(SubscriptionEventTypes.COLLECTOR_SCHOOL_LINK_REMOVED, actorId, clock);
  }

  private record(eventType: typeof SubscriptionEventTypes.COLLECTOR_SCHOOL_LINKED | typeof SubscriptionEventTypes.COLLECTOR_SCHOOL_LINK_REMOVED, actorId: string, clock: Clock): void {
    this.addDomainEvent(
      createDomainEvent<CollectorSchoolLinkEventPayload>(
        {
          eventType,
          aggregateType: COLLECTOR_SCHOOL_LINK_AGGREGATE_TYPE,
          aggregateId: this.id,
          payload: { linkId: this.id, userId: this.state.userId, schoolId: this.state.schoolId, organizationId: this.state.organizationId, actorId },
        },
        clock,
      ),
    );
  }
}
