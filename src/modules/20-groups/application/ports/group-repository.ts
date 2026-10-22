import type { PageRequest, TransactionContext } from '../../../00-shared-kernel/public';
import type { Group } from '../../domain/entities/group';
import type { GroupAssignment } from '../../domain/entities/group-assignment';
import type { GroupHistoryEntry } from '../../domain/entities/group-history-entry';
import type { GroupStatus } from '../../domain/value-objects/group-settings';

export type GroupSortKey = 'createdAt' | 'name';

export interface GroupListQuery {
  readonly sort: GroupSortKey;
  readonly direction: 'asc' | 'desc';
  readonly status?: readonly GroupStatus[];
  readonly page: PageRequest;
}

/** Persistence of groups, their history and the student assignments (all tables of Module 20; nothing of other modules is read here). */
export interface GroupRepository {
  /** The unique (school, name key, active) index is the final guard: a duplicate ACTIVE name is GROUP_NAME_CONFLICT. */
  insert(group: Group, tx: TransactionContext): Promise<void>;
  /** Optimistic lock on `version`; a name that became taken is GROUP_NAME_CONFLICT. Stale: GROUP_CONCURRENT_MODIFICATION. */
  update(group: Group, tx: TransactionContext): Promise<void>;
  insertHistory(entries: readonly GroupHistoryEntry[], tx: TransactionContext): Promise<void>;
  findById(id: string, tx?: TransactionContext): Promise<Group | undefined>;
  /** FOR UPDATE: serializes assignments, moves, teacher changes and the archive of the same group. */
  lockById(id: string, tx: TransactionContext): Promise<Group | undefined>;
  findActiveByNameKey(schoolId: string, nameKey: string, tx?: TransactionContext): Promise<Group | undefined>;
  listBySchool(schoolId: string, query: GroupListQuery, tx?: TransactionContext): Promise<{ items: Group[]; total: number }>;
  /** The ACTIVE groups whose Teacher is `teacherId` (every school the Teacher is linked to). */
  listActiveByTeacher(teacherId: string, page: PageRequest, direction: 'asc' | 'desc', tx?: TransactionContext): Promise<{ items: Group[]; total: number }>;
  /** ACTIVE groups of the Teacher in the school: a LOCKING read (the Teacher unlink guard of Module 18). */
  countActiveByTeacherInSchool(teacherId: string, schoolId: string, tx: TransactionContext): Promise<number>;
  listHistory(groupId: string, tx?: TransactionContext): Promise<GroupHistoryEntry[]>;

  /** The unique (student, active) index is the final guard: a second current assignment is GROUP_STUDENT_ALREADY_ASSIGNED. */
  insertAssignment(assignment: GroupAssignment, tx: TransactionContext): Promise<void>;
  /** Persists the end of a period (only the end columns change). */
  updateAssignment(assignment: GroupAssignment, tx: TransactionContext): Promise<void>;
  findCurrentAssignmentOfStudent(studentId: string, tx?: TransactionContext): Promise<GroupAssignment | undefined>;
  lockCurrentAssignmentOfStudent(studentId: string, tx: TransactionContext): Promise<GroupAssignment | undefined>;
  listCurrentAssignments(groupId: string, tx?: TransactionContext): Promise<GroupAssignment[]>;
  listCurrentAssignmentsPage(groupId: string, page: PageRequest, direction: 'asc' | 'desc', tx?: TransactionContext): Promise<{ items: GroupAssignment[]; total: number }>;
  /** Every period of the student, oldest first. */
  listAssignmentsOfStudent(studentId: string, tx?: TransactionContext): Promise<GroupAssignment[]>;
  /** True when the student is currently in an ACTIVE group whose Teacher is `teacherId`. */
  isStudentInActiveGroupOfTeacher(studentId: string, teacherId: string, tx?: TransactionContext): Promise<boolean>;
}
