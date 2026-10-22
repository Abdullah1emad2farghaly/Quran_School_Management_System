import {
  SystemClock,
  buildPageResult,
  type Clock,
  type PageRequest,
  type PageResult,
  type TransactionContext,
  type UnitOfWork,
} from '../../../00-shared-kernel/public';
import type { OutboxService } from '../../../06-domain-events-outbox/public';
import { initialPasswordFromPhone, normalizePhone, type IdentityService } from '../../../08-identity-core/public';
import type { RoleService } from '../../../09-roles-permissions/public';
import type { SchoolLookup } from '../../../16-schools/public';
import type { ParentLookup } from '../../../17-parents/public';
import { Teacher } from '../../domain/entities/teacher';
import { TeacherSchoolLink } from '../../domain/entities/teacher-school-link';
import { teacherError } from '../../domain/errors/teacher-errors';
import { isSameTeacherName, normalizeTeacherName } from '../../domain/value-objects/teacher-name';
import { toTeacherDto, toTeacherSchoolLinkDto, type TeacherDto, type TeacherSchoolLinkDto } from '../dto/teacher-dto';
import type { TeacherGroupDependencies } from '../ports/teacher-group-dependencies';
import type { TeacherRepository, TeacherSortKey } from '../ports/teacher-repository';
import type { TeacherSchoolLinkRepository } from '../ports/teacher-school-link-repository';

export interface RegisterTeacherInput {
  readonly schoolId: string;
  /** The Teacher's personal name: exactly three parts. */
  readonly name: unknown;
  /** Any accepted phone format; normalized to E.164. */
  readonly phone: unknown;
}

export interface TeacherRegistrationResult {
  readonly teacher: TeacherDto;
  readonly link: TeacherSchoolLinkDto;
  /** True when a NEW login account was created (initial password + mandatory first-login change); false when an existing account was reused. */
  readonly accountCreated: boolean;
}

export interface ListTeachersInput {
  readonly schoolId: string;
  readonly sort?: TeacherSortKey;
  readonly direction?: 'asc' | 'desc';
  readonly page: PageRequest;
}

export interface TeacherServiceDeps {
  readonly teachers: TeacherRepository;
  readonly links: TeacherSchoolLinkRepository;
  readonly schools: Pick<SchoolLookup, 'findById'>;
  readonly identity: Pick<IdentityService, 'findById' | 'findByPhone' | 'createUser'>;
  readonly roles: Pick<RoleService, 'assignRole' | 'hasRole'>;
  /** Read-only: a Parent record of the same account must belong to the same organization (Teacher + Parent on one account). */
  readonly parents: Pick<ParentLookup, 'findByUserId'>;
  /** Groups that depend on a Teacher-to-School relationship (Module 20 supplies the real one; see `teacher-group-dependencies.ts`). */
  readonly groupDependencies: TeacherGroupDependencies;
  readonly unitOfWork: UnitOfWork;
  readonly outbox: OutboxService;
  readonly clock?: Clock;
}

/**
 * Public application contract of Module 18 (Teachers), Master Specification §33/§34 and the approved Module 18 rules.
 *
 * It does NOT authorize its callers: routes use the Authorization Engine (`teachers.*` permissions) first. What it enforces itself:
 *  - a Teacher is `User -> TEACHER role -> Teacher entity -> school links`, with an EXACTLY three-part personal name (stored once on the
 *    account, `users.full_name`) and the phone; no other personal data is collected in V1;
 *  - the school must exist and be ACTIVE; the organization is the school's organization;
 *  - a NEW phone creates a new account (with the name) whose initial password is the last four digits of the phone, flagged as "must change
 *    password" (the same account-level mechanism as Parents: Module 08 flag, enforced by Module 10 on every protected route);
 *  - an EXISTING phone is never merged, overwritten, given a new password or a changed `mustChangePassword`: the account is reused only when its
 *    stored three-part name equals the submitted one (a matching name is the approved criterion, not independent proof of identity); a missing or
 *    different stored name is TEACHER_IDENTITY_CONFLICT. The TEACHER role is added only when missing. An existing Teacher record, or a Parent
 *    record of the same account, must belong to the school's organization (a Teacher is never reused across organizations in V1);
 *  - removing a school link keeps the account, the Teacher record and the other links, and is refused while the Teacher still has groups in
 *    that school (TEACHER_HAS_GROUPS_IN_SCHOOL, through the Module 20 guard);
 *  - there is deliberately NO global deactivation or deletion of a Teacher (decision D-3 is still open).
 * Every write is one transaction together with its outbox events.
 */
