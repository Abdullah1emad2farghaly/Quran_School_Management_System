import { SystemClock, buildPageResult, newUuid, type Clock, type PageRequest, type PageResult, type TransactionContext, type UnitOfWork } from '../../../00-shared-kernel/public';
import type { OutboxService } from '../../../06-domain-events-outbox/public';
import { normalizePhone, type IdentityService } from '../../../08-identity-core/public';
import { isAssignableRole, type RoleService } from '../../../09-roles-permissions/public';
import type { OrganizationLookup } from '../../../13-organization-core/public';
import type { UnifiedAddressLookup } from '../../../15-unified-address/public';
import { School } from '../../domain/entities/school';
import { SchoolManagerAssignment, type SchoolManagerSource } from '../../domain/entities/school-manager-assignment';
import { schoolError } from '../../domain/errors/school-errors';
import { normalizeApplicantName } from '../../domain/value-objects/applicant-name';
import { ApplicantAccountResolver } from './applicant-account-resolver';
import { parseGpsFix } from '../../domain/value-objects/gps';
import { normalizeSchoolName } from '../../domain/value-objects/school-name';
import { toSchoolDto, toSchoolManagerAssignmentDto, type SchoolDto, type SchoolManagerAssignmentDto } from '../dto/school-dto';
import type { SchoolCodeSequence } from '../ports/school-code-sequence';
import type { SchoolManagerRepository } from '../ports/school-manager-repository';
import type { SchoolGpsHistoryEntry, SchoolRepository, SchoolSortKey, SchoolStatusHistoryEntry } from '../ports/school-repository';
import type { SchoolStatus } from '../../domain/value-objects/school-status';

export interface SchoolAddressInput {
  /**
   * Optional and NEVER trusted: the school's country is always the country of its organization. If a client sends one it must
   * equal that country (otherwise SCHOOL_COUNTRY_MISMATCH); it cannot be used to pick a different country.
   */
  readonly countryId?: unknown;
  /** A registered, ACTIVE governorate of the organization's country. */
  readonly governorateId: unknown;
  /** Free text (never a registered node). */
  readonly centerName?: unknown;
  /** Free text; only together with a center. */
  readonly villageName?: unknown;
}

export interface CreateSchoolInput extends SchoolAddressInput {
  /** An existing organization. The caller (the route) has already proven, through the Authorization Engine, that the actor manages it. */
  readonly organizationId: string;
  readonly name: unknown;
  /** `latitude`, `longitude`, `accuracyMeters` of the physical GPS fix. */
  readonly gps: unknown;
  /** The acting organization manager (from the verified token). */
  readonly actorId: string;
}

/** The applicant's form fields. The phone is normalized and validated by IAM rules; the name by `normalizeApplicantName`. */
export interface ApplicantInput {
  readonly name: unknown;
  readonly phone: unknown;
  /** The password of the NEW account the applicant chooses (required when not logged in; ignored for a logged-in applicant). */
  readonly password?: unknown;
}

export interface SubmitSchoolInput extends SchoolAddressInput {
  /** The organization the school will belong to. */
  readonly organizationId: string;
  readonly applicant: ApplicantInput;
  readonly name: unknown;
  readonly gps: unknown;
  /**
   * Set only when the caller presented a valid access token (the HTTP layer takes it from the session, never from the
   * body). The applicant is then THAT logged-in user (their authenticated identity is the proof); the submitted phone
   * must be their own. Without it a new account is created and an existing phone is a conflict.
   */
  readonly authenticatedUserId?: string;
}

export interface SchoolSubmissionResult {
  readonly school: SchoolDto;
  readonly applicant: { readonly userId: string; readonly accountCreated: boolean };
}

export interface ListSchoolsInput {
  readonly actorId: string;
  readonly statuses?: readonly SchoolStatus[];
  readonly sort?: SchoolSortKey;
  readonly direction?: 'asc' | 'desc';
  readonly page: PageRequest;
}

