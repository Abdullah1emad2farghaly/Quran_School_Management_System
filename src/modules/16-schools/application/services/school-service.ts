import { SystemClock, buildPageResult, newUuid, type Clock, type PageRequest, type PageResult, type TransactionContext, type UnitOfWork } from '../../../00-shared-kernel/public';
import type { OutboxService } from '../../../06-domain-events-outbox/public';
import { normalizePhone, type IdentityService } from '../../../08-identity-core/public';
import { isAssignableRole, type RoleService } from '../../../09-roles-permissions/public';
import type { OrganizationLookup } from '../../../13-organization-core/public';
import type { GeographyLookup } from '../../../14-geography/public';
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
import type { SchoolType } from '../../domain/value-objects/school-type';

export interface SchoolAddressInput {
  /**
   * Optional and NEVER trusted: the school's country is always the country of its organization. If a client sends one it must
   * equal that country (otherwise SCHOOL_COUNTRY_MISMATCH); it cannot be used to pick a different country.
   */
  readonly countryId?: unknown;
  readonly governorateId: string;
  readonly centerId?: string | null;
  readonly villageId?: string | null;
}

export interface CreateMainSchoolInput extends SchoolAddressInput {
  /** An existing organization; the actor must be its administrator. */
  readonly organizationId: string;
  readonly name: unknown;
  /** `latitude`, `longitude`, `accuracyMeters` of the physical GPS fix. */
  readonly gps: unknown;
  /** The acting administrator of the organization. */
  readonly actorId: string;
}

export interface RequestSubSchoolInput extends SchoolAddressInput {
  /** An existing user. Becomes the School Manager ONLY if the Main Admin approves. */
  readonly requesterUserId: string;
  readonly parentSchoolId: string;
  readonly name: unknown;
  readonly gps: unknown;
}

/** The applicant's form fields. The phone is normalized and validated by IAM rules; the name by `normalizeApplicantName`. */
export interface ApplicantInput {
  readonly name: unknown;
  readonly phone: unknown;
}

interface SubmissionBase extends SchoolAddressInput {
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

export interface SubmitSubSchoolInput extends SubmissionBase {
  readonly parentSchoolId: string;
}

export interface SchoolSubmissionResult {
  readonly school: SchoolDto;
  readonly applicant: { readonly userId: string; readonly accountCreated: boolean };
}

export interface ListSchoolsInput {
  readonly actorId: string;
  readonly statuses?: readonly SchoolStatus[];
  readonly type?: SchoolType;
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
  readonly geography: Pick<GeographyLookup, 'validateHierarchy'>;
  readonly identity: Pick<IdentityService, 'findById' | 'createUser'>;
  readonly roles: Pick<RoleService, 'hasRole' | 'assignRole'>;
  /** Produces the unguessable password of a newly created applicant account (see `submitSubSchool`). Required for submissions. */
  readonly generateApplicantPassword?: () => string;
  readonly clock?: Clock;
}

export interface ApproveSubSchoolResult {
  readonly school: SchoolDto;
  readonly manager: SchoolManagerAssignmentDto;
}

/**
 * Module 16 application contract (Master Specification §29-31). No endpoints and no permissions: HTTP authorization
 * (Module 12) arrives with the endpoints once decisions D-1/D-2 are approved. Until then every operation that
 * changes a school still REQUIRES the actor to be an ACTIVE Main Admin (`SCHOOL_ACTION_NOT_ALLOWED` otherwise),
 * a deny-by-default check that is provisional and never replaces the engine's scope rules.
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
  private readonly geography: SchoolServiceDeps['geography'];
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
    this.geography = deps.geography;
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
   * Only an ACTIVE administrator of THE organization (MAIN_ADMIN role AND an organization link) may create a Main School under
   * it. The organization must exist; the school's country is the organization's country. It starts ACTIVE (no approval) and
   * grants the creator nothing.
   */
  createMainSchool(input: CreateMainSchoolInput, tx?: TransactionContext): Promise<SchoolDto> {
    return this.inTransaction(tx, async (t) => {
      await this.requireOrganizationAdmin(input.actorId, input.organizationId, t);
      const school = await this.buildSchool(input, input.actorId, 'MAIN', null, input.organizationId, t);
      await this.persistNew(school, input.actorId, t);
      return toSchoolDto(school);
    });
  }

