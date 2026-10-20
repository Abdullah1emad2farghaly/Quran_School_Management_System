import {
  SystemClock,
  buildPageResult,
  businessDateOf,
  isIsoDate,
  type Clock,
  type PageRequest,
  type PageResult,
  type TransactionContext,
  type UnitOfWork,
} from '../../../00-shared-kernel/public';
import type { OutboxService } from '../../../06-domain-events-outbox/public';
import type { ParentLookup, ParentSchoolLinkLocker } from '../../../17-parents/public';
import type { SchoolLookup } from '../../../16-schools/public';
import { Student } from '../../domain/entities/student';
import { studentError } from '../../domain/errors/student-errors';
import { normalizeNationalId } from '../../domain/value-objects/student-national-id';
import { normalizeReason, normalizeStudentName, studentNameMatchesParent } from '../../domain/value-objects/student-name';
import { LIFECYCLE, type StudentLifecycleAction, type StudentStatus } from '../../domain/value-objects/student-status';
import { toStudentDto, toStudentHistoryDto, type StudentDto, type StudentHistoryDto, type StudentScopeDto } from '../dto/student-dto';
import type { StudentRepository, StudentSortKey } from '../ports/student-repository';

export interface RegisterStudentInput {
  readonly schoolId: string;
  readonly parentId: string;
  /** At least three parts; the second and third are the Parent's first and second names. */
  readonly fullName: unknown;
  /** Exactly 14 digits, unique across the whole system. */
  readonly nationalId: unknown;
  /** YYYY-MM-DD. Optional: defaults to today's business date (Africa/Cairo). */
  readonly joinDate?: unknown;
}

/** V1: only the name and the join date can be corrected. The Parent, the school and the National ID never change. */
export interface UpdateStudentInput {
  readonly fullName?: unknown;
  readonly joinDate?: unknown;
}

export interface ListStudentsInput {
  readonly sort?: StudentSortKey;
  readonly direction?: 'asc' | 'desc';
  readonly status?: readonly StudentStatus[];
  readonly page: PageRequest;
}

export interface StudentServiceDeps {
  readonly students: StudentRepository;
  readonly schools: Pick<SchoolLookup, 'findById'>;
  readonly parents: ParentLookup & ParentSchoolLinkLocker;
  readonly unitOfWork: UnitOfWork;
  readonly outbox: OutboxService;
  readonly clock?: Clock;
}

/**
 * Public application contract of Module 19 (Students), Master Specification §36-§39 and the approved Module 19 decisions.
 *
 * It does NOT authorize its callers: routes use the Authorization Engine (`students.*` permissions, see student-authorization.ts) before they
 * call it. What it enforces itself are the business rules:
 *  - a Student is a business entity only (no login, no password, no session) with EXACTLY ONE Parent, one school, a name, a National ID, a
 *    join date and a lifecycle status; the group belongs to Module 20 and the address is derived from the Parent at read time;
 *  - registration needs an ACTIVE school and a Parent of the SAME organization that is actively linked to that school (the link row is locked,
 *    so a concurrent unlink cannot slip past); the name has at least three parts and its second and third parts are the Parent's first and
 *    second names; the National ID is 14 digits and unique GLOBALLY (pre-checked and guarded by a unique index; a duplicate is the neutral
 *    STUDENT_NATIONAL_ID_CONFLICT and nothing about the other student is revealed). An existing student is never moved or replaced;
 *  - lifecycle ACTIVE / INACTIVE / ARCHIVED with the documented transitions (see student-status.ts); students are never deleted;
 *  - the Parent, the school and the National ID can never be changed; a corrected name must still match the Parent's name;
 *  - every change keeps a history row (who, when, what, previous value, reason) and publishes an outbox event in the same transaction.
 */
export class StudentService {
  private readonly students: StudentRepository;
  private readonly schools: StudentServiceDeps['schools'];
  private readonly parents: StudentServiceDeps['parents'];
  private readonly unitOfWork: UnitOfWork;
  private readonly outbox: OutboxService;
  private readonly clock: Clock;

  constructor(deps: StudentServiceDeps) {
    this.students = deps.students;
    this.schools = deps.schools;
    this.parents = deps.parents;
    this.unitOfWork = deps.unitOfWork;
    this.outbox = deps.outbox;
    this.clock = deps.clock ?? new SystemClock();
  }

  // ---------------------------------------------------------------------------------------------- registration

