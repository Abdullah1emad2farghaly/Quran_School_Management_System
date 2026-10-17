import { AppError, SystemClock, isUuid, type Clock, type TransactionContext, type UnitOfWork } from '../../../00-shared-kernel/public';
import type { OutboxService } from '../../../06-domain-events-outbox/public';
import { Organization } from '../../domain/entities/organization';
import { OrganizationAdminAssignment } from '../../domain/entities/organization-admin-assignment';
import { organizationError } from '../../domain/errors/organization-errors';
import { formatOrganizationCode } from '../../domain/value-objects/organization-code';
import { normalizeOrganizationName } from '../../domain/value-objects/organization-name';
import { toOrganizationDto, type OrganizationDto } from '../dto/organization-dto';
import type { OrganizationAdminRepository } from '../ports/organization-admin-repository';
import type { OrganizationRepository } from '../ports/organization-repository';

export interface OrganizationServiceDeps {
  readonly repository: OrganizationRepository;
  /** Needed by the administrator-link operations (`assignOrganizationAdmin`, `isOrganizationAdmin`...). */
  readonly admins?: OrganizationAdminRepository;
  readonly unitOfWork: UnitOfWork;
  readonly outbox: OutboxService;
  readonly clock?: Clock;
}

export interface CreateOrganizationInput {
  readonly name: unknown;
  readonly countryId: unknown;
  readonly governorateId: unknown;
  /** Free text (normalized by the caller with the Module 15 rules). */
  readonly centerName?: unknown;
  readonly villageName?: unknown;
}

export interface AssignOrganizationCountryResult {
  readonly organization: OrganizationDto;
  /** False when the same country was already assigned (nothing was changed and no event was written). */
  readonly changed: boolean;
}

export interface EnsureOrganizationResult {
  readonly organization: OrganizationDto;
  /** False when the organization already existed (nothing was changed and no event was written). */
  readonly created: boolean;
}

/**
 * Module 13 public contract: many organizations, each with a required country and its own address, and the administrator links
 * (organization scope of MAIN_ADMIN). Read methods are for other modules (Unified Address, Schools...). `ensureMainOrganization`
 * and `assignMainOrganizationCountry` are for the bootstrap CLI only. No delete. The HTTP endpoints that register an
 * organization live in Module 16 (they need IAM, roles and Geography, which are higher-numbered modules).
 */
export class OrganizationService {
  private readonly repository: OrganizationRepository;
  private readonly admins: OrganizationAdminRepository | undefined;
  private readonly unitOfWork: UnitOfWork;
  private readonly outbox: OutboxService;
  private readonly clock: Clock;

  constructor(deps: OrganizationServiceDeps) {
    this.repository = deps.repository;
    this.admins = deps.admins;
    this.unitOfWork = deps.unitOfWork;
    this.outbox = deps.outbox;
    this.clock = deps.clock ?? new SystemClock();
  }

  // ------------------------------------------------------------------------------------------- organizations (many)

  /** Throws ORGANIZATION_NOT_FOUND. */
  async requireById(id: string, tx?: TransactionContext): Promise<OrganizationDto> {
    const organization = await this.findById(id, tx);
    if (!organization) throw organizationError('ORGANIZATION_NOT_FOUND');
    return organization;
  }

  /** The country of THAT organization (`countries.id`). ORGANIZATION_NOT_FOUND / ORGANIZATION_COUNTRY_NOT_SET (fails closed). */
  async requireOrganizationCountryId(organizationId: string, tx?: TransactionContext): Promise<string> {
    const organization = await this.requireById(organizationId, tx);
    if (organization.countryId === null) throw organizationError('ORGANIZATION_COUNTRY_NOT_SET');
    return organization.countryId;
  }

