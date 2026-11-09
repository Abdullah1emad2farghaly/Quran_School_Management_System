import { SystemClock, buildPageResult, type Clock, type PageRequest, type PageResult, type TransactionContext, type UnitOfWork } from '../../../00-shared-kernel/public';
import type { OutboxService } from '../../../06-domain-events-outbox/public';
import { checkPersonName, initialPasswordFromPhone, isSamePersonName, normalizePhone, type IdentityService } from '../../../08-identity-core/public';
import type { RoleService } from '../../../09-roles-permissions/public';
import type { SchoolLookup } from '../../../16-schools/public';
import type { ParentLookup } from '../../../17-parents/public';
import type { TeacherLookup } from '../../../18-teachers/public';
import { CollectorSchoolLink } from '../../domain/entities/collector-school-link';
import { subscriptionError } from '../../domain/errors/subscription-errors';
import { toCollectorLinkDto, type CollectorDto, type CollectorSchoolLinkDto } from '../dto/subscription-dto';
import type { CollectorLinkRepository } from '../ports/collector-link-repository';

export interface RegisterCollectorInput {
  readonly schoolId: string;
  /** The Collector's personal name: exactly three parts. */
  readonly name: unknown;
  /** Any accepted phone format; normalized to E.164. */
  readonly phone: unknown;
}

export interface CollectorRegistrationResult {
  readonly collector: CollectorDto;
  readonly link: CollectorSchoolLinkDto;
  /** True when a NEW login account was created (initial password + mandatory first-login change); false when an existing account was reused. */
  readonly accountCreated: boolean;
}

export interface CollectorServiceDeps {
  readonly links: CollectorLinkRepository;
  readonly schools: Pick<SchoolLookup, 'findById'>;
  readonly identity: Pick<IdentityService, 'findById' | 'findByPhone' | 'createUser'>;
  readonly roles: Pick<RoleService, 'assignRole' | 'hasRole'>;
  /** Read-only: a Parent or Teacher record of the same account must belong to the same organization (one account never spans organizations through these roles). */
  readonly parents: Pick<ParentLookup, 'findByUserId'>;
  readonly teachers: Pick<TeacherLookup, 'findByUserId'>;
  readonly unitOfWork: UnitOfWork;
  readonly outbox: OutboxService;
  readonly clock?: Clock;
}

/**
 * The Subscription Collector side of Module 33 (approved Option A; mirrors the Teacher registration rules of Module 18, which already implement the project's identity rules):
 *  - a Collector is `User -> SUBSCRIPTION_COLLECTOR role -> collector_school_links` (one record per school, with history), name stored once on the account, no other personal data;
 *  - the School Manager registers a Collector for THEIR school (the route proves the manager). A NEW phone creates a new account whose initial password is the last four
 *    digits of the phone with the mandatory first-login change (the same account-level mechanism as Parents and Teachers: Module 08 flag, enforced by Module 10);
 *  - an EXISTING account is reused only when its stored three-part name equals the submitted one (no duplicate account, no new password, nothing about the account changes);
 *    the role is added only when missing. An account is never reused across organizations (its existing Collector links, Parent record or Teacher record must be in the
 *    school's organization) and an inactive account is never reused;
 *  - removing a link ends access to THAT school at once (only ACTIVE links grant access); the ended link stays in the history and the account and other links are untouched.
 * Every write is one transaction together with its outbox events.
 */
export class CollectorService {
  private readonly links: CollectorLinkRepository;
  private readonly schools: CollectorServiceDeps['schools'];
  private readonly identity: CollectorServiceDeps['identity'];
  private readonly roles: CollectorServiceDeps['roles'];
  private readonly parents: CollectorServiceDeps['parents'];
  private readonly teachers: CollectorServiceDeps['teachers'];
  private readonly unitOfWork: UnitOfWork;
  private readonly outbox: OutboxService;
  private readonly clock: Clock;

