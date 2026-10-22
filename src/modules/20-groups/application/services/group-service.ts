import { SystemClock, buildPageResult, type Clock, type PageRequest, type PageResult, type TransactionContext, type UnitOfWork } from '../../../00-shared-kernel/public';
import type { OutboxService } from '../../../06-domain-events-outbox/public';
import type { SchoolLookup } from '../../../16-schools/public';
import type { TeacherLookup, TeacherSchoolLinkLocker } from '../../../18-teachers/public';
import type { StudentLookup } from '../../../19-students/public';
import { Group } from '../../domain/entities/group';
import { GroupAssignment } from '../../domain/entities/group-assignment';
import { groupError } from '../../domain/errors/group-errors';
import { groupNameKey, normalizeGroupName, normalizeGroupReason, requireLearningMode, requireProgression, requireStartingSurah, type GroupStatus } from '../../domain/value-objects/group-settings';
import { toAssignmentDto, toGroupDto, type GroupDto, type GroupHistoryDto, type GroupScopeDto, type GroupStudentDto, type StudentAssignmentDto } from '../dto/group-dto';
import type { GroupRepository, GroupSortKey } from '../ports/group-repository';

export interface CreateGroupInput {
  readonly schoolId: string;
  readonly name: unknown;
  readonly learningMode: unknown;
  readonly progression: unknown;
  readonly startingSurah: unknown;
  /** Optional: a group may exist without a Teacher for a while. */
  readonly teacherId?: string | null;
}
export interface UpdateGroupInput {
  readonly name?: unknown;
  readonly learningMode?: unknown;
  readonly progression?: unknown;
  readonly startingSurah?: unknown;
}
export interface ListGroupsInput {
  readonly sort?: GroupSortKey;
  readonly direction?: 'asc' | 'desc';
  readonly status?: readonly GroupStatus[];
  readonly page: PageRequest;
}

export interface GroupServiceDeps {
  readonly groups: GroupRepository;
  readonly schools: Pick<SchoolLookup, 'findById'>;
  readonly teachers: TeacherLookup & TeacherSchoolLinkLocker;
  readonly students: StudentLookup;
  readonly unitOfWork: UnitOfWork;
  readonly outbox: OutboxService;
  readonly clock?: Clock;
}

/**
 * Public application contract of Module 20 (Groups), Master Specification §40-§43 and the approved Module 20 decisions.
 *
 * It does NOT authorize its callers: routes use the Authorization Engine (`groups.*` permissions, see group-authorization.ts) first. What it
 * enforces itself are the business rules:
 *  - a group belongs to ONE ACTIVE school, has a name unique among the ACTIVE groups of that school (an ARCHIVED group's name is free again),
 *    a learning mode (GROUP / INDIVIDUAL), a progression (FORWARD / BACKWARD) and a Starting Surah (1-114; surah names belong to Module 21);
 *    it has no schedule (Module 23);
 *  - at most ONE Teacher, who must be actively linked to the group's school (the link row is locked, so a concurrent unlink cannot slip past;
 *    Module 18's unlink guard counts the Teacher's ACTIVE groups); a Teacher can teach several groups or none;
 *  - a student is in at most ONE group at a time (unique index), in the SAME school, and only an ACTIVE student can be assigned; a move ends one
 *    period and starts another, the periods are never rewritten (assignment history);
 *  - archiving a group is final and unassigns every student (reason GROUP_ARCHIVED); an archived STUDENT is unassigned by the Students event
 *    consumer (reason STUDENT_ARCHIVED), a deactivated one stays in the group; groups are never deleted;
 *  - every change keeps a history row and publishes an outbox event in the same transaction.
 */
export class GroupService {
  private readonly groups: GroupRepository;
  private readonly schools: GroupServiceDeps['schools'];
  private readonly teachers: GroupServiceDeps['teachers'];
  private readonly students: StudentLookup;
  private readonly unitOfWork: UnitOfWork;
  private readonly outbox: OutboxService;
  private readonly clock: Clock;

  constructor(deps: GroupServiceDeps) {
    this.groups = deps.groups;
    this.schools = deps.schools;
    this.teachers = deps.teachers;
    this.students = deps.students;
    this.unitOfWork = deps.unitOfWork;
    this.outbox = deps.outbox;
    this.clock = deps.clock ?? new SystemClock();
  }

