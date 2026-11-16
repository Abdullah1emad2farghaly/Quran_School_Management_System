import { AppError, SystemClock, type Clock, type TransactionContext, type UnitOfWork } from '../../../00-shared-kernel/public';
import { GroupErrorCodes, groupError, type GroupScopeDto, type GroupService } from '../../../20-groups/public';
import type { OutboxService } from '../../../06-domain-events-outbox/public';
import type { TeacherLookup } from '../../../18-teachers/public';
import { GroupScheduleSlot } from '../../domain/entities/group-schedule-slot';
import { ScheduleErrorCodes, scheduleError } from '../../domain/errors/schedule-errors';
import { assertValidRange, formatMinutes, parseDayOfWeek, parseMinutes, slotsOverlap, weekOrderOf, type DayOfWeek } from '../../domain/value-objects/schedule-time';
import { toSlotDto, type ActiveSlotDto, type OwnScheduleItemDto, type ScheduleSlotDto } from '../dto/schedule-dto';
import type { ScheduleRepository } from '../ports/schedule-repository';

/** The weekday and the two times of a slot, as the caller gives them (validated here: `HH:MM`, end after start). */
export interface SlotInput {
  readonly dayOfWeek: unknown;
  readonly startTime: unknown;
  readonly endTime: unknown;
}
/** What to change on a slot; at least one field. The rest is kept. */
export interface SlotChangeInput {
  readonly dayOfWeek?: unknown;
  readonly startTime?: unknown;
  readonly endTime?: unknown;
}

export interface GroupScheduleServiceDeps {
  readonly slots: ScheduleRepository;
  /** Module 20's public service, read-only here (plus the locking read of the group row). */
  readonly groups: Pick<GroupService, 'lockScopeById' | 'findScopeById' | 'getGroup'>;
  readonly teachers: Pick<TeacherLookup, 'findByUserId'>;
  readonly unitOfWork: UnitOfWork;
  readonly outbox: OutboxService;
  readonly clock?: Clock;
}

/** A slot as the conflict check compares it. */
interface Candidate {
  readonly dayOfWeek: DayOfWeek;
  readonly startMinute: number;
  readonly endMinute: number;
}

/** A refused change that lost a deadlock is run again this many times when the service owns the transaction. */
const MAX_ATTEMPTS = 3;
/** The conflicts reported in an error (the first ones in week order). */
const MAX_REPORTED_CONFLICTS = 10;

/**
 * Public application contract of Module 23 (Group Schedules), Master Specification §35 and §44 and the approved Module 23 decisions.
 *
 * It does NOT authorize its callers: routes use the Authorization Engine (`groups.schedule.*` permissions) first. What it enforces itself:
 *  - a slot is a weekday with a start and an end (`HH:MM`, local wall-clock time, end after start, never crossing midnight);
 *  - a group has at most ONE active slot per weekday, whatever the times and whether or not the group has a Teacher (a unique index is the last guard);
 *  - a Teacher's slots must not overlap across their ACTIVE groups in ANY school; boundaries that merely touch are allowed. The check runs inside the
 *    transaction after the group row and then the Teacher's schedule lock are taken, and reads this module's own rows with a locking (current) read
 *    (every slot carries its group's current Teacher), so two concurrent requests for the same Teacher never both pass and no other module's table is locked. Only ACTIVE groups and ACTIVE slots count. A group without a Teacher has no Teacher conflict;
 *  - assigning or replacing a group's Teacher is validated against the group's existing slots BEFORE it commits (Module 20 calls `assertTeacherCanTeach`
 *    inside its transaction, then `onTeacherChanged` so the slots follow the Teacher); removing or replacing a Teacher never retires a slot;
 *  - slots are immutable: a change retires the old slot (REPLACED) and creates the new one in ONE transaction, a removal retires it (REMOVED), archiving
 *    the group retires them (GROUP_ARCHIVED); retired slots are kept as history and are never deleted;
 *  - an ARCHIVED group's schedule is read-only (GROUP_ARCHIVED);
 *  - every change publishes an outbox event in the same transaction.
 */