export class TeacherService {
  private readonly teachers: TeacherRepository;
  private readonly links: TeacherSchoolLinkRepository;
  private readonly schools: TeacherServiceDeps['schools'];
  private readonly identity: TeacherServiceDeps['identity'];
  private readonly roles: TeacherServiceDeps['roles'];
  private readonly parents: TeacherServiceDeps['parents'];
  private readonly groupDependencies: TeacherGroupDependencies;
  private readonly unitOfWork: UnitOfWork;
  private readonly outbox: OutboxService;
  private readonly clock: Clock;

  constructor(deps: TeacherServiceDeps) {
    this.teachers = deps.teachers;
    this.links = deps.links;
    this.schools = deps.schools;
    this.identity = deps.identity;
    this.roles = deps.roles;
    this.parents = deps.parents;
    this.groupDependencies = deps.groupDependencies;
    this.unitOfWork = deps.unitOfWork;
    this.outbox = deps.outbox;
    this.clock = deps.clock ?? new SystemClock();
  }

  // ---------------------------------------------------------------------------------------------- registration / reuse

  /** Creates or reuses the Teacher for `phone` and links it to `schoolId`. See the class comment for the exact identity and password rules. */
  async registerTeacher(input: RegisterTeacherInput, actorId: string, tx?: TransactionContext): Promise<TeacherRegistrationResult> {
    const name = normalizeTeacherName(input.name);
    const phone = normalizePhone(input.phone);

    return this.inTransaction(tx, async (t) => {
      const school = await this.schools.findById(input.schoolId, t);
      if (!school || school.status !== 'ACTIVE') throw teacherError('TEACHER_SCHOOL_NOT_ACTIVE');
      const organizationId = school.organizationId;

      const existingUser = await this.identity.findByPhone(phone, t);
      if (!existingUser) {
        const user = await this.identity.createUser({ phone, password: initialPasswordFromPhone(phone), mustChangePassword: true, fullName: name }, t);
        await this.roles.assignRole({ userId: user.id, roleCode: 'TEACHER', assignedBy: actorId }, t);
        const teacher = await this.createTeacher(user.id, organizationId, actorId, t);
        const link = await this.createLink(teacher, school.id, actorId, t);
        return { teacher: await this.toDto(teacher, t), link: toTeacherSchoolLinkDto(link), accountCreated: true };
      }

      // An existing account: nothing about it is changed (no password, no mustChangePassword, no name, no merge).
      if (!existingUser.isActive) throw teacherError('TEACHER_ACCOUNT_INACTIVE');
      if (!isSameTeacherName(existingUser.fullName, name)) throw teacherError('TEACHER_IDENTITY_CONFLICT');

      const existingTeacher = await this.teachers.lockByUserId(existingUser.id, t);
      if (existingTeacher) {
        if (existingTeacher.organizationId !== organizationId) throw teacherError('TEACHER_ORGANIZATION_CONFLICT');
        if (await this.links.findActive(existingTeacher.id, school.id, t)) throw teacherError('TEACHER_ALREADY_LINKED_TO_SCHOOL');
        await this.ensureTeacherRole(existingUser.id, actorId, t);
        const link = await this.createLink(existingTeacher, school.id, actorId, t);
        return { teacher: await this.toDto(existingTeacher, t), link: toTeacherSchoolLinkDto(link), accountCreated: false };
      }

      // An account that is not a Teacher yet (a Parent, an organization manager, a school manager...). If it is a Parent it must be a Parent of
      // THIS organization: one account never spans organizations through these roles.
      const parent = await this.parents.findByUserId(existingUser.id, t);
      if (parent && parent.organizationId !== organizationId) throw teacherError('TEACHER_ORGANIZATION_CONFLICT');
      await this.ensureTeacherRole(existingUser.id, actorId, t);
      const teacher = await this.createTeacher(existingUser.id, organizationId, actorId, t);
      const link = await this.createLink(teacher, school.id, actorId, t);
      return { teacher: await this.toDto(teacher, t), link: toTeacherSchoolLinkDto(link), accountCreated: false };
    });
  }

