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
import type { ParentAddress, UnifiedAddressService } from '../../../15-unified-address/public';
import { newUuid } from '../../../00-shared-kernel/public';
import { Parent } from '../../domain/entities/parent';
import { ParentSchoolLink } from '../../domain/entities/parent-school-link';
import { parentError } from '../../domain/errors/parent-errors';
import { isSameParentName, normalizeParentName } from '../../domain/value-objects/parent-name';
import { toParentAddressDto, toParentDto, toParentSchoolLinkDto, type ParentAddressDto, type ParentDto, type ParentSchoolLinkDto } from '../dto/parent-dto';
import type { ParentAddressEntry, ParentRepository, ParentSortKey } from '../ports/parent-repository';
import type { ParentSchoolLinkRepository } from '../ports/parent-school-link-repository';
import type { ParentStudentDependencies } from '../ports/parent-student-dependencies';

/**
 * The address of a registration/update: EITHER the raw `Governorate / Center or City / Village` text (the approved input format, also what an
 * Excel cell holds) OR structured fields (registered governorate id + free-text center/village). Never both, never neither.
 * The country is never an input: it is the country of the Parent's organization.
 */
export type ParentAddressSubmission =
  | { readonly kind: 'raw'; readonly text: unknown }
  | { readonly kind: 'structured'; readonly governorateId: unknown; readonly centerName?: unknown; readonly villageName?: unknown };

export interface RegisterParentInput {
  readonly schoolId: string;
  /** The Parent's personal name: exactly three parts. */
  readonly name: unknown;
  /** Any accepted phone format; normalized to E.164. */
  readonly phone: unknown;
  readonly address: ParentAddressSubmission | undefined;
}

export interface ParentRegistrationResult {
  readonly parent: ParentDto;
  readonly link: ParentSchoolLinkDto;
  /** True when a NEW login account was created (with the initial password and the mandatory first-login change); false when an existing account was reused. */
  readonly accountCreated: boolean;
}

/** V1: only the address can be corrected here. The personal name is the account's canonical name (Module 08) shared by every role of the account. */
export interface UpdateParentInput {
  readonly address?: ParentAddressSubmission | undefined;
}

export interface ListParentsInput {
  readonly schoolId: string;
  readonly sort?: ParentSortKey;
  readonly direction?: 'asc' | 'desc';
  readonly page: PageRequest;
}

export interface ParentServiceDeps {
  readonly parents: ParentRepository;
  readonly links: ParentSchoolLinkRepository;
  readonly schools: Pick<SchoolLookup, 'findById'>;
  readonly address: Pick<UnifiedAddressService, 'validateParentAddress' | 'validateRawParentAddress'>;
  readonly identity: Pick<IdentityService, 'findById' | 'findByPhone' | 'createUser'>;
  readonly roles: Pick<RoleService, 'assignRole' | 'hasRole'>;
  /** Students that depend on a Parent-to-School relationship (Module 19 supplies the real one; see `parent-student-dependencies.ts`). */
  readonly studentDependencies: ParentStudentDependencies;
  readonly unitOfWork: UnitOfWork;
  readonly outbox: OutboxService;
  readonly clock?: Clock;
}

/**
 * Public application contract of Module 17 (Parents), Master Specification §32/§34 and the approved Module 17 decisions.
 *
 * It does NOT authorize its callers: routes use the Authorization Engine (`parents.*` permissions, see parent-authorization.ts) before they
 * call it. What it enforces itself are the business rules:
 *  - a Parent is `User -> PARENT role -> Parent entity`, with an EXACTLY three-part personal name, the phone and a Parent Address (country =
 *    the organization's). The name is stored once, on the account (`users.full_name`, Module 08), never on the Parent record;
 *  - the school must exist and be ACTIVE; the organization is the school's organization;
 *  - a NEW phone creates a new account (with the name) whose initial password is the last four digits of the phone, flagged as "must change
 *    password" (account level, Module 08/10). An EXISTING phone is never merged, overwritten or given a new password: the account is reused
 *    only when its stored three-part name equals the submitted one (the approved matching criterion; it is not independent proof of
 *    identity) and, if it already has a Parent record, that record belongs to the same organization. A missing or different stored name, or
 *    anything else that cannot be matched, is PARENT_IDENTITY_CONFLICT. The account's name, password and security state are never touched and
 *    the PARENT role is added only when missing;
 *  - a Parent is never reused across organizations (PARENT_ORGANIZATION_CONFLICT); within the organization each school gets its own link;
 *  - removing a school link keeps the account, the Parent record, the address history and the other links, and is refused while the Parent
 *    still has students in that school (PARENT_HAS_STUDENTS_IN_SCHOOL);
 *  - there is deliberately NO global deactivation or deletion of a Parent (decision D-3 is still open).
 * Every write is one transaction together with its outbox events.
 */
