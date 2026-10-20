import { AggregateRoot, newUuid, type Clock } from '../../../00-shared-kernel/public';
import { createDomainEvent } from '../../../06-domain-events-outbox/public';
import { TeacherEventTypes, TEACHER_SCHOOL_LINK_AGGREGATE_TYPE, type TeacherSchoolLinkEventPayload } from '../events/teacher-events';

export interface TeacherSchoolLinkSnapshot {
  readonly id: string;
  readonly teacherId: string;
  /** Denormalized for the event payload only (the teacher's account and organization). */
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
 * The Teacher-to-School relationship (a Teacher may be linked to several schools of the SAME organization, one record per school, §32).
 * Same history pattern as the school manager link: never deleted; at most ONE active link per (teacher, school), enforced here and by
 * the database. Ending a link never touches the account or the other links.
 */
export class TeacherSchoolLink extends AggregateRoot<string> {
  private constructor(private state: TeacherSchoolLinkSnapshot) {
    super(state.id);
  }

  static link(input: { teacherId: string; userId: string; organizationId: string; schoolId: string; linkedBy: string; clock: Clock; id?: string }): TeacherSchoolLink {
    const link = new TeacherSchoolLink({
      id: input.id ?? newUuid(),
      teacherId: input.teacherId,
      userId: input.userId,
      organizationId: input.organizationId,
      schoolId: input.schoolId,
      linkedAt: input.clock.now(),
      linkedBy: input.linkedBy,
      unlinkedAt: null,
      unlinkedBy: null,
      version: 1,
    });
    link.record(TeacherEventTypes.TEACHER_SCHOOL_LINKED, input.linkedBy, input.clock);
    return link;
  }

  static rehydrate(snapshot: TeacherSchoolLinkSnapshot): TeacherSchoolLink {
    return new TeacherSchoolLink(snapshot);
  }

  get snapshot(): TeacherSchoolLinkSnapshot {
    return this.state;
  }
  get isActive(): boolean {
    return this.state.unlinkedAt === null;
  }

  unlink(actorId: string, clock: Clock): void {
    if (!this.isActive) throw new Error('Teacher school link already removed');
    this.state = { ...this.state, unlinkedAt: clock.now(), unlinkedBy: actorId };
    this.record(TeacherEventTypes.TEACHER_SCHOOL_LINK_REMOVED, actorId, clock);
  }

  private record(eventType: typeof TeacherEventTypes.TEACHER_SCHOOL_LINKED | typeof TeacherEventTypes.TEACHER_SCHOOL_LINK_REMOVED, actorId: string, clock: Clock): void {
    this.addDomainEvent(
      createDomainEvent<TeacherSchoolLinkEventPayload>(
        {
          eventType,
          aggregateType: TEACHER_SCHOOL_LINK_AGGREGATE_TYPE,
          aggregateId: this.id,
          payload: {
            linkId: this.id,
            teacherId: this.state.teacherId,
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
