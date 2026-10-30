/**
 * Session lifecycle (Master Specification §45): SCHEDULED -> OPEN -> IN_PROGRESS -> COMPLETED, or CANCELLED.
 * Under the approved generation rule a session is created 15 minutes before its start, already OPEN; the system moves it to IN_PROGRESS at its start and to
 * COMPLETED at its end. No code path produces SCHEDULED (it is kept because the specification lists it; see docs/CLASS-SESSIONS.md, open question 1).
 */
export const SESSION_STATUSES = ['SCHEDULED', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** Who or what cancelled a session: the assigned Teacher, or the system because the group's schedule slot was retired before the session started. */
export const CANCEL_SOURCES = ['TEACHER', 'SCHEDULE_SLOT_RETIRED'] as const;
export type CancelSource = (typeof CANCEL_SOURCES)[number];

/** Why a schedule slot was retired (Module 23's reasons). Recorded on a session cancelled because of it. */
export const SLOT_RETIREMENT_REASONS = ['REPLACED', 'REMOVED', 'GROUP_ARCHIVED'] as const;
export type SlotRetirementReason = (typeof SLOT_RETIREMENT_REASONS)[number];

/** A session is created this many minutes before its scheduled start (approved decision; also the start of the Teacher's protected-action window, §45). */
export const SESSION_LEAD_MINUTES = 15;

export const MAX_CANCEL_REASON_LENGTH = 500;
