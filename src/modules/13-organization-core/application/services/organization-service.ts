import { AppError, SystemClock, type Clock, type TransactionContext, type UnitOfWork } from '../../../00-shared-kernel/public';
import type { OutboxService } from '../../../06-domain-events-outbox/public';
import { Organization } from '../../domain/entities/organization';
import { organizationError } from '../../domain/errors/organization-errors';
import { formatOrganizationCode } from '../../domain/value-objects/organization-code';
import { normalizeOrganizationName } from '../../domain/value-objects/organization-name';
import { toOrganizationDto, type OrganizationDto } from '../dto/organization-dto';
import type { OrganizationRepository } from '../ports/organization-repository';

export interface OrganizationServiceDeps {
  readonly repository: OrganizationRepository;
  readonly unitOfWork: UnitOfWork;
  readonly outbox: OutboxService;
  readonly clock?: Clock;
}

export interface EnsureOrganizationResult {
  readonly organization: OrganizationDto;
  /** False when the organization already existed (nothing was changed and no event was written). */
  readonly created: boolean;
}

/**
 * Module 13 public contract. Read methods are for other modules (Geography, Schools...);
 * `ensureMainOrganization` is for the bootstrap CLI only: there is no HTTP endpoint and no delete.
 */
export class OrganizationService {
  private readonly repository: OrganizationRepository;
  private readonly unitOfWork: UnitOfWork;
  private readonly outbox: OutboxService;
  private readonly clock: Clock;

  constructor(deps: OrganizationServiceDeps) {
    this.repository = deps.repository;
    this.unitOfWork = deps.unitOfWork;
    this.outbox = deps.outbox;
    this.clock = deps.clock ?? new SystemClock();
  }

  /** The Main Organization, or undefined before the bootstrap has created it. */
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
      if (error instanceof AppError && error.code === 'ORGANIZATION_ALREADY_EXISTS') {
        const winner = await this.repository.findMain(tx);
        if (winner) return { organization: toOrganizationDto(winner), created: false };
      }
      throw error;
    }
  }

  private inTransaction<T>(tx: TransactionContext | undefined, work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return tx ? work(tx) : this.unitOfWork.run(work);
  }
}

/** What downstream modules should depend on (read-only). */
export type OrganizationLookup = Pick<OrganizationService, 'getMainOrganization' | 'requireMainOrganization' | 'findById'>;