  /**
   * A Sub-School request (status PENDING). The requester must be an eligible existing user and the parent an ACTIVE
   * Main School. It grants NOTHING: no manager link, no role. A brand-new applicant account is NOT created here
   * (see docs/SCHOOLS.md, "Blocker").
   */
  requestSubSchool(input: RequestSubSchoolInput, tx?: TransactionContext): Promise<SchoolDto> {
    return this.inTransaction(tx, async (t) => {
      await this.requireEligibleManager(input.requesterUserId, t);
      const parent = await this.repository.findById(input.parentSchoolId, t);
      if (!parent || parent.type !== 'MAIN' || parent.status !== 'ACTIVE') throw schoolError('SCHOOL_PARENT_INVALID');
      const school = await this.buildSchool(input, input.requesterUserId, 'SUB', parent.id, parent.organizationId, t);
      await this.persistNew(school, input.requesterUserId, t);
      return toSchoolDto(school);
    });
  }

  // ---------------------------------------------------------------------------------------------- public submissions

  /**
   * Public Sub-School submission (no login needed): account creation (or logged-in reuse) + a PENDING request in one
   * transaction. The applicant receives NO role and NO manager link until a Main Admin approves.
   */
  submitSubSchool(input: SubmitSubSchoolInput, tx?: TransactionContext): Promise<SchoolSubmissionResult> {
    return this.inTransaction(tx, async (t) => {
      const form = this.validateSubmission(input);
      const parent = await this.repository.findById(input.parentSchoolId, t);
      if (!parent || parent.type !== 'MAIN' || parent.status !== 'ACTIVE') throw schoolError('SCHOOL_PARENT_INVALID');
      const applicant = await this.applicants.resolve(form.phone, input.authenticatedUserId, t);
      const school = await this.buildSchool(input, applicant.userId, 'SUB', parent.id, parent.organizationId, t, form.applicantName);
      await this.persistNew(school, applicant.userId, t);
      return { school: toSchoolDto(school), applicant };
    });
  }

  // ---------------------------------------------------------------------------------------------- reads for an actor

  /**
   * The schools the caller may see: those of the organizations they ADMINISTER (MAIN_ADMIN role and an organization link: the
   * organization scope; this is also the review queue of §31), plus the schools they submitted or actively manage. Never another
   * organization's schools.
   */
  async listSchools(input: ListSchoolsInput, tx?: TransactionContext): Promise<PageResult<SchoolDto>> {
    const organizationIds = await this.administeredOrganizationIds(input.actorId, tx);
    const { items, total } = await this.repository.list(
      {
        visibleTo: input.actorId,
        organizationIds,
        ...(input.statuses ? { statuses: input.statuses } : {}),
        ...(input.type ? { type: input.type } : {}),
        sort: input.sort ?? 'createdAt',
        direction: input.direction ?? 'desc',
        page: input.page,
      },
      tx,
    );
    return buildPageResult(items.map(toSchoolDto), total, input.page);
  }

  /** One school, if the caller may see it (same visibility as the list); otherwise SCHOOL_NOT_FOUND (existence is not revealed). */
  async getSchoolForActor(schoolId: string, actorId: string, tx?: TransactionContext): Promise<SchoolDto> {
    const school = await this.repository.findById(schoolId, tx);
    if (!school) throw schoolError('SCHOOL_NOT_FOUND');
    const visible =
      school.createdBy === actorId ||
      (await this.isOrganizationAdmin(actorId, school.organizationId, tx)) ||
      (await this.managers.isActiveManager(actorId, school.id, tx));
    if (!visible) throw schoolError('SCHOOL_NOT_FOUND');
    return toSchoolDto(school);
  }

  // ---------------------------------------------------------------------------------------------- decisions