  /**
   * Creates an organization (ACTIVE) with its required country and its own address. Independent of schools (no main school is
   * needed or created). The name must be unique across the whole system: checked here and guaranteed by the database unique
   * index (a concurrent duplicate loses with ORGANIZATION_NAME_ALREADY_EXISTS). The CALLER must already have validated that the
   * governorate, center and village exist and belong to this country (Geography); the database foreign keys are the final guard.
   * Runs in the caller's transaction (or its own); the code comes from the locked sequence, so there are no duplicates or gaps.
   */
  createOrganization(input: CreateOrganizationInput, tx?: TransactionContext): Promise<OrganizationDto> {
    return this.inTransaction(tx, async (t) => {
      const code = formatOrganizationCode(await this.repository.nextCodeSequence(t));
      const organization = Organization.register({
        name: normalizeOrganizationName(input.name as string),
        code,
        countryId: input.countryId,
        governorateId: input.governorateId,
        centerName: input.centerName,
        villageName: input.villageName,
        clock: this.clock,
      });
      await this.repository.insert(organization, t);
      await this.outbox.publishFrom(organization, t);
      return toOrganizationDto(organization);
    });
  }

  // ------------------------------------------------------------------------------------------- organization scope of MAIN_ADMIN

  /**
   * Links `userId` as an administrator of `organizationId` (the organization scope of the MAIN_ADMIN role; the role itself is
   * assigned through Module 09 by the caller). Idempotent: an existing active link is returned unchanged (no event).
   * `assignedBy` is null when the administrator registered the organization themselves.
   */
  assignOrganizationAdmin(
    input: { organizationId: string; userId: string; name?: string | null; assignedBy: string | null },
    tx?: TransactionContext,
  ): Promise<{ assignmentId: string; created: boolean }> {
    return this.inTransaction(tx, async (t) => {
      const admins = this.requireAdmins();
      if (!(await this.repository.findById(input.organizationId, t))) throw organizationError('ORGANIZATION_NOT_FOUND');
      const existing = await admins.findActive(input.userId, input.organizationId, t);
      if (existing) return { assignmentId: existing.snapshot.id, created: false };
      const assignment = OrganizationAdminAssignment.assign({
        organizationId: input.organizationId,
        userId: input.userId,
        name: input.name ?? null,
        assignedBy: input.assignedBy,
        clock: this.clock,
      });
      await admins.insert(assignment, t);
      await this.outbox.publishFrom(assignment, t);
      return { assignmentId: assignment.snapshot.id, created: true };
    });
  }

  /** True only while `userId` has an ACTIVE administrator link to exactly this organization. The role alone is not enough. */
  async isOrganizationAdmin(userId: string, organizationId: string, tx?: TransactionContext): Promise<boolean> {
    return !!(await this.requireAdmins().findActive(userId, organizationId, tx));
  }

  listAdministeredOrganizationIds(userId: string, tx?: TransactionContext): Promise<string[]> {
    return this.requireAdmins().listActiveOrganizationIdsByUser(userId, tx);
  }

  private requireAdmins(): OrganizationAdminRepository {
    if (!this.admins) throw new Error('OrganizationService: the administrator repository is not configured');
    return this.admins;
  }

  // ------------------------------------------------------------------------------------------- bootstrap (CLI only)

  /** The first organization (created by the bootstrap CLI), or undefined. Kept for the bootstrap commands only. */
  async getMainOrganization(tx?: TransactionContext): Promise<OrganizationDto | undefined> {
    const organization = await this.repository.findMain(tx);
    return organization ? toOrganizationDto(organization) : undefined;
  }

  /** Throws ORGANIZATION_NOT_FOUND. */
  async requireMainOrganization(tx?: TransactionContext): Promise<OrganizationDto> {
    const organization = await this.getMainOrganization(tx);
    if (!organization) throw organizationError('ORGANIZATION_NOT_FOUND');
    return organization;
  }

  /**
   * The primary key of the Main Organization's country (`countries.id`). Throws ORGANIZATION_NOT_FOUND, or
   * ORGANIZATION_COUNTRY_NOT_SET while no country has been assigned (country-dependent rules fail closed).
   */
  async requireMainOrganizationCountryId(tx?: TransactionContext): Promise<string> {
    const organization = await this.requireMainOrganization(tx);
    if (organization.countryId === null) throw organizationError('ORGANIZATION_COUNTRY_NOT_SET');
    return organization.countryId;
  }