export class ParentService {
  private readonly parents: ParentRepository;
  private readonly links: ParentSchoolLinkRepository;
  private readonly schools: ParentServiceDeps['schools'];
  private readonly address: ParentServiceDeps['address'];
  private readonly identity: ParentServiceDeps['identity'];
  private readonly roles: ParentServiceDeps['roles'];
  private readonly studentDependencies: ParentStudentDependencies;
  private readonly unitOfWork: UnitOfWork;
  private readonly outbox: OutboxService;
  private readonly clock: Clock;

  constructor(deps: ParentServiceDeps) {
    this.parents = deps.parents;
    this.links = deps.links;
    this.schools = deps.schools;
    this.address = deps.address;
    this.identity = deps.identity;
    this.roles = deps.roles;
    this.studentDependencies = deps.studentDependencies;
    this.unitOfWork = deps.unitOfWork;
    this.outbox = deps.outbox;
    this.clock = deps.clock ?? new SystemClock();
  }

  // ---------------------------------------------------------------------------------------------- registration / reuse

  /** Creates or reuses the Parent for `phone` and links it to `schoolId`. See the class comment for the exact identity rules. */
  async registerParent(input: RegisterParentInput, actorId: string, tx?: TransactionContext): Promise<ParentRegistrationResult> {
    // Input that needs no database is validated first (fail fast, no transaction opened for a malformed request).
    const name = normalizeParentName(input.name);
    const phone = normalizePhone(input.phone);
    if (input.address === undefined) throw parentError('PARENT_ADDRESS_REQUIRED');

    return this.inTransaction(tx, async (t) => {
      const school = await this.schools.findById(input.schoolId, t);
      if (!school || school.status !== 'ACTIVE') throw parentError('PARENT_SCHOOL_NOT_ACTIVE');
      const organizationId = school.organizationId;
      const address = await this.validateAddress(input.address as ParentAddressSubmission, organizationId, t);

      const existingUser = await this.identity.findByPhone(phone, t);
      if (!existingUser) {
        const user = await this.identity.createUser({ phone, password: initialPasswordFromPhone(phone), mustChangePassword: true, fullName: name }, t);
        await this.roles.assignRole({ userId: user.id, roleCode: 'PARENT', assignedBy: actorId }, t);
        const parent = await this.createParent(user.id, organizationId, address, actorId, t);
        const link = await this.createLink(parent, school.id, actorId, t);
        return { parent: await this.toDto(parent, t), link: toParentSchoolLinkDto(link), accountCreated: true };
      }

      // An existing account: nothing about it is changed (no password, no flag, no merge, no overwrite).
      if (!existingUser.isActive) throw parentError('PARENT_ACCOUNT_INACTIVE');
      const existingParent = await this.parents.lockByUserId(existingUser.id, t);

      if (existingParent) {
        if (existingParent.organizationId !== organizationId) throw parentError('PARENT_ORGANIZATION_CONFLICT');
        if (!isSameParentName(existingUser.fullName, name)) throw parentError('PARENT_IDENTITY_CONFLICT');
        if (await this.links.findActive(existingParent.id, school.id, t)) throw parentError('PARENT_ALREADY_LINKED_TO_SCHOOL');
        await this.ensureParentRole(existingUser.id, actorId, t);
        const link = await this.createLink(existingParent, school.id, actorId, t);
        return { parent: await this.toDto(existingParent, t), link: toParentSchoolLinkDto(link), accountCreated: false };
      }

      // An account that is not a Parent yet (an organization manager, a school manager, a teacher...): the approved matching criterion is the
      // canonical three-part name stored on the account. A missing or different stored name is an identity conflict. (A matching name is the
      // approved criterion for this workflow; it is not independent proof of identity.)
      if (!isSameParentName(existingUser.fullName, name)) throw parentError('PARENT_IDENTITY_CONFLICT');
      await this.ensureParentRole(existingUser.id, actorId, t);
      const parent = await this.createParent(existingUser.id, organizationId, address, actorId, t);
      const link = await this.createLink(parent, school.id, actorId, t);
      return { parent: await this.toDto(parent, t), link: toParentSchoolLinkDto(link), accountCreated: false };
    });
  }

  // ---------------------------------------------------------------------------------------------- reads

  async getParent(parentId: string, tx?: TransactionContext): Promise<ParentDto> {
    const parent = await this.parents.findById(parentId, tx);
    if (!parent) throw parentError('PARENT_NOT_FOUND');
    return this.toDto(parent, tx);
  }