  // ---------------------------------------------------------------------------------------------- groups

  async createGroup(input: CreateGroupInput, actorId: string, tx?: TransactionContext): Promise<GroupDto> {
    const name = normalizeGroupName(input.name);
    const learningMode = requireLearningMode(input.learningMode);
    const progression = requireProgression(input.progression);
    const startingSurah = requireStartingSurah(input.startingSurah);
    return this.inTransaction(tx, async (t) => {
      const school = await this.schools.findById(input.schoolId, t);
      if (!school || school.status !== 'ACTIVE') throw groupError('GROUP_SCHOOL_NOT_ACTIVE');
      const teacherId = input.teacherId ?? null;
      if (teacherId !== null) await this.assertTeacherAssignable(teacherId, school.id, school.organizationId, t);
      if (await this.groups.findActiveByNameKey(school.id, groupNameKey(name), t)) throw groupError('GROUP_NAME_CONFLICT');
      const group = Group.register({ schoolId: school.id, organizationId: school.organizationId, name, teacherId, learningMode, progression, startingSurah, createdBy: actorId, clock: this.clock });
      await this.groups.insert(group, t);
      await this.persistGroup(group, t);
      return this.toDto(group, t);
    });
  }

  async getGroup(groupId: string, tx?: TransactionContext): Promise<GroupDto> {
    const group = await this.groups.findById(groupId, tx);
    if (!group) throw groupError('GROUP_NOT_FOUND');
    return this.toDto(group, tx);
  }

  async listGroupsOfSchool(schoolId: string, input: ListGroupsInput, tx?: TransactionContext): Promise<PageResult<GroupDto>> {
    const { items, total } = await this.groups.listBySchool(
      schoolId,
      { sort: input.sort ?? 'createdAt', direction: input.direction ?? 'desc', ...(input.status && input.status.length > 0 ? { status: input.status } : {}), page: input.page },
      tx,
    );
    return buildPageResult(await Promise.all(items.map((g) => this.toDto(g, tx))), total, input.page);
  }

  /** The ACTIVE groups of the caller's own Teacher record (derived from the verified user id; a user without a Teacher record gets an empty page). */
  async listOwnGroups(userId: string, page: PageRequest, direction: 'asc' | 'desc' = 'asc', tx?: TransactionContext): Promise<PageResult<GroupDto>> {
    const teacher = await this.teachers.findByUserId(userId, tx);
    if (!teacher) return buildPageResult([], 0, page);
    const { items, total } = await this.groups.listActiveByTeacher(teacher.id, page, direction, tx);
    return buildPageResult(await Promise.all(items.map((g) => this.toDto(g, tx))), total, page);
  }

  async listHistory(groupId: string, tx?: TransactionContext): Promise<GroupHistoryDto[]> {
    if (!(await this.groups.findById(groupId, tx))) throw groupError('GROUP_NOT_FOUND');
    return this.groups.listHistory(groupId, tx);
  }

  /** Changes the name, learning mode, progression and/or starting surah of an ACTIVE group; a value equal to the current one changes nothing. */
  async updateGroup(groupId: string, input: UpdateGroupInput, actorId: string, tx?: TransactionContext): Promise<GroupDto> {
    if (input.name === undefined && input.learningMode === undefined && input.progression === undefined && input.startingSurah === undefined) throw groupError('GROUP_UPDATE_EMPTY');
    const change = {
      name: input.name === undefined ? undefined : normalizeGroupName(input.name),
      learningMode: input.learningMode === undefined ? undefined : requireLearningMode(input.learningMode),
      progression: input.progression === undefined ? undefined : requireProgression(input.progression),
      startingSurah: input.startingSurah === undefined ? undefined : requireStartingSurah(input.startingSurah),
    };
    return this.inTransaction(tx, async (t) => {
      const group = await this.requireLocked(groupId, t);
      if (group.status === 'ARCHIVED') throw groupError('GROUP_ARCHIVED');
      if (change.name !== undefined && change.name !== group.snapshot.name) {
        const clash = await this.groups.findActiveByNameKey(group.snapshot.schoolId, groupNameKey(change.name), t);
        if (clash && clash.id !== group.id) throw groupError('GROUP_NAME_CONFLICT');
      }
      if (group.updateSettings(change, actorId, this.clock).length > 0) {
        await this.groups.update(group, t);
        await this.persistGroup(group, t);
      }
      return this.toDto(group, t);
    });
  }