  async findById(id: string, tx?: TransactionContext): Promise<OrganizationDto | undefined> {
    const organization = await this.repository.findById(id, tx);
    return organization ? toOrganizationDto(organization) : undefined;
  }

  /**
   * Idempotent creation of the Main Organization. If one exists it is returned UNCHANGED (even if `name` differs):
   * no second organization, no duplicate event. Otherwise it is created ACTIVE with the next code and its
   * OrganizationCreated event in the same transaction. A concurrent creator that loses the database race is
   * answered with the winner's row (the loser's transaction, including its event, is rolled back).
   */
  async ensureMainOrganization(name: string, tx?: TransactionContext): Promise<EnsureOrganizationResult> {
    const normalized = normalizeOrganizationName(name); // invalid input is rejected before anything is read or written

    const existing = await this.repository.findMain(tx);
    if (existing) return { organization: toOrganizationDto(existing), created: false };

    try {
      const organization = await this.inTransaction(tx, async (t) => {
        const code = formatOrganizationCode(await this.repository.nextCodeSequence(t));
        const created = Organization.create({ name: normalized, code, clock: this.clock });
        await this.repository.insert(created, t);
        await this.outbox.publishFrom(created, t);
        return created;
      });
      return { organization: toOrganizationDto(organization), created: true };
    } catch (error) {
      if (error instanceof AppError && (error.code === 'ORGANIZATION_ALREADY_EXISTS' || error.code === 'ORGANIZATION_NAME_ALREADY_EXISTS')) {
        const winner = await this.repository.findMain(tx);
        if (winner) return { organization: toOrganizationDto(winner), created: false };
      }
      throw error;
    }
  }

  /**
   * For the bootstrap CLI only (no HTTP endpoint). Assigns the country of the Main Organization, ONCE (immutable in V1).
   * `countryId` is the primary key (UUID) of the countries row, never its code. One transaction: the organization row
   * is locked, the rule is applied by the domain, the set-once UPDATE (`WHERE country_id IS NULL`) runs and the
   * `OrganizationCountryAssigned` event is written. The same country again is an idempotent no-op (no event);
   * a different country is rejected with ORGANIZATION_COUNTRY_ALREADY_SET. Direct database updates made outside
   * the application are not prevented by this rule.
   */
  async assignMainOrganizationCountry(countryId: unknown, tx?: TransactionContext): Promise<AssignOrganizationCountryResult> {
    if (!isUuid(countryId)) throw organizationError('ORGANIZATION_COUNTRY_INVALID'); // rejected before anything is read or written
    return this.inTransaction(tx, async (t) => {
      const organization = await this.repository.findMainForUpdate(t);
      if (!organization) throw organizationError('ORGANIZATION_NOT_FOUND');
      if (!organization.assignCountry(countryId, this.clock)) return { organization: toOrganizationDto(organization), changed: false };
      const updated = await this.repository.assignCountryIfUnset(organization.id, countryId, organization.updatedAt, t);
      if (!updated) throw organizationError('ORGANIZATION_COUNTRY_ALREADY_SET');
      await this.outbox.publishFrom(organization, t);
      return { organization: toOrganizationDto(organization), changed: true };
    });
  }

  private inTransaction<T>(tx: TransactionContext | undefined, work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return tx ? work(tx) : this.unitOfWork.run(work);
  }
}

/** What downstream modules should depend on (read-only). */
export type OrganizationLookup = Pick<
  OrganizationService,
  | 'findById'
  | 'requireById'
  | 'requireOrganizationCountryId'
  | 'isOrganizationAdmin'
  | 'listAdministeredOrganizationIds'
  | 'getMainOrganization'
  | 'requireMainOrganization'
  | 'requireMainOrganizationCountryId'
>;