  /**
   * Main Admin approves a PENDING Sub-School. ONE atomic transaction: school ACTIVE + manager link for the requester
   * (scoped to this school) + SCHOOL_MANAGER role (only if not already held) + history + events. The requester's
   * eligibility is re-checked now; if they are no longer eligible the whole approval fails and the school stays
   * PENDING (the Main Admin may then reject it). Never assigns MAIN_ADMIN.
   */
  approveSubSchool(schoolId: string, actorId: string, tx?: TransactionContext): Promise<ApproveSubSchoolResult> {
    return this.inTransaction(tx, async (t) => {
      const school = await this.requireSchoolAdmin(schoolId, actorId, t);
      await this.requireActiveOrganization(school.organizationId, t);
      const requesterId = school.createdBy;
      await this.requireEligibleManager(requesterId, t);

      const previous = school.status;
      school.approve(actorId, this.clock);
      await this.repository.update(school, t);
      await this.appendStatus(school.id, previous, school.status, actorId, null, t);

      const manager = await this.linkManager(school.id, requesterId, 'SUB_SCHOOL_APPROVAL', actorId, t);
      await this.outbox.publishFrom(school, t);
      return { school: toSchoolDto(school), manager };
    });
  }

  /** Main Admin rejects a PENDING Sub-School with a nonblank reason. Terminal. No manager link, no role, the user is untouched. */
  rejectSubSchool(schoolId: string, actorId: string, reason: unknown, tx?: TransactionContext): Promise<SchoolDto> {
    return this.inTransaction(tx, async (t) => {
      const school = await this.requireSchoolAdmin(schoolId, actorId, t);
      const previous = school.status;
      school.reject(actorId, reason, this.clock);
      await this.repository.update(school, t);
      await this.appendStatus(school.id, previous, school.status, actorId, school.snapshot.rejectionReason, t);
      await this.outbox.publishFrom(school, t);
      return toSchoolDto(school);
    });
  }

  // ---------------------------------------------------------------------------------------------- GPS and status

