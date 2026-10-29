import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { GroupScheduleSlot } from '../../domain/entities/group-schedule-slot';

/** Persistence of schedule slots (the tables of Module 23; no other module's table is read here). Slots are never deleted. */
export interface ScheduleRepository {
  /** The unique (group, weekday, active) index is the final guard: a second active slot on the same weekday is SCHEDULE_DAY_ALREADY_HAS_SLOT. */
  insert(slot: GroupScheduleSlot, teacherId: string | null, tx: TransactionContext): Promise<void>;
  /** Keeps `teacher_id` of the group's ACTIVE slots in step with the group's current Teacher (null = none). Retired slots keep what they had. */
  setTeacherOfGroup(groupId: string, teacherId: string | null, tx: TransactionContext): Promise<void>;
  /** Persists the retirement (only the retirement columns change). A deadlock victim is SCHEDULE_CONCURRENT_MODIFICATION. */
  retire(slot: GroupScheduleSlot, tx: TransactionContext): Promise<void>;
  /** FOR UPDATE. */
  lockById(id: string, tx: TransactionContext): Promise<GroupScheduleSlot | undefined>;
  /** The ACTIVE slots of a group. With `lock` it is a LOCKING (current) read (it takes range locks: not used on the slot path). */
  listActiveByGroup(groupId: string, tx?: TransactionContext, lock?: boolean): Promise<GroupScheduleSlot[]>;
  /** Every slot of the group, active and retired, oldest first. */
  listAllByGroup(groupId: string, tx?: TransactionContext): Promise<GroupScheduleSlot[]>;
  /** The ACTIVE slots of these groups (a Teacher's own schedule). */
  listActiveByGroups(groupIds: readonly string[], tx?: TransactionContext): Promise<GroupScheduleSlot[]>;
  /**
   * The ACTIVE slots of the groups the Teacher teaches now (any school), except `exceptGroupId`'s. With `lock` it is a LOCKING (current) read of this
   * module's own rows only: it never reads or locks another module's table, and it never uses a snapshot older than the lock the caller holds.
   */
  listActiveByTeacher(teacherId: string, exceptGroupId: string | null, tx?: TransactionContext, lock?: boolean): Promise<GroupScheduleSlot[]>;
  /**
   * Serializes every schedule change that involves these Teachers until the transaction ends (one lock row per Teacher, taken in a fixed order).
   * This is what makes the Teacher conflict check concurrency-safe: the check and the change of two requests for the same Teacher never interleave.
   */
  lockTeachers(teacherIds: readonly string[], tx: TransactionContext): Promise<void>;
}
