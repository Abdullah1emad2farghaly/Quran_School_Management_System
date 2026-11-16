import type { ClassSession } from '../../domain/entities/class-session';
import type { CancelSource, SessionStatus, SlotRetirementReason } from '../../domain/value-objects/session-status';

export interface ClassSessionDto {
  readonly id: string;
  readonly schoolId: string;
  readonly groupId: string;
  readonly teacherId: string;
  readonly slotId: string;
  /** Business date (Africa/Cairo), `YYYY-MM-DD`. */
  readonly occurrenceDate: string;
  readonly scheduledStart: Date;
  readonly scheduledEnd: Date;
  readonly status: SessionStatus;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly cancelledBy: string | null;
  readonly cancelSource: CancelSource | null;
  readonly cancelReason: string | null;
  readonly slotRetireReason: SlotRetirementReason | null;
}

export const toSessionDto = (session: ClassSession): ClassSessionDto => ({ ...session.snapshot });