export interface SchoolServiceDeps {
  readonly repository: SchoolRepository;
  readonly managers: SchoolManagerRepository;
  readonly codes: SchoolCodeSequence;
  readonly unitOfWork: UnitOfWork;
  readonly outbox: OutboxService;
  readonly organizations: Pick<OrganizationLookup, 'requireById' | 'requireOrganizationCountryId' | 'isOrganizationAdmin' | 'listAdministeredOrganizationIds'>;
  /** School addresses use the shared address contract (registered governorate, free-text center and village). */
  readonly address: Pick<UnifiedAddressLookup, 'validateSchoolAddress'>;
  readonly identity: Pick<IdentityService, 'findById' | 'createUser' | 'ensureFullName'>;
  readonly roles: Pick<RoleService, 'hasRole' | 'assignRole'>;
  /** Produces the unguessable password of a newly created applicant account (see `submitSchool`). Required for submissions. */
  readonly generateApplicantPassword?: () => string;
  readonly clock?: Clock;
}

export interface ApproveSchoolResult {
  readonly school: SchoolDto;
  /** The applicant's School Manager link; null when the school had no applicant (an organization manager created it). */
  readonly manager: SchoolManagerAssignmentDto | null;
}

/**
 * Module 16 application contract (Master Specification §29-31). A school belongs directly to an organization; every new school
 * starts PENDING and becomes ACTIVE only when the owning organization's manager approves it.
 *
 * AUTHORIZATION is NOT decided here: who may call each operation (ORGANIZATION_MANAGER of the owning organization, SCHOOL_MANAGER of
 * the school...) is enforced by the shared Authorization Engine (Module 12) at the route through `requirePermission`, with the scope
 * resolvers registered by `registerSchoolAuthorization`. This service owns the BUSINESS rules (lifecycle, GPS, address, uniqueness,
 * manager eligibility) and trusts that its caller was authorized; `actorId` always comes from the verified token.
 *
 * Every write runs in ONE UnitOfWork transaction (or the caller's): the school change, history rows, manager link,
 * role assignment and outbox events commit together or not at all.
 */
export class SchoolService {
  private readonly repository: SchoolRepository;
  private readonly managers: SchoolManagerRepository;
  private readonly codes: SchoolCodeSequence;
  private readonly unitOfWork: UnitOfWork;
  private readonly outbox: OutboxService;
  private readonly organizations: SchoolServiceDeps['organizations'];
  private readonly address: SchoolServiceDeps['address'];
  private readonly identity: SchoolServiceDeps['identity'];
  private readonly roles: SchoolServiceDeps['roles'];
  private readonly applicants: ApplicantAccountResolver;
  private readonly clock: Clock;

  constructor(deps: SchoolServiceDeps) {
    this.repository = deps.repository;
    this.managers = deps.managers;
    this.codes = deps.codes;
    this.unitOfWork = deps.unitOfWork;
    this.outbox = deps.outbox;
    this.organizations = deps.organizations;
    this.address = deps.address;
    this.identity = deps.identity;
    this.roles = deps.roles;
    this.applicants = new ApplicantAccountResolver(deps.identity, deps.generateApplicantPassword);
    this.clock = deps.clock ?? new SystemClock();
  }

  // ---------------------------------------------------------------------------------------------- reads (SchoolLookup)

  async findById(id: string, tx?: TransactionContext): Promise<SchoolDto | undefined> {
    const school = await this.repository.findById(id, tx);
    return school ? toSchoolDto(school) : undefined;
  }

  /** Throws SCHOOL_NOT_FOUND. */
  async getById(id: string, tx?: TransactionContext): Promise<SchoolDto> {
    const school = await this.findById(id, tx);
    if (!school) throw schoolError('SCHOOL_NOT_FOUND');
    return school;
  }

  async findByCode(code: string, tx?: TransactionContext): Promise<SchoolDto | undefined> {
    const school = await this.repository.findByCode(code, tx);
    return school ? toSchoolDto(school) : undefined;
  }

  /**
   * True only while `userId` has an ACTIVE manager link to exactly this school. It says nothing about the school's
   * status: callers that protect operations must also check the school is ACTIVE (and the engine's rules).
   */
  isSchoolManager(userId: string, schoolId: string, tx?: TransactionContext): Promise<boolean> {
    return this.managers.isActiveManager(userId, schoolId, tx);
  }