  /** Assigns or changes the group's Teacher (one at most). The Teacher must be actively linked to the group's school. */
  async assignTeacher(groupId: string, teacherId: string, actorId: string, tx?: TransactionContext): Promise<GroupDto> {
    return this.inTransaction(tx, async (t) => {
      const group = await this.requireLocked(groupId, t);
      if (group.status === 'ARCHIVED') throw groupError('GROUP_ARCHIVED');
      await this.assertTeacherAssignable(teacherId, group.snapshot.schoolId, group.snapshot.organizationId, t);
      return this.saveTeacher(group, teacherId, actorId, t);
    });
  }

  /** Leaves the group without a Teacher (allowed: a group can be without a Teacher for a while). */
  async removeTeacher(groupId: string, actorId: string, tx?: TransactionContext): Promise<GroupDto> {
    return this.inTransaction(tx, async (t) => {
      const group = await this.requireLocked(groupId, t);
      if (group.status === 'ARCHIVED') throw groupError('GROUP_ARCHIVED');
      if (group.snapshot.teacherId === null) throw groupError('GROUP_HAS_NO_TEACHER');
      return this.saveTeacher(group, null, actorId, t);
    });
  }

  /** Final. Every student of the group is unassigned in the same transaction (reason GROUP_ARCHIVED) and kept as a student. */
  async archiveGroup(groupId: string, reasonInput: unknown, actorId: string, tx?: TransactionContext): Promise<GroupDto> {
    const reason = normalizeGroupReason(reasonInput);
    return this.inTransaction(tx, async (t) => {
      const group = await this.requireLocked(groupId, t);
      group.archive(actorId, reason, this.clock);
      await this.groups.update(group, t);
      await this.persistGroup(group, t);
      for (const assignment of await this.groups.listCurrentAssignments(group.id, t)) {
        assignment.end('GROUP_ARCHIVED', actorId, this.clock);
        await this.groups.updateAssignment(assignment, t);
        await this.outbox.publishFrom(assignment, t);
      }
      return this.toDto(group, t);
    });
  }

  // ---------------------------------------------------------------------------------------------- student assignments

  /** Puts an ACTIVE student of the group's school into the group. A student already in a group must be moved or unassigned first. */
  async assignStudent(groupId: string, studentId: string, actorId: string, tx?: TransactionContext): Promise<GroupStudentDto> {
    return this.inTransaction(tx, async (t) => {
      const group = await this.requireLocked(groupId, t);
      if (group.status === 'ARCHIVED') throw groupError('GROUP_ARCHIVED');
      const student = await this.requireAssignableStudent(studentId, group, t);
      if (await this.groups.lockCurrentAssignmentOfStudent(studentId, t)) throw groupError('GROUP_STUDENT_ALREADY_ASSIGNED');
      const assignment = await this.startAssignment(group, studentId, actorId, t);
      return { studentId, fullName: student.fullName, status: student.status, assignedAt: assignment.snapshot.assignedAt };
    });
  }

  /** Takes the student out of the group (they stay a student, the period is kept in the history). */
  async unassignStudent(groupId: string, studentId: string, actorId: string, tx?: TransactionContext): Promise<void> {
    await this.inTransaction(tx, async (t) => {
      const group = await this.requireLocked(groupId, t);
      const current = await this.groups.lockCurrentAssignmentOfStudent(studentId, t);
      if (!current || current.snapshot.groupId !== group.id) throw groupError('GROUP_STUDENT_NOT_ASSIGNED');
      current.end('MANUAL', actorId, this.clock);
      await this.groups.updateAssignment(current, t);
      await this.outbox.publishFrom(current, t);
    });
  }

