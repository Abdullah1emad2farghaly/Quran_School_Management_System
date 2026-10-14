import { AggregateRoot, newUuid, type Clock } from '../../../00-shared-kernel/public';
import { createDomainEvent } from '../../../06-domain-events-outbox/public';
import { schoolError } from '../errors/school-errors';
import { SCHOOL_AGGREGATE_TYPE, SchoolEventTypes, type SchoolEventPayload, type SchoolEventType } from '../events/school-events';
import type { GpsFix } from '../value-objects/gps';
import { isSchoolCode } from '../value-objects/school-code';
import { canTransitionSchoolStatus, isSchoolStatus, type SchoolStatus } from '../value-objects/school-status';
import { isSchoolType, type SchoolType } from '../value-objects/school-type';

export const REJECTION_REASON_MAX_LENGTH = 500;

export interface SchoolSnapshot {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: SchoolType;
  readonly status: SchoolStatus;
  readonly organizationId: string;
  /** The school's country: ALWAYS its organization's country (derived by the application, enforced by composite foreign keys). */
  readonly countryId: string;
  /** Sub-Schools only. */
  readonly parentSchoolId: string | null;
  readonly governorateId: string;
  readonly centerId: string | null;
  readonly villageId: string | null;
  readonly gps: GpsFix;
  /** Main School: the Main Admin who created it. Sub-School: the requester. NOT the manager relationship. */
  readonly createdBy: string;
  /** The name the applicant typed in the submission form (public submissions); null for schools created otherwise. */
  readonly applicantName: string | null;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly rejectionReason: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewSchoolInput {
  readonly name: string;
  readonly code: string;
  readonly organizationId: string;
  readonly countryId: string;
  readonly governorateId: string;
  readonly centerId?: string | null;
  readonly villageId?: string | null;
  readonly gps: GpsFix;
  readonly createdBy: string;
  readonly applicantName?: string | null;
  readonly clock: Clock;
  readonly id?: string;
}

/**
 * A school (Master Specification §29-31). Inputs are already validated by the application service (name, GPS,
 * address, organization); the aggregate owns the lifecycle and the GPS rule:
 *   Main School -> ACTIVE;  Sub-School request -> PENDING -> ACTIVE (approve) | REJECTED (terminal);
 *   ACTIVE <-> INACTIVE;  official GPS can be corrected only while PENDING.
 * The manager relationship is NOT part of this aggregate (see SchoolManagerAssignment).
 */
export class School extends AggregateRoot<string> {
  private constructor(private state: SchoolSnapshot) {
    super(state.id);
  }

  static createMain(input: NewSchoolInput): School {
    return School.create(input, 'MAIN', 'ACTIVE', null);
  }

  static requestSub(input: NewSchoolInput & { parentSchoolId: string }): School {
    return School.create(input, 'SUB', 'PENDING', input.parentSchoolId);
  }