  listManagedSchoolIds(userId: string, tx?: TransactionContext): Promise<string[]> {
    return this.managers.listActiveSchoolIdsByUser(userId, tx);
  }

  async getActiveManagerUserId(schoolId: string, tx?: TransactionContext): Promise<string | undefined> {
    return (await this.managers.findActiveBySchool(schoolId, tx))?.userId;
  }

  async listManagerHistory(schoolId: string, tx?: TransactionContext): Promise<SchoolManagerAssignmentDto[]> {
    return (await this.managers.findHistoryBySchool(schoolId, tx)).map(toSchoolManagerAssignmentDto);
  }

  listStatusHistory(schoolId: string, tx?: TransactionContext): Promise<SchoolStatusHistoryEntry[]> {
    return this.repository.listStatusHistory(schoolId, tx);
  }

  listGpsHistory(schoolId: string, tx?: TransactionContext): Promise<SchoolGpsHistoryEntry[]> {
    return this.repository.listGpsHistory(schoolId, tx);
  }

  // ---------------------------------------------------------------------------------------------- creation

  /**
   * An organization manager creates a school of THEIR organization (the route proved the scope). The organization must exist and be
   * ACTIVE; the school's country is the organization's country. It starts PENDING (never ACTIVE before approval), has no applicant and
   * no manager yet, and grants the creator nothing.
   */
  createSchool(input: CreateSchoolInput, tx?: TransactionContext): Promise<SchoolDto> {
    return this.inTransaction(tx, async (t) => {
      const school = await this.buildSchool(input, input.actorId, null, input.organizationId, t);
      await this.persistNew(school, input.actorId, t);
      return toSchoolDto(school);
    });
  }

  /**
   * Public submission (no login needed): account creation (or logged-in reuse) + a PENDING school in one transaction. The applicant
   * receives NO role and NO manager link until the organization's manager approves. The organization is chosen by the applicant
   * (ORGANIZATION_NOT_FOUND / SCHOOL_ORGANIZATION_INACTIVE otherwise).
   */
  submitSchool(input: SubmitSchoolInput, tx?: TransactionContext): Promise<SchoolSubmissionResult> {
    return this.inTransaction(tx, async (t) => {
      const form = this.validateSubmission(input);
      const applicant = await this.applicants.resolve(form.phone, input.authenticatedUserId, t, form.password, true, form.applicantName);
      const school = await this.buildSchool(input, applicant.userId, applicant.userId, input.organizationId, t, form.applicantName);
      await this.persistNew(school, applicant.userId, t);
      return { school: toSchoolDto(school), applicant };
    });
  }

  // ---------------------------------------------------------------------------------------------- reads for an actor

  /**
   * The schools the caller may see, derived server-side from THEIR OWN links: every school of the organizations they manage (the
   * ORGANIZATION_MANAGER role AND an organization link; this is also the approval queue) plus the schools they actively manage (the
   * SCHOOL_MANAGER role AND a manager link). Never another organization's schools; nothing without a link.
   */
  async listSchools(input: ListSchoolsInput, tx?: TransactionContext): Promise<PageResult<SchoolDto>> {
    const organizationIds = await this.managedOrganizationIds(input.actorId, tx);
    const managerUserId = (await this.holdsActiveRole(input.actorId, 'SCHOOL_MANAGER', tx)) ? input.actorId : undefined;
    const { items, total } = await this.repository.list(
      {
        ...(managerUserId !== undefined ? { managerUserId } : {}),
        organizationIds,
        ...(input.statuses ? { statuses: input.statuses } : {}),
        sort: input.sort ?? 'createdAt',
        direction: input.direction ?? 'desc',
        page: input.page,
      },
      tx,
    );
    return buildPageResult(items.map(toSchoolDto), total, input.page);
  }

  // ---------------------------------------------------------------------------------------------- decisions