export class GroupScheduleService {
  private readonly slots: ScheduleRepository;
  private readonly groups: GroupScheduleServiceDeps['groups'];
  private readonly teachers: GroupScheduleServiceDeps['teachers'];
  private readonly unitOfWork: UnitOfWork;
  private readonly outbox: OutboxService;
  private readonly clock: Clock;

  constructor(deps: GroupScheduleServiceDeps) {
    this.slots = deps.slots;
    this.groups = deps.groups;
    this.teachers = deps.teachers;
    this.unitOfWork = deps.unitOfWork;
    this.outbox = deps.outbox;
    this.clock = deps.clock ?? new SystemClock();
  }

  // ---------------------------------------------------------------------------------------------- changes

  /** Adds a slot to an ACTIVE group. */
  async addSlot(groupId: string, input: SlotInput, actorId: string, tx?: TransactionContext): Promise<ScheduleSlotDto> {
    const candidate = this.parseCandidate(input);
    return this.write(tx, async (t) => {
      const group = await this.lockGroupAndTeacher(groupId, t);
      this.assertWeekdayFree(await this.slots.listActiveByGroup(groupId, t), candidate.dayOfWeek);
      await this.assertNoTeacherConflict(group, [candidate], t);
      const slot = this.newSlot(group, candidate, actorId);
      await this.slots.insert(slot, group.teacherId, t);
      await this.outbox.publishFrom(slot, t);
      return toSlotDto(slot);
    });
  }

  /**
   * Changes a slot's weekday and/or times by ATOMIC REPLACEMENT: the old slot is retired (REPLACED, pointing at the new one) and the new slot is created
   * in the same transaction, after both the weekday rule and the Teacher conflict rule passed. A change that changes nothing returns the slot as is.
   */
  async changeSlot(groupId: string, slotId: string, change: SlotChangeInput, actorId: string, tx?: TransactionContext): Promise<ScheduleSlotDto> {
    if (change.dayOfWeek === undefined && change.startTime === undefined && change.endTime === undefined) throw scheduleError(ScheduleErrorCodes.SCHEDULE_UPDATE_EMPTY);
    const day = change.dayOfWeek === undefined ? undefined : parseDayOfWeek(change.dayOfWeek);
    const start = change.startTime === undefined ? undefined : parseMinutes(change.startTime);
    const end = change.endTime === undefined ? undefined : parseMinutes(change.endTime);
    return this.write(tx, async (t) => {
      const group = await this.lockGroupAndTeacher(groupId, t);
      const old = await this.requireActiveSlotOf(groupId, slotId, t);
      const o = old.snapshot;
      const candidate: Candidate = { dayOfWeek: day ?? o.dayOfWeek, startMinute: start ?? o.startMinute, endMinute: end ?? o.endMinute };
      assertValidRange(candidate.startMinute, candidate.endMinute);
      if (candidate.dayOfWeek === o.dayOfWeek && candidate.startMinute === o.startMinute && candidate.endMinute === o.endMinute) return toSlotDto(old);
      if (candidate.dayOfWeek !== o.dayOfWeek) {
        const others = (await this.slots.listActiveByGroup(groupId, t)).filter((s) => s.id !== old.id);
        this.assertWeekdayFree(others, candidate.dayOfWeek);
      }
      await this.assertNoTeacherConflict(group, [candidate], t);
      const replacement = this.newSlot(group, candidate, actorId);
      old.retire({ reason: 'REPLACED', actorId, clock: this.clock, replacedBySlotId: replacement.id });
      await this.slots.retire(old, t);
      await this.outbox.publishFrom(old, t);
      await this.slots.insert(replacement, group.teacherId, t);
      await this.outbox.publishFrom(replacement, t);
      return toSlotDto(replacement);
    });
  }

