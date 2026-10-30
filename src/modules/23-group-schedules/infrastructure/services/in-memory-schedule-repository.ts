import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { ScheduleRepository } from '../../application/ports/schedule-repository';
import { GroupScheduleSlot, type GroupScheduleSlotSnapshot } from '../../domain/entities/group-schedule-slot';
import { scheduleError } from '../../domain/errors/schedule-errors';

/** In-memory ScheduleRepository with the same uniqueness and ordering as the SQL one. For tests of this and other modules. */
export class InMemoryScheduleRepository implements ScheduleRepository {
  /** Every slot ever stored (slots are never deleted). */
  readonly slots = new Map<string, GroupScheduleSlotSnapshot>();
  /** The Teacher of each slot's group (a column of the SQL table, not part of the entity). */
  private readonly teachers = new Map<string, string | null>();
  /** Insertion order: the history order. */
  private readonly order: string[] = [];

  async insert(slot: GroupScheduleSlot, teacherId: string | null, _tx: TransactionContext): Promise<void> {
    const s = slot.snapshot;
    for (const row of this.slots.values()) {
      if (row.groupId === s.groupId && row.dayOfWeek === s.dayOfWeek && row.retiredAt === null && s.retiredAt === null) throw scheduleError('SCHEDULE_DAY_ALREADY_HAS_SLOT', { dayOfWeek: s.dayOfWeek });
    }
    this.slots.set(s.id, { ...s });
    this.teachers.set(s.id, teacherId);
    this.order.push(s.id);
  }

  async setTeacherOfGroup(groupId: string, teacherId: string | null, _tx: TransactionContext): Promise<void> {
    for (const row of this.slots.values()) if (row.groupId === groupId && row.retiredAt === null) this.teachers.set(row.id, teacherId);
  }

  async retire(slot: GroupScheduleSlot, _tx: TransactionContext): Promise<void> {
    const row = this.slots.get(slot.id);
    if (!row) throw scheduleError('SCHEDULE_SLOT_NOT_FOUND');
    const s = slot.snapshot;
    // Only the retirement columns change; the day and the times never do.
    this.slots.set(s.id, { ...row, retiredAt: s.retiredAt, retiredBy: s.retiredBy, retireReason: s.retireReason, replacedBySlotId: s.replacedBySlotId });
  }

  async lockById(id: string, _tx: TransactionContext): Promise<GroupScheduleSlot | undefined> {
    const row = this.slots.get(id);
    return row ? GroupScheduleSlot.rehydrate({ ...row }) : undefined;
  }

  async listActiveByGroup(groupId: string, _tx?: TransactionContext, _lock?: boolean): Promise<GroupScheduleSlot[]> {
    return this.rows().filter((r) => r.groupId === groupId && r.retiredAt === null).map((r) => GroupScheduleSlot.rehydrate({ ...r }));
  }

  async listAllByGroup(groupId: string, _tx?: TransactionContext): Promise<GroupScheduleSlot[]> {
    return this.rows().filter((r) => r.groupId === groupId).map((r) => GroupScheduleSlot.rehydrate({ ...r }));
  }

  async listActiveByGroups(groupIds: readonly string[], _tx?: TransactionContext): Promise<GroupScheduleSlot[]> {
    const ids = new Set(groupIds);
    return this.rows().filter((r) => ids.has(r.groupId) && r.retiredAt === null).map((r) => GroupScheduleSlot.rehydrate({ ...r }));
  }

  async listActiveByTeacher(teacherId: string, exceptGroupId: string | null, _tx?: TransactionContext, _lock?: boolean): Promise<GroupScheduleSlot[]> {
    return this.rows()
      .filter((r) => r.retiredAt === null && this.teachers.get(r.id) === teacherId && r.groupId !== exceptGroupId)
      .map((r) => GroupScheduleSlot.rehydrate({ ...r }));
  }

  /** In memory the requests of a test run one after another: nothing to serialize. */
  async lockTeachers(_teacherIds: readonly string[], _tx: TransactionContext): Promise<void> {}

  async listAllActive(_tx?: TransactionContext): Promise<Array<{ slot: GroupScheduleSlot; teacherId: string | null }>> {
    return this.rows()
      .filter((r) => r.retiredAt === null)
      .map((r) => ({ slot: GroupScheduleSlot.rehydrate({ ...r }), teacherId: this.teachers.get(r.id) ?? null }));
  }

  async findByIds(ids: readonly string[], _tx?: TransactionContext): Promise<GroupScheduleSlot[]> {
    const wanted = new Set(ids);
    return this.rows().filter((r) => wanted.has(r.id)).map((r) => GroupScheduleSlot.rehydrate({ ...r }));
  }

  private rows(): GroupScheduleSlotSnapshot[] {
    return this.order.map((id) => this.slots.get(id)!);
  }

  snapshot(): { slots: Array<[string, GroupScheduleSlotSnapshot]>; teachers: Array<[string, string | null]>; order: string[] } {
    return { slots: [...this.slots], teachers: [...this.teachers], order: [...this.order] };
  }
  restore(saved: { slots: Array<[string, GroupScheduleSlotSnapshot]>; teachers: Array<[string, string | null]>; order: string[] }): void {
    this.slots.clear();
    this.teachers.clear();
    saved.slots.forEach(([k, v]) => this.slots.set(k, v));
    saved.teachers.forEach(([k, v]) => this.teachers.set(k, v));
    this.order.splice(0, this.order.length, ...saved.order);
  }
}