  /**
   * Approves a PENDING school. ONE atomic transaction: school ACTIVE + (when the school has an applicant) the applicant's manager link
   * scoped to this school + SCHOOL_MANAGER role (only if not already held) + history + events. The applicant's eligibility is
   * re-checked now; if they are no longer eligible the whole approval fails and the school stays PENDING (it may then be rejected).
   * A school without an applicant is approved without a manager (the organization manager assigns one afterwards). Never assigns
   * MAIN_ADMIN or ORGANIZATION_MANAGER.
   */
  approveSchool(schoolId: string, actorId: string, tx?: TransactionContext): Promise<ApproveSchoolResult> {
    return this.inTransaction(tx, async (t) => {
      const school = await this.requireForUpdate(schoolId, t);
      // The status comes first: a school that is not an approvable PENDING request (REJECTED is terminal, ACTIVE, INACTIVE) always answers
      // SCHOOL_INVALID_STATUS_TRANSITION, whatever the state of its organization or of the requester's account.
      if (school.snapshot.status !== 'PENDING') throw schoolError('SCHOOL_INVALID_STATUS_TRANSITION');
      await this.requireActiveOrganization(school.organizationId, t);
      const applicantId = school.applicantUserId;
      if (applicantId !== null) await this.requireEligibleManager(applicantId, t);

      const previous = school.status;
      school.approve(actorId, this.clock);
      await this.repository.update(school, t);
      await this.appendStatus(school.id, previous, school.status, actorId, null, t);

      const manager = applicantId !== null ? await this.linkManager(school.id, applicantId, 'APPROVAL', actorId, t) : null;
      await this.outbox.publishFrom(school, t);
      return { school: toSchoolDto(school), manager };
    });
  }

  /** Rejects a PENDING school with a nonblank reason. Terminal. No manager link, no role, the applicant is untouched. */
  rejectSchool(schoolId: string, actorId: string, reason: unknown, tx?: TransactionContext): Promise<SchoolDto> {
    return this.inTransaction(tx, async (t) => {
      const school = await this.requireForUpdate(schoolId, t);
      const previous = school.status;
      school.reject(actorId, reason, this.clock);
      await this.repository.update(school, t);
      await this.appendStatus(school.id, previous, school.status, actorId, school.snapshot.rejectionReason, t);
      await this.outbox.publishFrom(school, t);
      return toSchoolDto(school);
    });
  }

  // ---------------------------------------------------------------------------------------------- GPS and status

  /** Allowed only while the school is PENDING (immutable after approval); the change is kept in the GPS history. */
  correctPendingGps(schoolId: string, gps: unknown, actorId: string, tx?: TransactionContext): Promise<SchoolDto> {
    return this.inTransaction(tx, async (t) => {
      const fix = parseGpsFix(gps);
      const school = await this.requireForUpdate(schoolId, t);
      const previous = school.correctGps(fix, actorId, this.clock);
      await this.repository.update(school, t);
      await this.repository.appendGpsHistory(
        { id: newUuid(), schoolId: school.id, previous, current: fix, changedBy: actorId, changedAt: this.clock.now() },
        t,
      );
      await this.outbox.publishFrom(school, t);
      return toSchoolDto(school);
    });
  }

  /** ACTIVE -> INACTIVE (explicit, audited). */
  deactivateSchool(schoolId: string, actorId: string, tx?: TransactionContext): Promise<SchoolDto> {
    return this.changeStatus(schoolId, actorId, (school) => school.deactivate(actorId, this.clock), tx);
  }

  /** INACTIVE -> ACTIVE (explicit, audited). Reactivation is NOT approval: a PENDING or REJECTED school can never take this path. */
  reactivateSchool(schoolId: string, actorId: string, tx?: TransactionContext): Promise<SchoolDto> {
    return this.changeStatus(schoolId, actorId, (school) => school.reactivate(actorId, this.clock), tx);
  }

  // ---------------------------------------------------------------------------------------------- managers