  /** Removes a slot: it is retired (REMOVED) and kept as history. */
  async removeSlot(groupId: string, slotId: string, actorId: string, tx?: TransactionContext): Promise<void> {
    await this.write(tx, async (t) => {
      await this.requireWritableGroup(groupId, t);
      const slot = await this.requireActiveSlotOf(groupId, slotId, t);
      slot.retire({ reason: 'REMOVED', actorId, clock: this.clock });
      await this.slots.retire(slot, t);
      await this.outbox.publishFrom(slot, t);
    });
  }

  // ---------------------------------------------------------------------------------------------- reads

  /** The group's ACTIVE slots in week order (Saturday first), then by start time. */
  async listSlots(groupId: string, tx?: TransactionContext): Promise<ScheduleSlotDto[]> {
    await this.requireGroup(groupId, tx);
    return sortSlots(await this.slots.listActiveByGroup(groupId, tx)).map(toSlotDto);
  }

  /** Every slot of the group, active and retired, oldest first. */
  async listHistory(groupId: string, tx?: TransactionContext): Promise<ScheduleSlotDto[]> {
    await this.requireGroup(groupId, tx);
    return (await this.slots.listAllByGroup(groupId, tx)).map(toSlotDto);
  }

  /** A Teacher's own weekly schedule: the ACTIVE slots of the ACTIVE groups they teach, in every school; Saturday first. Empty for a non-Teacher. */
  async listOwnSchedule(userId: string, tx?: TransactionContext): Promise<OwnScheduleItemDto[]> {
    const teacher = await this.teachers.findByUserId(userId, tx);
    if (!teacher) return [];
    const slots = sortSlots(await this.slots.listActiveByTeacher(teacher.id, null, tx));
    if (slots.length === 0) return [];
    const names = new Map<string, { name: string; schoolId: string }>();
    for (const id of new Set(slots.map((s) => s.snapshot.groupId))) {
      const group = await this.groups.getGroup(id, tx);
      names.set(id, { name: group.name, schoolId: group.schoolId });
    }
    return slots.map((slot) => {
      const s = slot.snapshot;
      const group = names.get(s.groupId)!;
      return { id: s.id, groupId: s.groupId, groupName: group.name, schoolId: group.schoolId, dayOfWeek: s.dayOfWeek, startTime: formatMinutes(s.startMinute), endTime: formatMinutes(s.endMinute) };
    });
  }

  // ---------------------------------------------------------------------------------------------- the port Module 20 calls (GroupSchedulePort)

  /**
   * Called by Module 20 inside `assignTeacher`, after the group row is locked and before the Teacher is changed: the group's current slots must not
   * overlap the Teacher's slots in their other ACTIVE groups. A group without slots has nothing to check.
   */
  async assertTeacherCanTeach(group: { readonly id: string; readonly schoolId: string }, teacherId: string, tx: TransactionContext): Promise<void> {
    // The group row is locked by the caller, so every write to this group's slots has committed: a plain read of them is current.
    const own = await this.slots.listActiveByGroup(group.id, tx);
    if (own.length === 0) return;
    await this.slots.lockTeachers([teacherId], tx);
    // The caller's transaction may already hold an older snapshot (Module 20 reads before it calls this): the Teacher's slots are read with a locking read.
    await this.assertNoConflict(teacherId, group.schoolId, group.id, own.map((s) => s.snapshot), tx, true);
  }

  /**
   * Called by Module 20 after it changed a group's Teacher (assigned, replaced or removed), in the same transaction: the group's ACTIVE slots follow the
   * new Teacher (null when removed). Nothing is retired or deleted: slots stay when the Teacher leaves.
   */
  async onTeacherChanged(groupId: string, teacherId: string | null, tx: TransactionContext): Promise<void> {
    await this.slots.setTeacherOfGroup(groupId, teacherId, tx);
  }

  /** Called by Module 20 inside `archiveGroup`: every ACTIVE slot is retired (GROUP_ARCHIVED) and kept as history. */
  async retireSlotsOfArchivedGroup(groupId: string, actorId: string, tx: TransactionContext): Promise<void> {
    for (const slot of await this.slots.listActiveByGroup(groupId, tx)) {
      slot.retire({ reason: 'GROUP_ARCHIVED', actorId, clock: this.clock });
      await this.slots.retire(slot, tx);
      await this.outbox.publishFrom(slot, tx);
    }
  }