  /** The caller's own profile (the PARENT role reads only their own record). */
  async getOwnProfile(userId: string, tx?: TransactionContext): Promise<ParentDto> {
    const parent = await this.parents.findByUserId(userId, tx);
    if (!parent) throw parentError('PARENT_NOT_FOUND');
    return this.toDto(parent, tx);
  }

  /** The Parents with an ACTIVE link to `schoolId` (the route has already proven the caller manages that school). */
  async listParentsOfSchool(input: ListParentsInput, tx?: TransactionContext): Promise<PageResult<ParentDto>> {
    const { items, total } = await this.parents.listBySchool(
      { schoolId: input.schoolId, sort: input.sort ?? 'createdAt', direction: input.direction ?? 'desc', page: input.page },
      tx,
    );
    const ids = items.map((p) => p.id);
    const [addresses, links] = await Promise.all([this.parents.findCurrentAddresses(ids, tx), this.links.listActiveByParents(ids, tx)]);
    const dtos = await Promise.all(
      items.map(async (parent) => toParentDto({ parent, ...(await this.accountOf(parent.userId, tx)), address: addresses.get(parent.id), links: links.get(parent.id) ?? [] })),
    );
    return buildPageResult(dtos, total, input.page);
  }

  // ---------------------------------------------------------------------------------------------- update

  /**
   * Corrects the Parent's address. A new address becomes the current one and the previous one stays in the history (with the Governorate
   * name as it was); an unchanged address changes nothing. The phone, the name, the organization and the account never change here.
   */
  async updateParent(parentId: string, input: UpdateParentInput, actorId: string, tx?: TransactionContext): Promise<ParentDto> {
    const submitted = input.address;
    if (submitted === undefined) throw parentError('PARENT_UPDATE_EMPTY');

    return this.inTransaction(tx, async (t) => {
      const parent = await this.parents.lockById(parentId, t);
      if (!parent) throw parentError('PARENT_NOT_FOUND');

      let changed = false;
      {
        const next = await this.validateAddress(submitted, parent.organizationId, t);
        const current = await this.parents.findCurrentAddress(parent.id, t);
        if (!current || !sameAddress(current, next)) {
          await this.parents.replaceCurrentAddress(this.addressEntry(parent.id, next, actorId), t);
          parent.addressChanged(actorId, this.clock);
          changed = true;
        }
      }
      if (changed) {
        await this.parents.update(parent, t);
        await this.outbox.publishFrom(parent, t);
      }
      return this.toDto(parent, t);
    });
  }

  // ---------------------------------------------------------------------------------------------- school relationship

  /**
   * Ends the Parent's relationship with ONE school. The account, the Parent record, the address history and the links to other schools are
   * untouched; the ended link stays in the history. A Parent who still has students in the school cannot be unlinked (PARENT_HAS_STUDENTS_IN_SCHOOL, via the Module 19 guard).
   */
  removeSchoolLink(parentId: string, schoolId: string, actorId: string, tx?: TransactionContext): Promise<ParentSchoolLinkDto> {
    return this.inTransaction(tx, async (t) => {
      if (!(await this.parents.lockById(parentId, t))) throw parentError('PARENT_NOT_FOUND');
      const link = await this.links.lockActive(parentId, schoolId, t);
      if (!link) throw parentError('PARENT_SCHOOL_LINK_NOT_FOUND');
      // Never leave a student whose Parent relationship with this school would become invalid.
      if ((await this.studentDependencies.countStudentsOfParentInSchool(parentId, schoolId, t)) > 0) throw parentError('PARENT_HAS_STUDENTS_IN_SCHOOL');
      link.unlink(actorId, this.clock);
      await this.links.update(link, t);
      await this.outbox.publishFrom(link, t);
      return toParentSchoolLinkDto(link);
    });
  }

  // ---------------------------------------------------------------------------------------------- ParentLookup (read-only contract for other modules)

  async findById(parentId: string, tx?: TransactionContext): Promise<ParentDto | undefined> {
    const parent = await this.parents.findById(parentId, tx);
    return parent ? this.toDto(parent, tx) : undefined;
  }

  async findByUserId(userId: string, tx?: TransactionContext): Promise<ParentDto | undefined> {
    const parent = await this.parents.findByUserId(userId, tx);
    return parent ? this.toDto(parent, tx) : undefined;
  }

  async listActiveSchoolIds(parentId: string, tx?: TransactionContext): Promise<string[]> {
    return (await this.links.listActiveByParent(parentId, tx)).map((l) => l.snapshot.schoolId);
  }

  async isLinkedToSchool(parentId: string, schoolId: string, tx?: TransactionContext): Promise<boolean> {
    return (await this.links.findActive(parentId, schoolId, tx)) !== undefined;
  }