  constructor(deps: CollectorServiceDeps) {
    this.links = deps.links;
    this.schools = deps.schools;
    this.identity = deps.identity;
    this.roles = deps.roles;
    this.parents = deps.parents;
    this.teachers = deps.teachers;
    this.unitOfWork = deps.unitOfWork;
    this.outbox = deps.outbox;
    this.clock = deps.clock ?? new SystemClock();
  }

  // ---------------------------------------------------------------------------------------------- registration / reuse

  /** Creates or reuses the Collector account for `phone` and links it to `schoolId`. See the class comment for the exact identity and password rules. */
  async registerCollector(input: RegisterCollectorInput, actorId: string, tx?: TransactionContext): Promise<CollectorRegistrationResult> {
    const checked = checkPersonName(input.name);
    if (!checked.ok) throw subscriptionError('INVALID_COLLECTOR_NAME');
    const name = checked.name;
    const phone = normalizePhone(input.phone);

    return this.inTransaction(tx, async (t) => {
      const school = await this.schools.findById(input.schoolId, t);
      if (!school || school.status !== 'ACTIVE') throw subscriptionError('COLLECTOR_SCHOOL_NOT_ACTIVE');
      const organizationId = school.organizationId;

      const existingUser = await this.identity.findByPhone(phone, t);
      if (!existingUser) {
        const user = await this.identity.createUser({ phone, password: initialPasswordFromPhone(phone), mustChangePassword: true, fullName: name }, t);
        await this.roles.assignRole({ userId: user.id, roleCode: 'SUBSCRIPTION_COLLECTOR', assignedBy: actorId }, t);
        const link = await this.createLink(user.id, organizationId, school.id, actorId, t);
        return { collector: await this.toDto(user.id, t), link: toCollectorLinkDto(link), accountCreated: true };
      }

      // An existing account: nothing about it is changed (no password, no mustChangePassword, no name, no merge).
      if (!existingUser.isActive) throw subscriptionError('COLLECTOR_ACCOUNT_INACTIVE');
      if (!isSamePersonName(existingUser.fullName, name)) throw subscriptionError('COLLECTOR_IDENTITY_CONFLICT');
      await this.assertSameOrganization(existingUser.id, organizationId, t);
      if (await this.links.findActive(existingUser.id, school.id, t)) throw subscriptionError('COLLECTOR_ALREADY_LINKED_TO_SCHOOL');
      if (!(await this.roles.hasRole(existingUser.id, 'SUBSCRIPTION_COLLECTOR', t))) await this.roles.assignRole({ userId: existingUser.id, roleCode: 'SUBSCRIPTION_COLLECTOR', assignedBy: actorId }, t);
      const link = await this.createLink(existingUser.id, organizationId, school.id, actorId, t);
      return { collector: await this.toDto(existingUser.id, t), link: toCollectorLinkDto(link), accountCreated: false };
    });
  }

  /** Ends the Collector's relationship with ONE school (history kept). The account, the role and the links to other schools are untouched. */
  removeSchoolLink(userId: string, schoolId: string, actorId: string, tx?: TransactionContext): Promise<CollectorSchoolLinkDto> {
    return this.inTransaction(tx, async (t) => {
      const link = await this.links.lockActive(userId, schoolId, t);
      if (!link) throw subscriptionError('COLLECTOR_SCHOOL_LINK_NOT_FOUND');
      link.unlink(actorId, this.clock);
      await this.links.update(link, t);
      await this.outbox.publishFrom(link, t);
      return toCollectorLinkDto(link);
    });
  }

  // ---------------------------------------------------------------------------------------------- reads

  /** The Collectors with an ACTIVE link to `schoolId` (the route has already proven the caller manages that school). */
  async listCollectorsOfSchool(schoolId: string, page: PageRequest, tx?: TransactionContext): Promise<PageResult<CollectorDto>> {
    const links = await this.links.listActiveBySchool(schoolId, tx);
    const slice = links.slice((page.page - 1) * page.pageSize, page.page * page.pageSize);
    const dtos = await Promise.all(slice.map((link) => this.toDto(link.snapshot.userId, tx)));
    return buildPageResult(dtos, links.length, page);
  }

