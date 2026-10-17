import { SystemClock, buildPageResult, type Clock, type PageRequest, type PageResult, type TransactionContext, type UnitOfWork } from '../../../00-shared-kernel/public';
import { normalizePhone, type IdentityService } from '../../../08-identity-core/public';
import type { RoleService } from '../../../09-roles-permissions/public';
import { normalizeOrganizationName, type OrganizationDto, type OrganizationService } from '../../../13-organization-core/public';
import type { OrganizationAddressInput, UnifiedAddressLookup } from '../../../15-unified-address/public';
import { normalizeApplicantName } from '../../domain/value-objects/applicant-name';
import { ApplicantAccountResolver } from './applicant-account-resolver';
import type { ApplicantInput } from './school-service';

export interface RegisterOrganizationInput {
  readonly applicant: ApplicantInput;
  readonly organization: OrganizationAddressInput & { readonly name: unknown };
  /** Set only by the HTTP layer from a verified access token (see ApplicantAccountResolver). */
  readonly authenticatedUserId?: string;
}

export interface OrganizationRegistrationResult {
  readonly organization: OrganizationDto;
  readonly applicant: { readonly userId: string; readonly accountCreated: boolean };
}

export interface OrganizationRegistrationDeps {
  readonly organizations: Pick<OrganizationService, 'createOrganization' | 'assignOrganizationAdmin' | 'requireById' | 'isOrganizationAdmin' | 'listAdministeredOrganizationIds'>;
  readonly address: Pick<UnifiedAddressLookup, 'validateOrganizationAddress'>;
  readonly identity: Pick<IdentityService, 'findById' | 'createUser'>;
  readonly roles: Pick<RoleService, 'hasRole' | 'assignRole'>;
  readonly unitOfWork: UnitOfWork;
  readonly generateApplicantPassword?: () => string;
  readonly clock?: Clock;
}

/**
 * Organization registration: its own workflow, independent of any school (no main school is needed or created).
 * ONE transaction: validate the form (applicant, name, country and the organization's own address: registered governorate, free-text
 * center and village) -> resolve or create the applicant's account through IAM -> create the organization (ACTIVE; name unique
 * system-wide; country immutable) -> assign the applicant the ORGANIZATION_MANAGER role through Module 09 (history kept) -> link them
 * as manager of THAT organization only. MAIN_ADMIN (the platform administrator) is NEVER assigned here. Any failure rolls everything
 * back, including the new account.
 *
 * The new account's password is random and unknown: nobody can log in as the applicant until the phone's owner sets a password
 * through the OTP recovery flow (the existing verification), so the privileged role cannot be used by an unverified identity.
 * The role grants nothing outside the linked organization: the Authorization Engine checks the organization link, not the role.
 */
export class OrganizationRegistrationService {
  private readonly organizations: OrganizationRegistrationDeps['organizations'];
  private readonly address: OrganizationRegistrationDeps['address'];
  private readonly identity: OrganizationRegistrationDeps['identity'];
  private readonly roles: OrganizationRegistrationDeps['roles'];
  private readonly unitOfWork: UnitOfWork;
  private readonly applicants: ApplicantAccountResolver;
  readonly clock: Clock;

  constructor(deps: OrganizationRegistrationDeps) {
    this.organizations = deps.organizations;
    this.address = deps.address;
    this.identity = deps.identity;
    this.roles = deps.roles;
    this.unitOfWork = deps.unitOfWork;
    this.applicants = new ApplicantAccountResolver(deps.identity, deps.generateApplicantPassword);
    this.clock = deps.clock ?? new SystemClock();
  }

  registerOrganization(input: RegisterOrganizationInput, tx?: TransactionContext): Promise<OrganizationRegistrationResult> {
    return this.inTransaction(tx, async (t) => {
      // 1. Pure validation first: nothing is written when the form is wrong.
      const applicant = (typeof input.applicant === 'object' && input.applicant !== null ? input.applicant : {}) as Partial<ApplicantInput>;
      const applicantName = normalizeApplicantName(applicant.name);
      const phone = normalizePhone(applicant.phone as string);
      const organization = (typeof input.organization === 'object' && input.organization !== null ? input.organization : {}) as Partial<RegisterOrganizationInput['organization']>;
      const name = normalizeOrganizationName(organization.name as string);
      // 2. The organization's OWN address and country (separate from school and parent addresses).
      const address = await this.address.validateOrganizationAddress(
        { countryId: organization.countryId, governorateId: organization.governorateId, centerName: organization.centerName, villageName: organization.villageName },
        t,
      );
      // 3-5. Account, organization, scoped administrator.
      const resolved = await this.applicants.resolve(phone, input.authenticatedUserId, t);
      const created = await this.organizations.createOrganization({ name, ...address }, t);
      if (!(await this.roles.hasRole(resolved.userId, 'ORGANIZATION_MANAGER', t))) {
        await this.roles.assignRole({ userId: resolved.userId, roleCode: 'ORGANIZATION_MANAGER', assignedBy: null }, t);
      }
      await this.organizations.assignOrganizationAdmin({ organizationId: created.id, userId: resolved.userId, name: applicantName, assignedBy: null }, t);
      return { organization: created, applicant: resolved };
    });
  }

  /** The organizations the caller manages (ORGANIZATION_MANAGER role AND an organization link); nothing else. */
  async listOrganizationsForActor(actorId: string, page: PageRequest, tx?: TransactionContext): Promise<PageResult<OrganizationDto>> {
    const ids = (await this.holdsOrganizationManagerRole(actorId, tx)) ? await this.organizations.listAdministeredOrganizationIds(actorId, tx) : [];
    const slice = ids.slice((page.page - 1) * page.pageSize, page.page * page.pageSize);
    const items = await Promise.all(slice.map((id) => this.organizations.requireById(id, tx)));
    return buildPageResult(items, ids.length, page);
  }

  /** One organization (ORGANIZATION_NOT_FOUND when it does not exist). Who may read it is decided by the Authorization Engine at the route. */
  getOrganization(organizationId: string, tx?: TransactionContext): Promise<OrganizationDto> {
    return this.organizations.requireById(organizationId, tx);
  }

  private async holdsOrganizationManagerRole(actorId: string, tx?: TransactionContext): Promise<boolean> {
    const actor = typeof actorId === 'string' ? await this.identity.findById(actorId, tx) : undefined;
    return !!actor && actor.isActive && (await this.roles.hasRole(actor.id, 'ORGANIZATION_MANAGER', tx));
  }

  private inTransaction<T>(tx: TransactionContext | undefined, work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return tx ? work(tx) : this.unitOfWork.run(work);
  }
}
