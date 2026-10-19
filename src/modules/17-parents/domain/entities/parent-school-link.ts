import { AggregateRoot, newUuid, type Clock } from '../../../00-shared-kernel/public';
import { createDomainEvent } from '../../../06-domain-events-outbox/public';
import { ParentEventTypes, PARENT_SCHOOL_LINK_AGGREGATE_TYPE, type ParentSchoolLinkEventPayload } from '../events/parent-events';

export interface ParentSchoolLinkSnapshot {
  readonly id: string;
  readonly parentId: string;
  /** Denormalized for the event payload only (the parent's account and organization). */
  readonly userId: string;
  readonly organizationId: string;
  readonly schoolId: string;
  readonly linkedAt: Date;
  readonly linkedBy: string;
  readonly unlinkedAt: Date | null;
  readonly unlinkedBy: string | null;
  readonly version: number;
}

/**
 * The Parent-to-School relationship (a Parent may be linked to several schools of the SAME organization, one record per school, §32).
 * Same history pattern as the school manager link: never deleted; at most ONE active link per (parent, school), enforced here and by
 * the database. Ending a link never touches the account or the other links.
 */
export class ParentSchoolLink extends AggregateRoot<string> {
  private constructor(private state: ParentSchoolLinkSnapshot) {
    super(state.id);
  }

  static link(input: { parentId: string; userId: string; organizationId: string; schoolId: string; linkedBy: string; clock: Clock; id?: string }): ParentSchoolLink {
    const link = new ParentSchoolLink({
      id: input.id ?? newUuid(),
      parentId: input.parentId,
      userId: input.userId,
      organizationId: input.organizationId,
      schoolId: input.schoolId,
      linkedAt: input.clock.now(),
      linkedBy: input.linkedBy,
      unlinkedAt: null,
      unlinkedBy: null,
      version: 1,
    });
    link.record(ParentEventTypes.PARENT_SCHOOL_LINKED, input.linkedBy, input.clock);
    return link;
  }

  static rehydrate(snapshot: ParentSchoolLinkSnapshot): ParentSchoolLink {
    return new ParentSchoolLink(snapshot);
  }

  get snapshot(): ParentSchoolLinkSnapshot {
    return this.state;
  }
  get isActive(): boolean {
    return this.state.unlinkedAt === null;
  }

  unlink(actorId: string, clock: Clock): void {
    if (!this.isActive) throw new Error('Parent school link already removed');
    this.state = { ...this.state, unlinkedAt: clock.now(), unlinkedBy: actorId };
    this.record(ParentEventTypes.PARENT_SCHOOL_LINK_REMOVED, actorId, clock);
  }

  private record(eventType: typeof ParentEventTypes.PARENT_SCHOOL_LINKED | typeof ParentEventTypes.PARENT_SCHOOL_LINK_REMOVED, actorId: string, clock: Clock): void {
    this.addDomainEvent(
      createDomainEvent<ParentSchoolLinkEventPayload>(
        {
          eventType,
          aggregateType: PARENT_SCHOOL_LINK_AGGREGATE_TYPE,
          aggregateId: this.id,
          payload: {
            linkId: this.id,
            parentId: this.state.parentId,
            userId: this.state.userId,
            schoolId: this.state.schoolId,
            organizationId: this.state.organizationId,
            actorId,
          },
        },
        clock,
      ),
    );
  }
}