  /** Moves the student from `sourceGroupId` to another ACTIVE group of the SAME school: one period ends (MOVED) and another starts. */
  async moveStudent(sourceGroupId: string, studentId: string, targetGroupId: string, actorId: string, tx?: TransactionContext): Promise<GroupStudentDto> {
    return this.inTransaction(tx, async (t) => {
      if (sourceGroupId === targetGroupId) throw groupError('GROUP_MOVE_TARGET_INVALID');
      // Both groups are locked in a fixed (id) order so two moves in opposite directions can never deadlock.
      const [first, second] = [sourceGroupId, targetGroupId].sort();
      const locked = new Map<string, Group | undefined>();
      locked.set(first!, await this.groups.lockById(first!, t));
      locked.set(second!, await this.groups.lockById(second!, t));
      const source = locked.get(sourceGroupId);
      const target = locked.get(targetGroupId);
      if (!source) throw groupError('GROUP_NOT_FOUND');
      if (!target || target.status !== 'ACTIVE' || target.snapshot.schoolId !== source.snapshot.schoolId) throw groupError('GROUP_MOVE_TARGET_INVALID');
      if (source.status === 'ARCHIVED') throw groupError('GROUP_ARCHIVED');
      const current = await this.groups.lockCurrentAssignmentOfStudent(studentId, t);
      if (!current || current.snapshot.groupId !== source.id) throw groupError('GROUP_STUDENT_NOT_ASSIGNED');
      const student = await this.requireAssignableStudent(studentId, target, t);
      current.end('MOVED', actorId, this.clock);
      await this.groups.updateAssignment(current, t);
      await this.outbox.publishFrom(current, t);
      const assignment = await this.startAssignment(target, studentId, actorId, t);
      return { studentId, fullName: student.fullName, status: student.status, assignedAt: assignment.snapshot.assignedAt };
    });
  }

  /**
   * The students currently in the group. A student that was just ARCHIVED but not yet unassigned by the Students event consumer is hidden here, so
   * a page can be shorter than requested for a moment.
   */
  async listStudentsOfGroup(groupId: string, page: PageRequest, direction: 'asc' | 'desc' = 'asc', tx?: TransactionContext): Promise<PageResult<GroupStudentDto>> {
    if (!(await this.groups.findById(groupId, tx))) throw groupError('GROUP_NOT_FOUND');
    const { items, total } = await this.groups.listCurrentAssignmentsPage(groupId, page, direction, tx);
    const rows: GroupStudentDto[] = [];
    for (const a of items) {
      const student = await this.students.findById(a.snapshot.studentId, tx);
      if (student && student.status !== 'ARCHIVED') rows.push({ studentId: student.id, fullName: student.fullName, status: student.status, assignedAt: a.snapshot.assignedAt });
    }
    return buildPageResult(rows, total, page);
  }

  /** Every group period of a student, oldest first (the old periods keep the group they were in). */
  async listAssignmentHistoryOfStudent(studentId: string, tx?: TransactionContext): Promise<StudentAssignmentDto[]> {
    const names = new Map<string, string | null>();
    const rows: StudentAssignmentDto[] = [];
    for (const a of await this.groups.listAssignmentsOfStudent(studentId, tx)) {
      if (!names.has(a.snapshot.groupId)) names.set(a.snapshot.groupId, (await this.groups.findById(a.snapshot.groupId, tx))?.snapshot.name ?? null);
      rows.push(toAssignmentDto(a, names.get(a.snapshot.groupId) ?? null));
    }
    return rows;
  }

  /**
   * Called by the Students event consumer when a student is ARCHIVED (at-least-once delivery, so it is idempotent): ends the current period with
   * the reason STUDENT_ARCHIVED and no actor (the system). Returns whether anything changed.
   */
  async unassignArchivedStudent(studentId: string, tx?: TransactionContext): Promise<boolean> {
    return this.inTransaction(tx, async (t) => {
      const student = await this.students.findScopeById(studentId, t);
      if (!student || student.status !== 'ARCHIVED') return false;
      const current = await this.groups.lockCurrentAssignmentOfStudent(studentId, t);
      if (!current) return false;
      current.end('STUDENT_ARCHIVED', null, this.clock);
      await this.groups.updateAssignment(current, t);
      await this.outbox.publishFrom(current, t);
      return true;
    });
  }

  // ---------------------------------------------------------------------------------------------- contracts for other modules

  async findScopeById(groupId: string, tx?: TransactionContext): Promise<GroupScopeDto | undefined> {
    const group = await this.groups.findById(groupId, tx);
    if (!group) return undefined;
    const s = group.snapshot;
    return { id: s.id, schoolId: s.schoolId, teacherId: s.teacherId, status: s.status };
  }

