import { AggregateRoot, newUuid, type Clock } from '../../../00-shared-kernel/public';
import { createDomainEvent } from '../../../06-domain-events-outbox/public';
import { studentError } from '../errors/student-errors';
import { StudentEventTypes, STUDENT_AGGREGATE_TYPE, type StudentEventPayload } from '../events/student-events';
import { LIFECYCLE, type StudentLifecycleAction, type StudentStatus } from '../value-objects/student-status';
import type { StudentHistoryEntry } from './student-history-entry';

export interface StudentSnapshot {
  readonly id: string;
  /** The ONE school of the student. School transfer is not supported in V1 (§38), so it never changes. */
  readonly schoolId: string;
  /** Denormalized from the school at registration (event payloads and reads); never changes. */
  readonly organizationId: string;
  /** The ONE Parent (Module 17). Never changes in V1: a student is never moved to another Parent automatically (§38). */
  readonly parentId: string;
  /** Already normalized: at least three parts; second and third parts are the Parent's first and second names. */
  readonly fullName: string;
  /** Exactly 14 digits, unique across the whole system. Never changes in V1. */
  readonly nationalId: string;
  /** Business date (YYYY-MM-DD, Africa/Cairo). */
  readonly joinDate: string;
  readonly status: StudentStatus;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Optimistic-lock counter, incremented by the repository on every update. */
  readonly version: number;
}

/**
 * The Student entity (Master Specification §36-§39). A business entity ONLY: no login, no password, no token, no session. It owns the
 * name, the National ID, the join date, the lifecycle status and the Parent / school it belongs to. It does NOT own the group (Module 20) or
 * the address (derived from the Parent, §37). Every change records a history entry and a domain event.
 */
export class Student extends AggregateRoot<string> {
  private pendingHistory: StudentHistoryEntry[] = [];

  private constructor(private state: StudentSnapshot) {
    super(state.id);
  }

  static register(input: {
    schoolId: string;
    organizationId: string;
    parentId: string;
    fullName: string;
    nationalId: string;
    joinDate: string;
    createdBy: string;
    clock: Clock;
    id?: string;
  }): Student {
    const now = input.clock.now();
    const student = new Student({
      id: input.id ?? newUuid(),
      schoolId: input.schoolId,
      organizationId: input.organizationId,
      parentId: input.parentId,
      fullName: input.fullName,
      nationalId: input.nationalId,
      joinDate: input.joinDate,
      status: 'ACTIVE',
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
    student.recordEvent(StudentEventTypes.STUDENT_REGISTERED, input.createdBy, input.clock);
    student.recordHistory({ action: 'REGISTERED', actorId: input.createdBy, clock: input.clock, newStatus: 'ACTIVE', newFullName: input.fullName, newJoinDate: input.joinDate });
    return student;
  }

  static rehydrate(snapshot: StudentSnapshot): Student {
    return new Student(snapshot);
  }

  get snapshot(): StudentSnapshot {
    return this.state;
  }
  get status(): StudentStatus {
    return this.state.status;
  }
  get version(): number {
    return this.state.version;
  }

  /** History entries recorded since the last pull (the service stores them in the same transaction). */
  pullHistory(): StudentHistoryEntry[] {
    const entries = this.pendingHistory;
    this.pendingHistory = [];
    return entries;
  }

  /**
   * Corrects the name and/or the join date. Returns the names of the attributes that really changed (empty: nothing changed, nothing is
   * recorded). An ARCHIVED student is read-only. The parent, the school and the National ID can never be changed here.
   */
  updateDetails(input: { fullName?: string | undefined; joinDate?: string | undefined; actorId: string; clock: Clock }): Array<'FULL_NAME' | 'JOIN_DATE'> {
    if (this.state.status === 'ARCHIVED') throw studentError('STUDENT_ARCHIVED');
    const changed: Array<'FULL_NAME' | 'JOIN_DATE'> = [];
    const previous = this.state;
    let next = this.state;
    if (input.fullName !== undefined && input.fullName !== previous.fullName) {
      next = { ...next, fullName: input.fullName };
      changed.push('FULL_NAME');
    }
    if (input.joinDate !== undefined && input.joinDate !== previous.joinDate) {
      next = { ...next, joinDate: input.joinDate };
      changed.push('JOIN_DATE');
    }
    if (changed.length === 0) return changed;
    this.state = { ...next, updatedAt: input.clock.now() };
    this.recordEvent(StudentEventTypes.STUDENT_UPDATED, input.actorId, input.clock, { changedFields: changed });
    this.recordHistory({
      action: 'DETAILS_UPDATED',
      actorId: input.actorId,
      clock: input.clock,
      previousFullName: changed.includes('FULL_NAME') ? previous.fullName : null,
      newFullName: changed.includes('FULL_NAME') ? this.state.fullName : null,
      previousJoinDate: changed.includes('JOIN_DATE') ? previous.joinDate : null,
      newJoinDate: changed.includes('JOIN_DATE') ? this.state.joinDate : null,
    });
    return changed;
  }

  /** DEACTIVATE / REACTIVATE / ARCHIVE following the documented lifecycle; any other move is STUDENT_INVALID_STATUS_TRANSITION. */
  applyLifecycle(action: StudentLifecycleAction, actorId: string, reason: string | null, clock: Clock): void {
    const rule = LIFECYCLE[action];
    if (!rule.from.includes(this.state.status)) throw studentError('STUDENT_INVALID_STATUS_TRANSITION');
    const previousStatus = this.state.status;
    this.state = { ...this.state, status: rule.to, updatedAt: clock.now() };
    this.recordEvent(StudentEventTypes.STUDENT_STATUS_CHANGED, actorId, clock, { previousStatus });
    this.recordHistory({ action: 'STATUS_CHANGED', actorId, clock, reason, previousStatus, newStatus: rule.to });
  }

  private recordEvent(eventType: (typeof StudentEventTypes)[keyof typeof StudentEventTypes], actorId: string, clock: Clock, extra: Partial<StudentEventPayload> = {}): void {
    this.addDomainEvent(
      createDomainEvent<StudentEventPayload>(
        {
          eventType,
          aggregateType: STUDENT_AGGREGATE_TYPE,
          aggregateId: this.id,
          payload: {
            studentId: this.id,
            schoolId: this.state.schoolId,
            organizationId: this.state.organizationId,
            parentId: this.state.parentId,
            actorId,
            status: this.state.status,
            ...extra,
          },
        },
        clock,
      ),
    );
  }

  private recordHistory(input: Partial<Omit<StudentHistoryEntry, 'id' | 'studentId' | 'occurredAt'>> & { action: StudentHistoryEntry['action']; actorId: string; clock: Clock }): void {
    this.pendingHistory.push({
      id: newUuid(),
      studentId: this.id,
      action: input.action,
      actorId: input.actorId,
      occurredAt: input.clock.now(),
      reason: input.reason ?? null,
      previousStatus: input.previousStatus ?? null,
      newStatus: input.newStatus ?? null,
      previousFullName: input.previousFullName ?? null,
      newFullName: input.newFullName ?? null,
      previousJoinDate: input.previousJoinDate ?? null,
      newJoinDate: input.newJoinDate ?? null,
    });
  }
}