  private static create(input: NewSchoolInput, type: SchoolType, status: SchoolStatus, parentSchoolId: string | null): School {
    if (!isSchoolCode(input.code)) throw new RangeError('Invalid school code');
    const now = input.clock.now();
    const school = new School({
      id: input.id ?? newUuid(),
      code: input.code,
      name: input.name,
      type,
      status,
      organizationId: input.organizationId,
      countryId: input.countryId,
      parentSchoolId,
      governorateId: input.governorateId,
      centerId: input.centerId ?? null,
      villageId: input.villageId ?? null,
      gps: input.gps,
      createdBy: input.createdBy,
      applicantName: input.applicantName ?? null,
      decidedBy: null,
      decidedAt: null,
      rejectionReason: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    school.record(SchoolEventTypes.SCHOOL_CREATED, input.createdBy, input.clock);
    return school;
  }

  /** Loads a stored school; stored data that breaks the invariants is rejected, never trusted. */
  static rehydrate(snapshot: SchoolSnapshot): School {
    const mainOk = snapshot.type === 'MAIN' && snapshot.parentSchoolId === null && (snapshot.status === 'ACTIVE' || snapshot.status === 'INACTIVE');
    const subOk = snapshot.type === 'SUB' && snapshot.parentSchoolId !== null;
    if (!isSchoolCode(snapshot.code) || !isSchoolType(snapshot.type) || !isSchoolStatus(snapshot.status) || !(mainOk || subOk)) {
      throw new Error('Corrupt school record');
    }
    return new School(snapshot);
  }

  /** Sub-School only: PENDING -> ACTIVE. The caller checks that the approver is a Main Admin. */
  approve(decidedBy: string, clock: Clock): void {
    if (this.state.type !== 'SUB') throw schoolError('SCHOOL_INVALID_STATUS_TRANSITION');
    this.transition('ACTIVE', clock);
    this.state = { ...this.state, decidedBy, decidedAt: clock.now() };
    this.record(SchoolEventTypes.SCHOOL_APPROVED, decidedBy, clock);
  }

  /** Sub-School only: PENDING -> REJECTED (terminal). A nonblank reason (at most 500 characters) is required. */
  reject(decidedBy: string, reason: unknown, clock: Clock): void {
    if (this.state.type !== 'SUB') throw schoolError('SCHOOL_INVALID_STATUS_TRANSITION');
    const text = typeof reason === 'string' ? reason.normalize('NFC').replace(/\s+/gu, ' ').trim() : '';
    if (text === '' || /\p{Cc}/u.test(text) || [...text].length > REJECTION_REASON_MAX_LENGTH) throw schoolError('INVALID_REJECTION_REASON');
    this.transition('REJECTED', clock);
    this.state = { ...this.state, decidedBy, decidedAt: clock.now(), rejectionReason: text };
    this.record(SchoolEventTypes.SCHOOL_REJECTED, decidedBy, clock);
  }

  deactivate(changedBy: string, clock: Clock): void {
    if (this.state.status !== 'ACTIVE') throw schoolError('SCHOOL_INVALID_STATUS_TRANSITION');
    this.transition('INACTIVE', clock);
    this.record(SchoolEventTypes.SCHOOL_DEACTIVATED, changedBy, clock);
  }

  reactivate(changedBy: string, clock: Clock): void {
    if (this.state.status !== 'INACTIVE') throw schoolError('SCHOOL_INVALID_STATUS_TRANSITION');
    this.transition('ACTIVE', clock);
    this.record(SchoolEventTypes.SCHOOL_REACTIVATED, changedBy, clock);
  }

  /** Corrects the official GPS. Only while PENDING; after approval it is immutable in V1. Returns the previous fix. */
  correctGps(fix: GpsFix, changedBy: string, clock: Clock): GpsFix {
    if (this.state.status !== 'PENDING') throw schoolError('SCHOOL_GPS_LOCKED');
    const previous = this.state.gps;
    this.state = { ...this.state, gps: fix, updatedAt: clock.now() };
    this.record(SchoolEventTypes.SCHOOL_GPS_CORRECTED, changedBy, clock);
    return previous;
  }

  private transition(to: SchoolStatus, clock: Clock): void {
    if (!canTransitionSchoolStatus(this.state.status, to)) throw schoolError('SCHOOL_INVALID_STATUS_TRANSITION');
    this.state = { ...this.state, status: to, updatedAt: clock.now() };
  }

  private record(eventType: SchoolEventType, actorId: string, clock: Clock): void {
    this.addDomainEvent(
      createDomainEvent<SchoolEventPayload>(
        { eventType, aggregateType: SCHOOL_AGGREGATE_TYPE, aggregateId: this.id, payload: { schoolId: this.id, actorId } },
        clock,
      ),
    );
  }

  get snapshot(): SchoolSnapshot {
    return this.state;
  }
  get code(): string {
    return this.state.code;
  }
  get name(): string {
    return this.state.name;
  }
  get type(): SchoolType {
    return this.state.type;
  }
  get status(): SchoolStatus {
    return this.state.status;
  }
  get organizationId(): string {
    return this.state.organizationId;
  }
  get parentSchoolId(): string | null {
    return this.state.parentSchoolId;
  }
  get createdBy(): string {
    return this.state.createdBy;
  }
  get version(): number {
    return this.state.version;
  }
  /** A REJECTED request no longer holds its name (unique per organization among the other statuses). */
  get holdsName(): boolean {
    return this.state.status !== 'REJECTED';
  }
}
