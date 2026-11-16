import type { TransactionContext } from '../../../00-shared-kernel/public';

/**
 * What Module 20 needs from the Group Schedules module (Module 23) while it changes a group. Module 23 depends on Module 20, so Module 20 only
 * knows this port (the same way Module 18 knows `TeacherGroupDependencies`); the application connects the implementation. Both methods run INSIDE
 * the transaction of the Groups use case, after the group row has been locked, so the check and the change commit (or roll back) together.
 */
export interface GroupSchedulePort {
  /**
   * Called before a group's Teacher is changed to `teacherId` (not called when the Teacher stays the same). Throws (TEACHER_SCHEDULE_CONFLICT) when
   * the group's current schedule slots overlap the Teacher's slots in their other ACTIVE groups, in any school; the Teacher is then NOT changed.
   */
  assertTeacherCanTeach(group: { readonly id: string; readonly schoolId: string }, teacherId: string, tx: TransactionContext): Promise<void>;
  /**
   * Called after a group's Teacher was changed (assigned, replaced or removed: `teacherId` is the new Teacher, null when removed), in the same transaction.
   * Module 23 keeps the current Teacher on the group's ACTIVE slots, so a Teacher's schedule is read from its own table. The slots are NOT retired.
   */
  onTeacherChanged(groupId: string, teacherId: string | null, tx: TransactionContext): Promise<void>;
  /** Called when a group is archived: its ACTIVE slots are retired (kept as history). */
  retireSlotsOfArchivedGroup(groupId: string, actorId: string, tx: TransactionContext): Promise<void>;
}
