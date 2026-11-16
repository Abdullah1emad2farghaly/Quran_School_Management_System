import { AggregateRoot, newUuid, type Clock } from '../../../00-shared-kernel/public';
import { createDomainEvent } from '../../../06-domain-events-outbox/public';
import { SCHEDULE_SLOT_AGGREGATE_TYPE, ScheduleEventTypes, type ScheduleEventPayload } from '../events/schedule-events';
import { assertValidRange, formatMinutes, parseDayOfWeek, parseMinutes, type DayOfWeek } from '../value-objects/schedule-time';

export const SLOT_RETIRE_REASONS = ['REPLACED', 'REMOVED', 'GROUP_ARCHIVED'] as const;
export type SlotRetireReason = (typeof SLOT_RETIRE_REASONS)[number];

export interface GroupScheduleSlotSnapshot {
  readonly id: string;
  readonly groupId: string;
  /** Denormalized (the group's school) for events and cross-school conflict reporting; a group never changes school. */
  readonly schoolId: string;
  readonly dayOfWeek: DayOfWeek;
  /** Local wall-clock time as minutes since midnight (0-1439). */
  readonly startMinute: number;
  readonly endMinute: number;
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly retiredAt: Date | null;
  readonly retiredBy: string | null;
  readonly retireReason: SlotRetireReason | null;
  /** For REPLACED: the slot that took its place. */
  readonly replacedBySlotId: string | null;
}

/**
 * One recurring slot of a group: a weekday with a start and an end (Master Specification §44). A slot is IMMUTABLE: its day and times never change.
 * A change retires it (REPLACED) and creates a new slot; a removal retires it (REMOVED); archiving the group retires it (GROUP_ARCHIVED). Retired slots
 * are kept as history (Sessions will refer to slots), never deleted. A group has at most ONE active slot per weekday (a unique index is the last guard).
 */
export class GroupScheduleSlot extends AggregateRoot<string> {
  private constructor(private state: GroupScheduleSlotSnapshot) {
    super(state.id);
  }

  /** Validates the weekday and the times (HH:MM, end after start). */
  static create(input: { groupId: string; schoolId: string; dayOfWeek: unknown; startTime: unknown; endTime: unknown; createdBy: string; clock: Clock; id?: string }): GroupScheduleSlot {
    const dayOfWeek = parseDayOfWeek(input.dayOfWeek);
    const startMinute = parseMinutes(input.startTime);
    const endMinute = parseMinutes(input.endTime);
    assertValidRange(startMinute, endMinute);
    const slot = new GroupScheduleSlot({
      id: input.id ?? newUuid(),
      groupId: input.groupId,
      schoolId: input.schoolId,
      dayOfWeek,
      startMinute,
      endMinute,
      createdAt: input.clock.now(),
      createdBy: input.createdBy,
      retiredAt: null,
      retiredBy: null,
      retireReason: null,
      replacedBySlotId: null,
    });
    slot.recordEvent(ScheduleEventTypes.SLOT_CREATED, input.createdBy, input.clock);
    return slot;
  }

  static rehydrate(snapshot: GroupScheduleSlotSnapshot): GroupScheduleSlot {
    return new GroupScheduleSlot(snapshot);
  }

  get snapshot(): GroupScheduleSlotSnapshot {
    return this.state;
  }
  get isActive(): boolean {
    return this.state.retiredAt === null;
  }

  /** Retires the slot. Retiring a retired slot is a no-op returning false. */
  retire(input: { reason: SlotRetireReason; actorId: string; clock: Clock; replacedBySlotId?: string }): boolean {
    if (!this.isActive) return false;
    this.state = { ...this.state, retiredAt: input.clock.now(), retiredBy: input.actorId, retireReason: input.reason, replacedBySlotId: input.replacedBySlotId ?? null };
    this.recordEvent(ScheduleEventTypes.SLOT_RETIRED, input.actorId, input.clock, { reason: input.reason, replacedBySlotId: this.state.replacedBySlotId });
    return true;
  }

  private recordEvent(eventType: (typeof ScheduleEventTypes)[keyof typeof ScheduleEventTypes], actorId: string, clock: Clock, extra: Partial<ScheduleEventPayload> = {}): void {
    const s = this.state;
    this.addDomainEvent(
      createDomainEvent<ScheduleEventPayload>(
        {
          eventType,
          aggregateType: SCHEDULE_SLOT_AGGREGATE_TYPE,
          aggregateId: this.id,
          payload: { slotId: s.id, groupId: s.groupId, schoolId: s.schoolId, dayOfWeek: s.dayOfWeek, startTime: formatMinutes(s.startMinute), endTime: formatMinutes(s.endMinute), actorId, ...extra },
        },
        clock,
      ),
    );
  }
}
