import type { CollectorSchoolLink } from '../../domain/entities/collector-school-link';
import type { Subscription } from '../../domain/entities/subscription';
import type { SubscriptionBatch } from '../../domain/entities/subscription-batch';
import type { SubscriptionStatus } from '../../domain/value-objects/subscription-status';

export interface SubscriptionDto {
  readonly id: string;
  readonly studentId: string;
  readonly schoolId: string;
  readonly organizationId: string;
  /** `YYYY-MM` (Africa/Cairo). */
  readonly month: string;
  readonly status: SubscriptionStatus;
  readonly createdAt: Date;
  readonly paidAt: Date | null;
  readonly waivedAt: Date | null;
  readonly updatedAt: Date;
}

/** A subscription as a reader sees it: the student's name is read through the Students public contract (it is not stored by this module). */
export interface SubscriptionViewDto extends SubscriptionDto {
  readonly studentName: string | null;
}

/** The scope a school-bound reader needs (read from the server, never from the client). */
export interface SubscriptionScopeDto {
  readonly id: string;
  readonly schoolId: string;
  readonly organizationId: string;
  readonly studentId: string;
}

export interface BulkCreationResultDto {
  readonly batchId: string;
  readonly schoolId: string;
  readonly month: string;
  /** How many subscriptions were created (one per ACTIVE student, all UNPAID). */
  readonly count: number;
  readonly createdAt: Date;
}

export interface SubscriptionBatchDto {
  readonly id: string;
  readonly schoolId: string;
  readonly organizationId: string;
  readonly month: string;
  readonly count: number;
  readonly createdAt: Date;
}

export interface CollectorDto {
  readonly userId: string;
  readonly organizationId: string;
  /** The account's canonical three-part personal name (Module 08). */
  readonly name: string;
  /** The normalized phone (the login identity, Module 08). */
  readonly phone: string;
  /** The schools the Collector is currently linked to (all in the same organization). */
  readonly schoolIds: readonly string[];
}

export interface CollectorSchoolLinkDto {
  readonly id: string;
  readonly userId: string;
  readonly schoolId: string;
  readonly linkedAt: Date;
  readonly linkedBy: string;
  readonly unlinkedAt: Date | null;
  readonly unlinkedBy: string | null;
  readonly isActive: boolean;
}

export function toSubscriptionDto(subscription: Subscription): SubscriptionDto {
  const s = subscription.snapshot;
  return { id: s.id, studentId: s.studentId, schoolId: s.schoolId, organizationId: s.organizationId, month: s.month, status: s.status, createdAt: s.createdAt, paidAt: s.paidAt, waivedAt: s.waivedAt, updatedAt: s.updatedAt };
}

export function toBatchDto(batch: SubscriptionBatch): SubscriptionBatchDto {
  const s = batch.snapshot;
  return { id: s.id, schoolId: s.schoolId, organizationId: s.organizationId, month: s.month, count: s.count, createdAt: s.createdAt };
}

export function toCollectorLinkDto(link: CollectorSchoolLink): CollectorSchoolLinkDto {
  const s = link.snapshot;
  return { id: s.id, userId: s.userId, schoolId: s.schoolId, linkedAt: s.linkedAt, linkedBy: s.linkedBy, unlinkedAt: s.unlinkedAt, unlinkedBy: s.unlinkedBy, isActive: link.isActive };
}

/**
 * The subscription statistics of ONE existing educational group for ONE month (Module 33 group summary). The counts are over the group's regular/active students:
 *   totalStudents = paidStudents + unpaidStudents + waivedStudents + withoutSubscription
 * WAIVED students are in `totalStudents` (and in `waivedStudents`) but in neither `paidStudents` nor `unpaidStudents`. A student with NO subscription record for the month
 * is never counted as paid or unpaid: they are in `totalStudents` and in `withoutSubscription` only.
 */
export interface GroupSubscriptionSummaryDto {
  readonly groupId: string;
  readonly groupName: string;
  /** `YYYY-MM`: the month the statistics are for. */
  readonly month: string;
  /** True when the monthly BULK creation of this school and month was done (when false, `withoutSubscription` is expected to equal `totalStudents`). */
  readonly subscriptionsCreated: boolean;
  readonly paidStudents: number;
  readonly unpaidStudents: number;
  readonly waivedStudents: number;
  readonly withoutSubscription: number;
  readonly totalStudents: number;
}

/** One regular/active student of a group with the status of their subscription for the month (`status` and `subscriptionId` are null when there is no record). */
export interface GroupStudentSubscriptionDto {
  readonly studentId: string;
  readonly studentName: string;
  readonly month: string;
  readonly subscriptionId: string | null;
  readonly status: SubscriptionStatus | null;
  readonly hasSubscription: boolean;
}