  /** Module 18's unlink guard (`TeacherGroupDependencies`): the ACTIVE groups of the Teacher in the school (an ARCHIVED group no longer depends on the link). */
  countGroupsOfTeacherInSchool(teacherId: string, schoolId: string, tx: TransactionContext): Promise<number> {
    return this.groups.countActiveByTeacherInSchool(teacherId, schoolId, tx);
  }

  /** Module 19's `StudentGroupAccess`: the student is currently in an ACTIVE group of this Teacher. */
  isStudentInGroupOfTeacher(studentId: string, teacherId: string, tx?: TransactionContext): Promise<boolean> {
    return this.groups.isStudentInActiveGroupOfTeacher(studentId, teacherId, tx);
  }

  /** True when one of the group's current students (not archived) is a child of the Parent: lets a Parent read the group of their child. */
  async isParentOfAnAssignedStudent(groupId: string, parentId: string, tx?: TransactionContext): Promise<boolean> {
    for (const a of await this.groups.listCurrentAssignments(groupId, tx)) {
      const student = await this.students.findScopeById(a.snapshot.studentId, tx);
      if (student && student.parentId === parentId && student.status !== 'ARCHIVED') return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------------------------- internals

  private async requireLocked(groupId: string, t: TransactionContext): Promise<Group> {
    const group = await this.groups.lockById(groupId, t);
    if (!group) throw groupError('GROUP_NOT_FOUND');
    return group;
  }

  private async assertTeacherAssignable(teacherId: string, schoolId: string, organizationId: string, t: TransactionContext): Promise<void> {
    const teacher = await this.teachers.findById(teacherId, t);
    if (!teacher || teacher.organizationId !== organizationId) throw groupError('GROUP_TEACHER_NOT_LINKED_TO_SCHOOL');
    // Locks the Teacher and the link (same order as the unlink): the unlink commits first (-> false) or sees this group afterwards.
    if (!(await this.teachers.lockActiveSchoolLink(teacher.id, schoolId, t))) throw groupError('GROUP_TEACHER_NOT_LINKED_TO_SCHOOL');
  }

  private async saveTeacher(group: Group, teacherId: string | null, actorId: string, t: TransactionContext): Promise<GroupDto> {
    if (group.setTeacher(teacherId, actorId, this.clock)) {
      await this.groups.update(group, t);
      await this.persistGroup(group, t);
    }
    return this.toDto(group, t);
  }

  private async requireAssignableStudent(studentId: string, group: Group, t: TransactionContext) {
    const student = await this.students.findById(studentId, t);
    if (!student || student.schoolId !== group.snapshot.schoolId) throw groupError('GROUP_STUDENT_NOT_IN_SCHOOL');
    if (student.status !== 'ACTIVE') throw groupError('GROUP_STUDENT_NOT_ACTIVE');
    return student;
  }

  private async startAssignment(group: Group, studentId: string, actorId: string, t: TransactionContext): Promise<GroupAssignment> {
    const assignment = GroupAssignment.start({ groupId: group.id, studentId, schoolId: group.snapshot.schoolId, organizationId: group.snapshot.organizationId, assignedBy: actorId, clock: this.clock });
    await this.groups.insertAssignment(assignment, t);
    await this.outbox.publishFrom(assignment, t);
    return assignment;
  }

  private async persistGroup(group: Group, t: TransactionContext): Promise<void> {
    await this.groups.insertHistory(group.pullHistory(), t);
    await this.outbox.publishFrom(group, t);
  }

  private async toDto(group: Group, tx?: TransactionContext): Promise<GroupDto> {
    const teacherId = group.snapshot.teacherId;
    const teacher = teacherId ? await this.teachers.findById(teacherId, tx) : undefined;
    return toGroupDto(group, teacher);
  }

  private inTransaction<T>(tx: TransactionContext | undefined, work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return tx ? work(tx) : this.unitOfWork.run(work);
  }
}

/** What downstream modules (Sessions 24, Attendance 26, Schedule 23...) should depend on (read-only). */
export type GroupLookup = Pick<GroupService, 'findScopeById' | 'isStudentInGroupOfTeacher' | 'countGroupsOfTeacherInSchool'>;