  /**
   * Explicitly assigns the School Manager of an ACTIVE (approved) school (for a school created without an applicant, or to replace a
   * manager after a revocation). At most one active manager per school. The SCHOOL_MANAGER role is assigned
   * through Module 09 only when the user does not hold it yet.
   */
  assignSchoolManager(input: { schoolId: string; userId: string; actorId: string }, tx?: TransactionContext): Promise<SchoolManagerAssignmentDto> {
    return this.inTransaction(tx, async (t) => {
      const school = await this.requireForUpdate(input.schoolId, t);
      if (school.status !== 'ACTIVE') throw schoolError('SCHOOL_NOT_ACTIVE');
      await this.requireEligibleManager(input.userId, t);
      return this.linkManager(school.id, input.userId, 'ASSIGNMENT', input.actorId, t);
    });
  }

  /**
   * Ends the school's active manager link (history kept). It does NOT revoke the user's SCHOOL_MANAGER role (they may
   * manage other schools; role cleanup is not defined for V1).
   */
  revokeSchoolManager(input: { schoolId: string; actorId: string }, tx?: TransactionContext): Promise<SchoolManagerAssignmentDto> {
    return this.inTransaction(tx, async (t) => {
      await this.requireForUpdate(input.schoolId, t);
      const active = await this.managers.lockActiveBySchool(input.schoolId, t);
      if (!active) throw schoolError('SCHOOL_MANAGER_ASSIGNMENT_NOT_FOUND');
      active.revoke(input.actorId, this.clock);
      await this.managers.update(active, t);
      await this.outbox.publishFrom(active, t);
      return toSchoolManagerAssignmentDto(active);
    });
  }

  // ---------------------------------------------------------------------------------------------- internals

  private async buildSchool(
    input: SchoolAddressInput & { name: unknown; gps: unknown },
    createdBy: string,
    applicantUserId: string | null,
    organizationId: string,
    t: TransactionContext,
    applicantName?: string,
  ): Promise<School> {
    const name = normalizeSchoolName(input.name);
    const gps = parseGpsFix(input.gps);
    // A school belongs to an EXISTING organization (ORGANIZATION_NOT_FOUND otherwise), which must be ACTIVE and have a country.
    const organization = await this.organizations.requireById(organizationId, t);
    if (organization.status !== 'ACTIVE') throw schoolError('SCHOOL_ORGANIZATION_INACTIVE');
    const countryId = await this.organizations.requireOrganizationCountryId(organizationId, t);
    // The country is DERIVED from the organization. A client-supplied country is never used, only compared.
    if (input.countryId !== undefined && input.countryId !== null && input.countryId !== countryId) throw schoolError('SCHOOL_COUNTRY_MISMATCH');
    // Shared address contract: registered, ACTIVE governorate of the organization's country; center/city and village are free text.
    const address = await this.address.validateSchoolAddress(
      { organizationId, governorateId: input.governorateId, centerName: input.centerName, villageName: input.villageName },
      t,
    );
    const code = await this.codes.allocate(t); // last: the sequence lock is held until this transaction ends
    return School.create({
      name,
      code,
      organizationId,
      countryId,
      governorateId: address.governorateId,
      centerName: address.centerName,
      villageName: address.villageName,
      gps,
      createdBy,
      applicantUserId,
      ...(applicantName ? { applicantName } : {}),
      clock: this.clock,
    });
  }

  private async persistNew(school: School, actorId: string, t: TransactionContext): Promise<void> {
    await this.repository.insert(school, t);
    await this.appendStatus(school.id, null, school.status, actorId, null, t);
    await this.outbox.publishFrom(school, t);
  }

  private async changeStatus(schoolId: string, actorId: string, apply: (school: School) => void, tx?: TransactionContext): Promise<SchoolDto> {
    return this.inTransaction(tx, async (t) => {
      const school = await this.requireForUpdate(schoolId, t);
      const previous = school.status;
      apply(school);
      await this.repository.update(school, t);
      await this.appendStatus(school.id, previous, school.status, actorId, null, t);
      await this.outbox.publishFrom(school, t);
      return toSchoolDto(school);
    });
  }