  /** The current Parent Address (students derive their address from it, §28/§37). */
  async getCurrentAddress(parentId: string, tx?: TransactionContext): Promise<ParentAddressDto | undefined> {
    const entry = await this.parents.findCurrentAddress(parentId, tx);
    return entry ? toParentAddressDto(entry) : undefined;
  }

  /** Every address the Parent ever had (current and ended), oldest first. */
  async listAddressHistory(parentId: string, tx?: TransactionContext): Promise<Array<ParentAddressDto & { readonly endedAt: Date | null }>> {
    return (await this.parents.listAddressHistory(parentId, tx)).map((e) => ({ ...toParentAddressDto(e), endedAt: e.endedAt }));
  }

  async listSchoolLinkHistory(parentId: string, tx?: TransactionContext): Promise<ParentSchoolLinkDto[]> {
    return (await this.links.listHistoryByParent(parentId, tx)).map(toParentSchoolLinkDto);
  }

  // ---------------------------------------------------------------------------------------------- internals

  private async validateAddress(submission: ParentAddressSubmission, organizationId: string, t: TransactionContext): Promise<ParentAddress> {
    if (submission.kind === 'raw') return this.address.validateRawParentAddress(submission.text, organizationId, t);
    return this.address.validateParentAddress({ organizationId, governorateId: submission.governorateId, centerName: submission.centerName, villageName: submission.villageName }, t);
  }

  private addressEntry(parentId: string, address: ParentAddress, actorId: string): ParentAddressEntry {
    return {
      id: newUuid(),
      parentId,
      governorateId: address.governorateId,
      governorateName: address.governorateName,
      centerName: address.centerName,
      villageName: address.villageName,
      createdBy: actorId,
      createdAt: this.clock.now(),
      endedAt: null,
    };
  }

  private async createParent(userId: string, organizationId: string, address: ParentAddress, actorId: string, t: TransactionContext): Promise<Parent> {
    const parent = Parent.register({ userId, organizationId, createdBy: actorId, clock: this.clock });
    await this.parents.insert(parent, t);
    await this.parents.insertAddress(this.addressEntry(parent.id, address, actorId), t);
    await this.outbox.publishFrom(parent, t);
    return parent;
  }

  private async createLink(parent: Parent, schoolId: string, actorId: string, t: TransactionContext): Promise<ParentSchoolLink> {
    const link = ParentSchoolLink.link({ parentId: parent.id, userId: parent.userId, organizationId: parent.organizationId, schoolId, linkedBy: actorId, clock: this.clock });
    await this.links.insert(link, t);
    await this.outbox.publishFrom(link, t);
    return link;
  }

  /** Gives an existing, identity-confirmed account the PARENT role only if it does not hold it. Nothing else about the account changes. */
  private async ensureParentRole(userId: string, actorId: string, t: TransactionContext): Promise<void> {
    if (!(await this.roles.hasRole(userId, 'PARENT', t))) await this.roles.assignRole({ userId, roleCode: 'PARENT', assignedBy: actorId }, t);
  }

  /** The phone and the canonical personal name come from the account (Module 08), the single source of both. */
  private async accountOf(userId: string, tx?: TransactionContext): Promise<{ phone: string; name: string }> {
    const user = await this.identity.findById(userId, tx);
    // Accounts are never deleted and a Parent's account always carries its name: a data-integrity failure, not a client error.
    if (!user || user.fullName === null) throw new Error(`Parent account ${userId} is missing or has no personal name`);
    return { phone: user.phone, name: user.fullName };
  }

  private async toDto(parent: Parent, tx?: TransactionContext): Promise<ParentDto> {
    const [account, address, links] = await Promise.all([
      this.accountOf(parent.userId, tx),
      this.parents.findCurrentAddress(parent.id, tx),
      this.links.listActiveByParent(parent.id, tx),
    ]);
    return toParentDto({ parent, ...account, address, links });
  }

  private inTransaction<T>(tx: TransactionContext | undefined, work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return tx ? work(tx) : this.unitOfWork.run(work);
  }
}

function sameAddress(current: ParentAddressEntry, next: ParentAddress): boolean {
  return current.governorateId === next.governorateId && current.centerName === next.centerName && current.villageName === next.villageName;
}

/** What downstream modules (Students 19, Reports...) should depend on (read-only). */
export type ParentLookup = Pick<
  ParentService,
  'findById' | 'findByUserId' | 'listActiveSchoolIds' | 'isLinkedToSchool' | 'getCurrentAddress' | 'listAddressHistory' | 'listSchoolLinkHistory'
>;