  async registerStudent(input: RegisterStudentInput, actorId: string, tx?: TransactionContext): Promise<StudentDto> {
    // Input that needs no database is validated first (fail fast, no transaction opened for a malformed request).
    const fullName = normalizeStudentName(input.fullName);
    const nationalId = normalizeNationalId(input.nationalId);
    const joinDate = input.joinDate === undefined || input.joinDate === null ? businessDateOf(this.clock.now()) : this.requireJoinDate(input.joinDate);

    return this.inTransaction(tx, async (t) => {
      const school = await this.schools.findById(input.schoolId, t);
      if (!school || school.status !== 'ACTIVE') throw studentError('STUDENT_SCHOOL_NOT_ACTIVE');

      // The Parent must exist, belong to the school's organization and be actively linked to THIS school. One neutral error for all three.
      const parent = await this.parents.findById(input.parentId, t);
      if (!parent || parent.organizationId !== school.organizationId) throw studentError('STUDENT_PARENT_NOT_LINKED_TO_SCHOOL');
      // Locks the Parent and the link (same order as the unlink): a concurrent unlink commits first (-> false) or sees this student afterwards.
      if (!(await this.parents.lockActiveSchoolLink(parent.id, school.id, t))) throw studentError('STUDENT_PARENT_NOT_LINKED_TO_SCHOOL');
      if (!studentNameMatchesParent(fullName, parent.name)) throw studentError('STUDENT_NAME_PARENT_MISMATCH');

      // Global uniqueness: the application checks first (clear error, no wasted write); the unique index decides concurrent attempts.
      if (await this.students.findByNationalId(nationalId, t)) throw studentError('STUDENT_NATIONAL_ID_CONFLICT');

      const student = Student.register({
        schoolId: school.id,
        organizationId: school.organizationId,
        parentId: parent.id,
        fullName,
        nationalId,
        joinDate,
        createdBy: actorId,
        clock: this.clock,
      });
      await this.students.insert(student, t);
      await this.persistChanges(student, t);
      return this.toDto(student, t);
    });
  }

  // ---------------------------------------------------------------------------------------------- reads

  async getStudent(studentId: string, tx?: TransactionContext): Promise<StudentDto> {
    const student = await this.students.findById(studentId, tx);
    if (!student) throw studentError('STUDENT_NOT_FOUND');
    return this.toDto(student, tx);
  }

  /** The Students of `schoolId` in any status (the route has already proven the caller manages that school). */
  async listStudentsOfSchool(schoolId: string, input: ListStudentsInput, tx?: TransactionContext): Promise<PageResult<StudentDto>> {
    const { items, total } = await this.students.listBySchool(schoolId, this.query(input), tx);
    return buildPageResult(await this.toDtos(items, tx), total, input.page);
  }

  /** The caller's own children (the PARENT role: the Parent record is derived from the verified user id, no id is accepted). */
  async listChildrenOfParentUser(userId: string, input: ListStudentsInput, tx?: TransactionContext): Promise<PageResult<StudentDto>> {
    const parent = await this.parents.findByUserId(userId, tx);
    if (!parent) return buildPageResult([], 0, input.page);
    const { items, total } = await this.students.listByParent(parent.id, this.query(input), tx);
    return buildPageResult(await this.toDtos(items, tx), total, input.page);
  }

  /** The Student's change history, oldest first (who, when, what changed, the previous value, the reason). */
  async listHistory(studentId: string, tx?: TransactionContext): Promise<StudentHistoryDto[]> {
    if (!(await this.students.findById(studentId, tx))) throw studentError('STUDENT_NOT_FOUND');
    return (await this.students.listHistory(studentId, tx)).map(toStudentHistoryDto);
  }

  // ---------------------------------------------------------------------------------------------- update

  /**
   * Corrects the name and/or the join date. An unchanged value changes nothing and records nothing; an ARCHIVED student is read-only.
   * A new name must still have at least three parts and still carry the Parent's first and second names as its second and third parts.
   */
  async updateStudent(studentId: string, input: UpdateStudentInput, actorId: string, tx?: TransactionContext): Promise<StudentDto> {
    if (input.fullName === undefined && input.joinDate === undefined) throw studentError('STUDENT_UPDATE_EMPTY');
    const fullName = input.fullName === undefined ? undefined : normalizeStudentName(input.fullName);
    const joinDate = input.joinDate === undefined ? undefined : this.requireJoinDate(input.joinDate);

    return this.inTransaction(tx, async (t) => {
      const student = await this.students.lockById(studentId, t);
      if (!student) throw studentError('STUDENT_NOT_FOUND');
      if (student.status === 'ARCHIVED') throw studentError('STUDENT_ARCHIVED');
      if (fullName !== undefined) {
        const parent = await this.parents.findById(student.snapshot.parentId, t);
        if (!parent) throw new Error(`Student ${student.id} has a missing Parent ${student.snapshot.parentId}`); // data-integrity failure, not a client error
        if (!studentNameMatchesParent(fullName, parent.name)) throw studentError('STUDENT_NAME_PARENT_MISMATCH');
      }
      const changed = student.updateDetails({ fullName, joinDate, actorId, clock: this.clock });
      if (changed.length > 0) {
        await this.students.update(student, t);
        await this.persistChanges(student, t);
      }
      return this.toDto(student, t);
    });
  }

  // ---------------------------------------------------------------------------------------------- lifecycle