  // ---------------------------------------------------------------------------------------------- reads

  async getTeacher(teacherId: string, tx?: TransactionContext): Promise<TeacherDto> {
    const teacher = await this.teachers.findById(teacherId, tx);
    if (!teacher) throw teacherError('TEACHER_NOT_FOUND');
    return this.toDto(teacher, tx);
  }

  /** The caller's own profile (the TEACHER role reads only their own record). */
  async getOwnProfile(userId: string, tx?: TransactionContext): Promise<TeacherDto> {
    const teacher = await this.teachers.findByUserId(userId, tx);
    if (!teacher) throw teacherError('TEACHER_NOT_FOUND');
    return this.toDto(teacher, tx);
  }

  /** The Teachers with an ACTIVE link to `schoolId` (the route has already proven the caller manages that school). */
  async listTeachersOfSchool(input: ListTeachersInput, tx?: TransactionContext): Promise<PageResult<TeacherDto>> {
    const { items, total } = await this.teachers.listBySchool(
      { schoolId: input.schoolId, sort: input.sort ?? 'createdAt', direction: input.direction ?? 'desc', page: input.page },
      tx,
    );
    const links = await this.links.listActiveByTeachers(items.map((t) => t.id), tx);
    const dtos = await Promise.all(items.map(async (teacher) => toTeacherDto({ teacher, ...(await this.accountOf(teacher.userId, tx)), links: links.get(teacher.id) ?? [] })));
    return buildPageResult(dtos, total, input.page);
  }

  // ---------------------------------------------------------------------------------------------- school relationship

  /**
   * Ends the Teacher's relationship with ONE school. The account, the Teacher record and the links to other schools are untouched; the ended
   * link stays in the history. A Teacher who still has groups in the school cannot be unlinked (TEACHER_HAS_GROUPS_IN_SCHOOL, via the Module 20 guard).
   */
  removeSchoolLink(teacherId: string, schoolId: string, actorId: string, tx?: TransactionContext): Promise<TeacherSchoolLinkDto> {
    return this.inTransaction(tx, async (t) => {
      if (!(await this.teachers.lockById(teacherId, t))) throw teacherError('TEACHER_NOT_FOUND');
      const link = await this.links.lockActive(teacherId, schoolId, t);
      if (!link) throw teacherError('TEACHER_SCHOOL_LINK_NOT_FOUND');
      if ((await this.groupDependencies.countGroupsOfTeacherInSchool(teacherId, schoolId, t)) > 0) throw teacherError('TEACHER_HAS_GROUPS_IN_SCHOOL');
      link.unlink(actorId, this.clock);
      await this.links.update(link, t);
      await this.outbox.publishFrom(link, t);
      return toTeacherSchoolLinkDto(link);
    });
  }

  // ---------------------------------------------------------------------------------------------- TeacherLookup (read-only contract for other modules)

  async findById(teacherId: string, tx?: TransactionContext): Promise<TeacherDto | undefined> {
    const teacher = await this.teachers.findById(teacherId, tx);
    return teacher ? this.toDto(teacher, tx) : undefined;
  }

  async findByUserId(userId: string, tx?: TransactionContext): Promise<TeacherDto | undefined> {
    const teacher = await this.teachers.findByUserId(userId, tx);
    return teacher ? this.toDto(teacher, tx) : undefined;
  }