  // ---------------------------------------------------------------------------------------------- internals

  private parseCandidate(input: SlotInput): Candidate {
    const dayOfWeek = parseDayOfWeek(input.dayOfWeek);
    const startMinute = parseMinutes(input.startTime);
    const endMinute = parseMinutes(input.endTime);
    assertValidRange(startMinute, endMinute);
    return { dayOfWeek, startMinute, endMinute };
  }

  private newSlot(group: GroupScopeDto, c: Candidate, actorId: string): GroupScheduleSlot {
    return GroupScheduleSlot.create({ groupId: group.id, schoolId: group.schoolId, dayOfWeek: c.dayOfWeek, startTime: formatMinutes(c.startMinute), endTime: formatMinutes(c.endMinute), createdBy: actorId, clock: this.clock });
  }

  /** A group has at most one ACTIVE slot per weekday: whatever the times, a second one on the same weekday is refused. */
  private assertWeekdayFree(active: readonly GroupScheduleSlot[], day: DayOfWeek): void {
    if (active.some((s) => s.snapshot.dayOfWeek === day)) throw scheduleError(ScheduleErrorCodes.SCHEDULE_DAY_ALREADY_HAS_SLOT, { dayOfWeek: day });
  }

  /**
   * The lock order of a slot change: the group row (the same lock Module 20 takes), then the Teacher's schedule lock. Nothing is read plainly before both
   * are held, so the plain reads that follow start a fresh snapshot, and no range-locking read is used (their gap locks would make unrelated groups'
   * inserts wait for each other and deadlock).
   */
  /**
   * Read-only, for Module 24 (Sessions): every ACTIVE slot of every group with its school and the group's current Teacher. Changes nothing; no Module 23
   * rule depends on it. Retired slots are never returned, so a retired slot never produces a session.
   */
  async listActiveSlotsForSessions(tx?: TransactionContext): Promise<ActiveSlotDto[]> {
    return (await this.slots.listAllActive(tx)).map(({ slot, teacherId }) => {
      const s = slot.snapshot;
      return { id: s.id, groupId: s.groupId, schoolId: s.schoolId, teacherId, dayOfWeek: s.dayOfWeek, startTime: formatMinutes(s.startMinute), endTime: formatMinutes(s.endMinute), createdAt: s.createdAt };
    });
  }

  /** Read-only, for Module 24: the slots (ACTIVE or RETIRED, with the retirement reason and time) with these ids. */
  async findSlotsByIds(ids: readonly string[], tx?: TransactionContext): Promise<ScheduleSlotDto[]> {
    return (await this.slots.findByIds(ids, tx)).map(toSlotDto);
  }

  private async lockGroupAndTeacher(groupId: string, t: TransactionContext): Promise<GroupScopeDto> {
    const group = await this.requireWritableGroup(groupId, t);
    if (group.teacherId) await this.slots.lockTeachers([group.teacherId], t);
    return group;
  }

  /** Locks the group row (the same lock Module 20 takes) and refuses a missing or ARCHIVED group. */
  private async requireWritableGroup(groupId: string, t: TransactionContext): Promise<GroupScopeDto> {
    const group = await this.groups.lockScopeById(groupId, t);
    if (!group) throw groupError(GroupErrorCodes.GROUP_NOT_FOUND);
    if (group.status === 'ARCHIVED') throw groupError(GroupErrorCodes.GROUP_ARCHIVED);
    return group;
  }

  private async requireGroup(groupId: string, tx?: TransactionContext): Promise<void> {
    if (!(await this.groups.findScopeById(groupId, tx))) throw groupError(GroupErrorCodes.GROUP_NOT_FOUND);
  }

