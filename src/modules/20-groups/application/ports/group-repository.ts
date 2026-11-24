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
  /**
   * Read-only, for the Group report (Module 38): the assignment periods of the GROUP that overlap the half-open range [`from`, `toExclusive`) (either bound optional), oldest first. An overlapping period
   * is one that started before `toExclusive` and was not ended before `from` (an open one has no end). The caller has already proven the group lies inside the requester's scope.
   */
  listAssignmentsOfGroupForReport(query: GroupRosterReportQuery, tx?: TransactionContext): Promise<GroupRosterReportRow[]>;
  /**
   * Read-only, for the Teacher report (Module 38): for every group of the given schools that EVER had the Teacher as its teacher, the group's identity and the events of its authoritative history that decide who teaches it
   * (CREATED, TEACHER_CHANGED, ARCHIVED), in the history's own order. Only the given schools are ever read (the caller passes the requester's authorized schools).
   */
  listTeacherTimelinesForReport(query: GroupTeacherTimelineQuery, tx?: TransactionContext): Promise<GroupTeacherTimelineRow[]>;
  /** True when the student is currently in an ACTIVE group whose Teacher is `teacherId`. */
  isStudentInActiveGroupOfTeacher(studentId: string, teacherId: string, tx?: TransactionContext): Promise<boolean>;
}

export interface GroupRosterReportQuery {
  readonly groupId: string;
  readonly from?: Date;
  readonly toExclusive?: Date;
}

/** One assignment period of a student in the group (the authoritative assignment history, never rebuilt from the current roster). `unassignedAt` is null while the period is open. */
export interface GroupRosterReportRow {
  readonly studentId: string;
  readonly assignedAt: Date;
  readonly unassignedAt: Date | null;
}

export interface GroupTeacherTimelineQuery {
  readonly teacherId: string;
  /** The schools to look in (an empty list matches nothing). */
  readonly schoolIds: readonly string[];
}

export interface GroupTeacherTimelineEvent {
  readonly action: 'CREATED' | 'TEACHER_CHANGED' | 'ARCHIVED';
  readonly occurredAt: Date;
  readonly newTeacherId: string | null;
}

export interface GroupTeacherTimelineRow {
  readonly groupId: string;
  readonly schoolId: string;
  readonly groupName: string;
  readonly learningMode: string;
  readonly events: readonly GroupTeacherTimelineEvent[];
}