  /** Manager link + role (only when not held yet) + event. Must run inside the caller's transaction. */
  private async linkManager(schoolId: string, userId: string, source: SchoolManagerSource, actorId: string, t: TransactionContext): Promise<SchoolManagerAssignmentDto> {
    if (await this.managers.lockActiveBySchool(schoolId, t)) throw schoolError('SCHOOL_ALREADY_HAS_MANAGER');
    const assignment = SchoolManagerAssignment.assign({ schoolId, userId, source, assignedBy: actorId, clock: this.clock });
    await this.managers.insert(assignment, t);
    if (!(await this.roles.hasRole(userId, 'SCHOOL_MANAGER', t))) {
      await this.roles.assignRole({ userId, roleCode: 'SCHOOL_MANAGER', assignedBy: actorId }, t);
    }
    await this.outbox.publishFrom(assignment, t);
    return toSchoolManagerAssignmentDto(assignment);
  }

  private async appendStatus(
    schoolId: string,
    from: SchoolStatusHistoryEntry['fromStatus'],
    to: SchoolStatusHistoryEntry['toStatus'],
    changedBy: string,
    reason: string | null,
    t: TransactionContext,
  ): Promise<void> {
    await this.repository.appendStatusHistory({ id: newUuid(), schoolId, fromStatus: from, toStatus: to, changedBy, reason, changedAt: this.clock.now() }, t);
  }

  private async requireForUpdate(schoolId: string, t: TransactionContext): Promise<School> {
    const school = await this.repository.findByIdForUpdate(schoolId, t);
    if (!school) throw schoolError('SCHOOL_NOT_FOUND');
    return school;
  }

  private async requireActiveOrganization(organizationId: string, t: TransactionContext): Promise<void> {
    const organization = await this.organizations.requireById(organizationId, t);
    if (organization.status !== 'ACTIVE') throw schoolError('SCHOOL_ORGANIZATION_INACTIVE');
  }

  /** Organizations the caller manages: empty unless they are an ACTIVE user holding ORGANIZATION_MANAGER; then their active organization links. */
  private async managedOrganizationIds(actorId: string, t?: TransactionContext): Promise<string[]> {
    return (await this.holdsActiveRole(actorId, 'ORGANIZATION_MANAGER', t)) ? this.organizations.listAdministeredOrganizationIds(actorId, t) : [];
  }

  private async holdsActiveRole(actorId: string, role: 'ORGANIZATION_MANAGER' | 'SCHOOL_MANAGER', t?: TransactionContext): Promise<boolean> {
    const actor = typeof actorId === 'string' ? await this.identity.findById(actorId, t) : undefined;
    return !!actor && actor.isActive && (await this.roles.hasRole(actor.id, role, t));
  }

  /**
   * Eligibility for the School Manager role (approved rule, nothing more): a valid user identity, an ACTIVE account,
   * and the SCHOOL_MANAGER role must be assignable. No Teacher or other prior role is required.
   */
  private async requireEligibleManager(userId: string, t: TransactionContext): Promise<void> {
    const user = typeof userId === 'string' ? await this.identity.findById(userId, t) : undefined;
    if (!user || !user.isActive || !isAssignableRole('SCHOOL_MANAGER')) throw schoolError('SCHOOL_MANAGER_NOT_ELIGIBLE');
  }

  /** Pure form validation (before anything is written): applicant name, phone (IAM normalization, E.164), school name and GPS. */
  private validateSubmission(input: SubmitSchoolInput): { applicantName: string; phone: string; password: unknown } {
    const applicant = (typeof input.applicant === 'object' && input.applicant !== null ? input.applicant : {}) as Partial<ApplicantInput>;
    const applicantName = normalizeApplicantName(applicant.name);
    const phone = normalizePhone(applicant.phone as string); // IAM rules; throws the IAM validation error for a bad phone
    normalizeSchoolName(input.name);
    parseGpsFix(input.gps);
    return { applicantName, phone, password: applicant.password };
  }

  private inTransaction<T>(tx: TransactionContext | undefined, work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return tx ? work(tx) : this.unitOfWork.run(work);
  }
}

/** What downstream modules (Parents 17, Teachers 18, Groups 20...) should depend on (read-only). */
export type SchoolLookup = Pick<
  SchoolService,
  'findById' | 'getById' | 'findByCode' | 'isSchoolManager' | 'listManagedSchoolIds' | 'getActiveManagerUserId' | 'listManagerHistory' | 'listStatusHistory' | 'listGpsHistory'
>;