  /** The caller's own assignments (the SUBSCRIPTION_COLLECTOR role: the account comes from the verified token). */
  async getOwnProfile(userId: string, tx?: TransactionContext): Promise<CollectorDto> {
    if ((await this.links.listActiveByUser(userId, tx)).length === 0 && !(await this.links.findOrganizationOfUser(userId, tx))) throw subscriptionError('COLLECTOR_SCHOOL_LINK_NOT_FOUND');
    return this.toDto(userId, tx);
  }

  async listSchoolLinkHistory(userId: string, tx?: TransactionContext): Promise<CollectorSchoolLinkDto[]> {
    return (await this.links.listHistoryByUser(userId, tx)).map(toCollectorLinkDto);
  }

  // ---------------------------------------------------------------------------------------------- CollectorDirectory (read-only contract for other modules)

  /** True only while the account has an ACTIVE link to the school: an ended link grants nothing. */
  async isCollectorOfSchool(userId: string, schoolId: string, tx?: TransactionContext): Promise<boolean> {
    return (await this.links.findActive(userId, schoolId, tx)) !== undefined;
  }

  async listActiveSchoolIds(userId: string, tx?: TransactionContext): Promise<string[]> {
    return (await this.links.listActiveByUser(userId, tx)).map((l) => l.snapshot.schoolId);
  }

  /** The accounts of the school's CURRENT Collectors (notification recipients). */
  async listActiveCollectorUserIds(schoolId: string, tx?: TransactionContext): Promise<string[]> {
    return [...new Set((await this.links.listActiveBySchool(schoolId, tx)).map((l) => l.snapshot.userId))];
  }

  // ---------------------------------------------------------------------------------------------- internals

  private async assertSameOrganization(userId: string, organizationId: string, t: TransactionContext): Promise<void> {
    const known = await this.links.findOrganizationOfUser(userId, t);
    if (known !== undefined && known !== organizationId) throw subscriptionError('COLLECTOR_ORGANIZATION_CONFLICT');
    const parent = await this.parents.findByUserId(userId, t);
    if (parent && parent.organizationId !== organizationId) throw subscriptionError('COLLECTOR_ORGANIZATION_CONFLICT');
    const teacher = await this.teachers.findByUserId(userId, t);
    if (teacher && teacher.organizationId !== organizationId) throw subscriptionError('COLLECTOR_ORGANIZATION_CONFLICT');
  }

  private async createLink(userId: string, organizationId: string, schoolId: string, actorId: string, t: TransactionContext): Promise<CollectorSchoolLink> {
    const link = CollectorSchoolLink.link({ userId, organizationId, schoolId, linkedBy: actorId, clock: this.clock });
    await this.links.insert(link, t);
    await this.outbox.publishFrom(link, t);
    return link;
  }

  private async toDto(userId: string, tx?: TransactionContext): Promise<CollectorDto> {
    const [user, links] = await Promise.all([this.identity.findById(userId, tx), this.links.listActiveByUser(userId, tx)]);
    if (!user || user.fullName === null) throw new Error(`Collector account ${userId} is missing or has no personal name`);
    const organizationId = links[0]?.snapshot.organizationId ?? (await this.links.findOrganizationOfUser(userId, tx));
    if (organizationId === undefined) throw new Error(`Collector account ${userId} has no school link`);
    return { userId, organizationId, name: user.fullName, phone: user.phone, schoolIds: links.map((l) => l.snapshot.schoolId) };
  }

  private inTransaction<T>(tx: TransactionContext | undefined, work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return tx ? work(tx) : this.unitOfWork.run(work);
  }
}

/** What downstream modules should depend on (read-only). */
export type CollectorDirectory = Pick<CollectorService, 'isCollectorOfSchool' | 'listActiveSchoolIds' | 'listActiveCollectorUserIds' | 'listSchoolLinkHistory'>;
