import { AggregateRoot, newUuid, type Clock } from '../../../00-shared-kernel/public';
import { createDomainEvent } from '../../../06-domain-events-outbox/public';
import { TeacherEventTypes, TEACHER_AGGREGATE_TYPE, type TeacherEventPayload } from '../events/teacher-events';

export interface TeacherSnapshot {
  readonly id: string;
  /** The login account (Module 08). One Teacher record per account, ever. */
  readonly userId: string;
  /** The organization the Teacher belongs to (through the school that registered them); fixed for the life of the record. */
  readonly organizationId: string;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Optimistic-lock counter, incremented by the repository on every update. */
  readonly version: number;
}

/**
 * The Teacher entity (Master Specification §32): `User -> Teacher role -> Teacher entity`. It owns the Teacher's name and organization;
 * the per-school relationships are separate records of this module (never deleted). The account itself
 * (phone, password, status) belongs to Module 08 and is never changed from here.
 */
export class Teacher extends AggregateRoot<string> {
  private constructor(private state: TeacherSnapshot) {
    super(state.id);
  }

  static register(input: { userId: string; organizationId: string; createdBy: string; clock: Clock; id?: string }): Teacher {
    const now = input.clock.now();
    const teacher = new Teacher({
      id: input.id ?? newUuid(),
      userId: input.userId,
      organizationId: input.organizationId,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
    teacher.record(TeacherEventTypes.TEACHER_REGISTERED, input.createdBy, input.clock);
    return teacher;
  }

  static rehydrate(snapshot: TeacherSnapshot): Teacher {
    return new Teacher(snapshot);
  }

  get snapshot(): TeacherSnapshot {
    return this.state;
  }
  get userId(): string {
    return this.state.userId;
  }
  get organizationId(): string {
    return this.state.organizationId;
  }
  get version(): number {
    return this.state.version;
  }

  private record(eventType: typeof TeacherEventTypes.TEACHER_REGISTERED, actorId: string, clock: Clock): void {
    this.addDomainEvent(
      createDomainEvent<TeacherEventPayload>(
        {
          eventType,
          aggregateType: TEACHER_AGGREGATE_TYPE,
          aggregateId: this.id,
          payload: { teacherId: this.id, userId: this.state.userId, organizationId: this.state.organizationId, actorId },
        },
        clock,
      ),
    );
  }
}