  private async requireActiveSlotOf(groupId: string, slotId: string, t: TransactionContext): Promise<GroupScheduleSlot> {
    const slot = await this.slots.lockById(slotId, t);
    if (!slot || !slot.isActive || slot.snapshot.groupId !== groupId) throw scheduleError(ScheduleErrorCodes.SCHEDULE_SLOT_NOT_FOUND);
    return slot;
  }

  /** The Teacher rule for a group that has a Teacher (their schedule lock is already held, see `lockGroupAndTeacher`): compare with their other ACTIVE groups. */
  private async assertNoTeacherConflict(group: GroupScopeDto, candidates: readonly Candidate[], t: TransactionContext): Promise<void> {
    if (!group.teacherId) return;
    await this.assertNoConflict(group.teacherId, group.schoolId, group.id, candidates, t, false);
  }

  /**
   * `candidates` must not overlap (same weekday, shared time) any ACTIVE slot of the Teacher's OTHER ACTIVE groups. The group's own slots are excluded:
   * on the same weekday they are covered by the one-slot-per-weekday rule (a change replaces its own old slot).
   */
  private async assertNoConflict(teacherId: string, schoolId: string, groupId: string, candidates: readonly Candidate[], t: TransactionContext, lockingRead: boolean): Promise<void> {
    // The Teacher's schedule lock is held and only this module's own rows are read. Every writer that could change the Teacher's slots holds that lock until it
    // commits, so what is read now is current provided the read is not served from an older snapshot: after the lock, the first plain read of a transaction
    // starts its snapshot (the slot path: nothing is read plainly before the lock), and a caller that may already hold an older one asks for a locking read.
    const others = sortSlots(await this.slots.listActiveByTeacher(teacherId, groupId, t, lockingRead));
    const hits = others.filter((o) => candidates.some((c) => c.dayOfWeek === o.snapshot.dayOfWeek && slotsOverlap(c, o.snapshot)));
    if (hits.length === 0) return;
    const names = new Map<string, string>();
    const conflicts = [];
    for (const hit of hits.slice(0, MAX_REPORTED_CONFLICTS)) {
      const s = hit.snapshot;
      const entry: { dayOfWeek: DayOfWeek; startTime: string; endTime: string; group?: { id: string; name: string } } = { dayOfWeek: s.dayOfWeek, startTime: formatMinutes(s.startMinute), endTime: formatMinutes(s.endMinute) };
      // The conflicting group is named only when it belongs to the SAME school: another school's groups are never revealed (only the time is).
      if (s.schoolId === schoolId) {
        if (!names.has(s.groupId)) names.set(s.groupId, (await this.groups.getGroup(s.groupId, t)).name);
        entry.group = { id: s.groupId, name: names.get(s.groupId)! };
      }
      conflicts.push(entry);
    }
    throw scheduleError(ScheduleErrorCodes.TEACHER_SCHEDULE_CONFLICT, { conflicts });
  }

  /**
   * Runs a change in one transaction. When the service owns the transaction, a deadlock victim (SCHEDULE_CONCURRENT_MODIFICATION) is run again, so
   * two simultaneous requests for the same Teacher end with the true outcome (success, or the conflict) instead of a technical error. With the
   * caller's transaction nothing can be retried here: the caller owns it and receives the retryable 409.
   */
  private async write<T>(tx: TransactionContext | undefined, work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    if (tx) return work(tx);
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.unitOfWork.run(work);
      } catch (error) {
        const raced = error instanceof AppError && error.code === ScheduleErrorCodes.SCHEDULE_CONCURRENT_MODIFICATION;
        if (!raced || attempt >= MAX_ATTEMPTS) throw error;
      }
    }
  }
}

/** Week order (Saturday first), then start time, then end time, then id. */
function sortSlots(slots: readonly GroupScheduleSlot[]): GroupScheduleSlot[] {
  return [...slots].sort((a, b) => weekOrderOf(a.snapshot.dayOfWeek) - weekOrderOf(b.snapshot.dayOfWeek) || a.snapshot.startMinute - b.snapshot.startMinute || a.snapshot.endMinute - b.snapshot.endMinute || (a.id < b.id ? -1 : 1));
}