  /** Provisional: ACTIVE Main Admin only. Allowed only while the school is PENDING; the change is kept in the GPS history. */
  correctPendingGps(schoolId: string, gps: unknown, actorId: string, tx?: TransactionContext): Promise<SchoolDto> {
    return this.inTransaction(tx, async (t) => {
      const fix = parseGpsFix(gps);
      const school = await this.requireSchoolAdmin(schoolId, actorId, t);
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

  /** ACTIVE -> INACTIVE (explicit, audited). Provisional: ACTIVE Main Admin only. */
  deactivateSchool(schoolId: string, actorId: string, tx?: TransactionContext): Promise<SchoolDto> {
    return this.changeStatus(schoolId, actorId, (school) => school.deactivate(actorId, this.clock), tx);
  }

  /** INACTIVE -> ACTIVE (explicit, audited). Provisional: ACTIVE Main Admin only. */
  reactivateSchool(schoolId: string, actorId: string, tx?: TransactionContext): Promise<SchoolDto> {
    return this.changeStatus(schoolId, actorId, (school) => school.reactivate(actorId, this.clock), tx);
  }

  // ---------------------------------------------------------------------------------------------- managers

  /**
   * Main Admin explicitly assigns the School Manager of an ACTIVE school (used for Main Schools, and to replace a
   * manager after a revocation). At most one active manager per school. The SCHOOL_MANAGER role is assigned
   * through Module 09 only when the user does not hold it yet.
   */
  assignSchoolManager(input: { schoolId: string; userId: string; actorId: string }, tx?: TransactionContext): Promise<SchoolManagerAssignmentDto> {
    return this.inTransaction(tx, async (t) => {
      const school = await this.requireSchoolAdmin(input.schoolId, input.actorId, t);
      if (school.status !== 'ACTIVE') throw schoolError('SCHOOL_NOT_ACTIVE');
      await this.requireEligibleManager(input.userId, t);
      return this.linkManager(school.id, input.userId, 'MAIN_ADMIN_ASSIGNMENT', input.actorId, t);
    });
  }

  /**
   * Ends the school's active manager link (history kept). It does NOT revoke the user's SCHOOL_MANAGER role (they may
   * manage other schools; role cleanup is not defined for V1).
   */
  revokeSchoolManager(input: { schoolId: string; actorId: string }, tx?: TransactionContext): Promise<SchoolManagerAssignmentDto> {
    return this.inTransaction(tx, async (t) => {
      await this.requireSchoolAdmin(input.schoolId, input.actorId, t);
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
    type: 'MAIN' | 'SUB',
    parentSchoolId: string | null,
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
    // The school keeps its OWN address (any governorate/center/village of that country): the structured rules are unchanged
    // (Geography lookup: registered, ACTIVE nodes, each under its parent, village only under its center).
    const centerId = input.centerId ?? null;
    const villageId = input.villageId ?? null;
    const validated = await this.geography.validateHierarchy({ governorateId: input.governorateId, centerId, villageId }, {}, t);
    if (validated.country.id !== countryId) throw schoolError('SCHOOL_COUNTRY_MISMATCH');
    const code = await this.codes.allocate(t); // last: the sequence lock is held until this transaction ends
    const base = {
      name,
      code,
      organizationId,
      countryId,
      governorateId: input.governorateId,
      centerId,
      villageId,
      gps,
      createdBy,
      ...(applicantName ? { applicantName } : {}),
      clock: this.clock,
    };
    return type === 'MAIN' ? School.createMain(base) : School.requestSub({ ...base, parentSchoolId: parentSchoolId as string });
  }

  private async persistNew(school: School, actorId: string, t: TransactionContext): Promise<void> {
    await this.repository.insert(school, t);
    await this.appendStatus(school.id, null, school.status, actorId, null, t);
    await this.outbox.publishFrom(school, t);
  }

  private async changeStatus(schoolId: string, actorId: string, apply: (school: School) => void, tx?: TransactionContext): Promise<SchoolDto> {
    return this.inTransaction(tx, async (t) => {
      const school = await this.requireSchoolAdmin(schoolId, actorId, t);
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

  /**
   * Loads the school (locked) and requires the actor to administer ITS organization. A Main Admin of another organization is
   * refused exactly like anyone else: the role alone never grants access (SCHOOL_ACTION_NOT_ALLOWED). The role check runs first
   * so a caller without MAIN_ADMIN learns nothing about which schools exist.
   */
  private async requireSchoolAdmin(schoolId: string, actorId: string, t: TransactionContext): Promise<School> {
    if (!(await this.holdsMainAdminRole(actorId, t))) throw schoolError('SCHOOL_ACTION_NOT_ALLOWED');
    const school = await this.requireForUpdate(schoolId, t);
    if (!(await this.organizations.isOrganizationAdmin(actorId, school.organizationId, t))) throw schoolError('SCHOOL_ACTION_NOT_ALLOWED');
    return school;
  }

  /** The actor must be an existing, ACTIVE user with an active MAIN_ADMIN role AND an administrator link to this organization. */
  private async requireOrganizationAdmin(actorId: string, organizationId: string, t: TransactionContext): Promise<void> {
    if (!(await this.isOrganizationAdmin(actorId, organizationId, t))) throw schoolError('SCHOOL_ACTION_NOT_ALLOWED');
  }

  private async isOrganizationAdmin(actorId: string, organizationId: string, t?: TransactionContext): Promise<boolean> {
    return (await this.holdsMainAdminRole(actorId, t)) && (await this.organizations.isOrganizationAdmin(actorId, organizationId, t));
  }

  /** Organizations the caller administers (empty unless they are an ACTIVE user holding MAIN_ADMIN). */
  private async administeredOrganizationIds(actorId: string, t?: TransactionContext): Promise<string[]> {
    return (await this.holdsMainAdminRole(actorId, t)) ? this.organizations.listAdministeredOrganizationIds(actorId, t) : [];
  }

  private async holdsMainAdminRole(actorId: string, t?: TransactionContext): Promise<boolean> {
    const actor = typeof actorId === 'string' ? await this.identity.findById(actorId, t) : undefined;
    return !!actor && actor.isActive && (await this.roles.hasRole(actor.id, 'MAIN_ADMIN', t));
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
  private validateSubmission(input: SubmissionBase): { applicantName: string; phone: string } {
    const applicant = (typeof input.applicant === 'object' && input.applicant !== null ? input.applicant : {}) as Partial<ApplicantInput>;
    const applicantName = normalizeApplicantName(applicant.name);
    const phone = normalizePhone(applicant.phone as string); // IAM rules; throws the IAM validation error for a bad phone
    normalizeSchoolName(input.name);
    parseGpsFix(input.gps);
    return { applicantName, phone };
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