  async listActiveSchoolIds(teacherId: string, tx?: TransactionContext): Promise<string[]> {
    return (await this.links.listActiveByTeacher(teacherId, tx)).map((l) => l.snapshot.schoolId);
  }

  /**
   * Locks the Teacher row and then the ACTIVE Teacher-to-School link row (the same order as `removeSchoolLink`, so the two can never deadlock) and
   * tells whether the link is active. Module 20 calls it INSIDE the transaction that assigns a Teacher to a group, so a group can never be given
   * to a Teacher whose link is being removed at the same moment: either the unlink commits first (this returns false) or the group is committed
   * first (the unlink guard then sees it and refuses). It changes nothing.
   */
  async lockActiveSchoolLink(teacherId: string, schoolId: string, tx: TransactionContext): Promise<boolean> {
    if (!(await this.teachers.lockById(teacherId, tx))) return false;
    return (await this.links.lockActive(teacherId, schoolId, tx)) !== undefined;
  }

  async isLinkedToSchool(teacherId: string, schoolId: string, tx?: TransactionContext): Promise<boolean> {
    return (await this.links.findActive(teacherId, schoolId, tx)) !== undefined;
  }

  async listSchoolLinkHistory(teacherId: string, tx?: TransactionContext): Promise<TeacherSchoolLinkDto[]> {
    return (await this.links.listHistoryByTeacher(teacherId, tx)).map(toTeacherSchoolLinkDto);
  }

  // ---------------------------------------------------------------------------------------------- internals

  private async createTeacher(userId: string, organizationId: string, actorId: string, t: TransactionContext): Promise<Teacher> {
    const teacher = Teacher.register({ userId, organizationId, createdBy: actorId, clock: this.clock });
    await this.teachers.insert(teacher, t);
    await this.outbox.publishFrom(teacher, t);
    return teacher;
  }

  private async createLink(teacher: Teacher, schoolId: string, actorId: string, t: TransactionContext): Promise<TeacherSchoolLink> {
    const link = TeacherSchoolLink.link({ teacherId: teacher.id, userId: teacher.userId, organizationId: teacher.organizationId, schoolId, linkedBy: actorId, clock: this.clock });
    await this.links.insert(link, t);
    await this.outbox.publishFrom(link, t);
    return link;
  }

  /** Gives an existing, identity-confirmed account the TEACHER role only if it does not hold it. Nothing else about the account changes. */
  private async ensureTeacherRole(userId: string, actorId: string, t: TransactionContext): Promise<void> {
    if (!(await this.roles.hasRole(userId, 'TEACHER', t))) await this.roles.assignRole({ userId, roleCode: 'TEACHER', assignedBy: actorId }, t);
  }

  /** The phone and the canonical personal name come from the account (Module 08), the single source of both. */
  private async accountOf(userId: string, tx?: TransactionContext): Promise<{ phone: string; name: string }> {
    const user = await this.identity.findById(userId, tx);
    if (!user || user.fullName === null) throw new Error(`Teacher account ${userId} is missing or has no personal name`);
    return { phone: user.phone, name: user.fullName };
  }

  private async toDto(teacher: Teacher, tx?: TransactionContext): Promise<TeacherDto> {
    const [account, links] = await Promise.all([this.accountOf(teacher.userId, tx), this.links.listActiveByTeacher(teacher.id, tx)]);
    return toTeacherDto({ teacher, ...account, links });
  }

  private inTransaction<T>(tx: TransactionContext | undefined, work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return tx ? work(tx) : this.unitOfWork.run(work);
  }
}

/** The locking check Groups (20) run inside their own transaction (see `TeacherService.lockActiveSchoolLink`). It changes nothing. */
export type TeacherSchoolLinkLocker = Pick<TeacherService, 'lockActiveSchoolLink'>;

/** What downstream modules (Groups 20, Reports...) should depend on (read-only). */
export type TeacherLookup = Pick<TeacherService, 'findById' | 'findByUserId' | 'listActiveSchoolIds' | 'isLinkedToSchool' | 'listSchoolLinkHistory'>;