  deactivateStudent(studentId: string, reason: unknown, actorId: string, tx?: TransactionContext): Promise<StudentDto> {
    return this.changeLifecycle('DEACTIVATE', studentId, reason, actorId, tx);
  }
  reactivateStudent(studentId: string, reason: unknown, actorId: string, tx?: TransactionContext): Promise<StudentDto> {
    return this.changeLifecycle('REACTIVATE', studentId, reason, actorId, tx);
  }
  archiveStudent(studentId: string, reason: unknown, actorId: string, tx?: TransactionContext): Promise<StudentDto> {
    return this.changeLifecycle('ARCHIVE', studentId, reason, actorId, tx);
  }

  // `async` so that an invalid reason is a rejected promise like every other failure (never a synchronous throw).
  private async changeLifecycle(action: StudentLifecycleAction, studentId: string, reasonInput: unknown, actorId: string, tx?: TransactionContext): Promise<StudentDto> {
    const reason = normalizeReason(reasonInput);
    return this.inTransaction(tx, async (t) => {
      const student = await this.students.lockById(studentId, t);
      if (!student) throw studentError('STUDENT_NOT_FOUND');
      if (!LIFECYCLE[action].from.includes(student.status)) throw studentError(student.status === 'ARCHIVED' ? 'STUDENT_ARCHIVED' : 'STUDENT_INVALID_STATUS_TRANSITION');
      if (action === 'REACTIVATE') {
        // Only back into a working school and a still-valid Parent relationship (the unlink guard keeps it valid; checked anyway, it is cheap).
        const school = await this.schools.findById(student.snapshot.schoolId, t);
        if (!school || school.status !== 'ACTIVE') throw studentError('STUDENT_SCHOOL_NOT_ACTIVE');
        if (!(await this.parents.lockActiveSchoolLink(student.snapshot.parentId, student.snapshot.schoolId, t))) throw studentError('STUDENT_PARENT_NOT_LINKED_TO_SCHOOL');
      }
      student.applyLifecycle(action, actorId, reason, this.clock);
      await this.students.update(student, t);
      await this.persistChanges(student, t);
      return this.toDto(student, t);
    });
  }

  // ---------------------------------------------------------------------------------------------- contracts for other modules

  /** Server-side facts the Authorization Engine resolver and Module 20 need (never taken from the client). */
  async findScopeById(studentId: string, tx?: TransactionContext): Promise<StudentScopeDto | undefined> {
    const student = await this.students.findById(studentId, tx);
    if (!student) return undefined;
    const s = student.snapshot;
    return { id: s.id, schoolId: s.schoolId, organizationId: s.organizationId, parentId: s.parentId, status: s.status };
  }

  async findById(studentId: string, tx?: TransactionContext): Promise<StudentDto | undefined> {
    const student = await this.students.findById(studentId, tx);
    return student ? this.toDto(student, tx) : undefined;
  }

  /**
   * Module 17's unlink guard (`ParentStudentDependencies`): how many students of `parentId` exist in `schoolId`, in EVERY status. An ARCHIVED
   * student still anchors the Parent-to-School relationship (the Parent of a student never changes in V1), so it blocks the unlink too.
   */
  countStudentsOfParentInSchool(parentId: string, schoolId: string, tx: TransactionContext): Promise<number> {
    return this.students.countByParentInSchool(parentId, schoolId, tx);
  }

  // ---------------------------------------------------------------------------------------------- internals

  private requireJoinDate(value: unknown): string {
    if (!isIsoDate(value)) throw studentError('INVALID_STUDENT_JOIN_DATE');
    return value;
  }

  private query(input: ListStudentsInput) {
    return { sort: input.sort ?? 'createdAt', direction: input.direction ?? 'desc', ...(input.status && input.status.length > 0 ? { status: input.status } : {}), page: input.page } as const;
  }

  /** Stores the history rows and publishes the events recorded by the aggregate, in the caller's transaction. */
  private async persistChanges(student: Student, t: TransactionContext): Promise<void> {
    await this.students.insertHistory(student.pullHistory(), t);
    await this.outbox.publishFrom(student, t);
  }

  private async toDto(student: Student, tx?: TransactionContext): Promise<StudentDto> {
    const address = await this.parents.getCurrentAddress(student.snapshot.parentId, tx);
    return toStudentDto(student, address);
  }

  private async toDtos(students: readonly Student[], tx?: TransactionContext): Promise<StudentDto[]> {
    const parentIds = [...new Set(students.map((s) => s.snapshot.parentId))];
    const addresses = new Map<string, Awaited<ReturnType<ParentLookup['getCurrentAddress']>>>();
    await Promise.all(parentIds.map(async (id) => addresses.set(id, await this.parents.getCurrentAddress(id, tx))));
    return students.map((s) => toStudentDto(s, addresses.get(s.snapshot.parentId)));
  }

  private inTransaction<T>(tx: TransactionContext | undefined, work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return tx ? work(tx) : this.unitOfWork.run(work);
  }
}

/** What downstream modules (Groups 20, Attendance 26, Subscriptions 33...) should depend on (read-only). */
export type StudentLookup = Pick<StudentService, 'findById' | 'findScopeById'>;
