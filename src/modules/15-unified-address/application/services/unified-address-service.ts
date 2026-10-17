import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { GeographyLookup } from '../../../14-geography/public';
import type { OrganizationLookup } from '../../../13-organization-core/public';
import { unifiedAddressError } from '../../domain/errors/unified-address-errors';
import { parseRawParentAddress } from '../../domain/services/raw-parent-address-parser';
import { normalizeAddressText } from '../../domain/value-objects/address-text';
import type { ParentAddress, StoredParentAddress } from '../../domain/value-objects/parent-address';
import type { OrganizationAddress, OrganizationAddressInput, ParentAddressInput, SchoolAddressInput } from '../dto/parent-address-input';

export interface UnifiedAddressServiceDeps {
  readonly geography: Pick<GeographyLookup, 'getGovernorate' | 'listGovernorates' | 'validateHierarchy'>;
  readonly organizations: Pick<OrganizationLookup, 'requireOrganizationCountryId'>;
}

/**
 * Module 15 public contract: reusable Parent Address normalization and validation. It owns NO table, writes nothing and
 * emits no event; persistence and history of a Parent's address belong to the Parents module (17).
 * Parent, School and Organization addresses share one contract: registered governorate, free-text center/city and village.
 */
export class UnifiedAddressService {
  private readonly geography: UnifiedAddressServiceDeps['geography'];
  private readonly organizations: UnifiedAddressServiceDeps['organizations'];

  constructor(deps: UnifiedAddressServiceDeps) {
    this.geography = deps.geography;
    this.organizations = deps.organizations;
  }

  /**
   * Validates a structured Parent Address for creating or changing it.
   * - the Governorate must be a registered, ACTIVE Governorate of the country of `input.organizationId` (the country is
   *   derived from that organization, never entered; ORGANIZATION_NOT_FOUND / ORGANIZATION_COUNTRY_NOT_SET otherwise);
   * - Center/City and Village are free text: normalized, never looked up, accepted even if unregistered;
   * - a Village without a nonblank Center/City is rejected.
   */
  async validateParentAddress(input: ParentAddressInput, tx?: TransactionContext): Promise<ParentAddress> {
    if (typeof input !== 'object' || input === null) throw unifiedAddressError('INVALID_PARENT_ADDRESS');
    const { governorateId } = input;
    if (typeof governorateId !== 'string' || governorateId.trim() === '') throw unifiedAddressError('INVALID_PARENT_ADDRESS', 'governorate');
    const centerName = normalizeAddressText(input.centerName, 'center');
    const villageName = normalizeAddressText(input.villageName, 'village');
    if (villageName !== null && centerName === null) throw unifiedAddressError('INVALID_PARENT_ADDRESS', 'village');

    if (typeof input.organizationId !== 'string' || input.organizationId.trim() === '') throw unifiedAddressError('INVALID_PARENT_ADDRESS', 'organization');
    const countryId = await this.organizations.requireOrganizationCountryId(input.organizationId, tx);
    const governorate = await this.geography.getGovernorate(governorateId, tx);
    if (!governorate) throw unifiedAddressError('PARENT_ADDRESS_GOVERNORATE_NOT_FOUND', 'governorate');
    if (governorate.parentId !== countryId) throw unifiedAddressError('PARENT_ADDRESS_COUNTRY_MISMATCH', 'governorate');
    if (governorate.status !== 'ACTIVE') throw unifiedAddressError('PARENT_ADDRESS_GOVERNORATE_INACTIVE', 'governorate');
    return { governorateId: governorate.id, governorateName: governorate.name, centerName, villageName };
  }

  /**
   * Same validation for raw text (`Governorate / Center or City / Village`, e.g. an Excel cell): the text is parsed
   * (`/` only, empty components rejected), the first component is matched EXACTLY (after NFC and whitespace
   * normalization; no Arabic letter folding) against the registered Governorates of the organization's country, then
   * the result goes through `validateParentAddress`, so both entry points behave identically.
   */
  async validateRawParentAddress(raw: unknown, organizationId: unknown, tx?: TransactionContext): Promise<ParentAddress> {
    const parts = parseRawParentAddress(raw);
    if (typeof organizationId !== 'string' || organizationId.trim() === '') throw unifiedAddressError('INVALID_PARENT_ADDRESS', 'organization');
    const countryId = await this.organizations.requireOrganizationCountryId(organizationId, tx);
    const governorates = await this.geography.listGovernorates(countryId, tx);
    const match = governorates.find((g) => g.name === parts.governorateName);
    if (!match) throw unifiedAddressError('PARENT_ADDRESS_GOVERNORATE_NOT_FOUND', 'governorate');
    return this.validateParentAddress({ organizationId, governorateId: match.id, centerName: parts.centerName, villageName: parts.villageName }, tx);
  }

  /**
   * A SCHOOL's address: exactly the Parent Address rules (registered, ACTIVE governorate of the organization's country; center/city and
   * village free text, never looked up; a village needs a center). The country is derived from `input.organizationId`, never entered.
   * The error codes are the shared address codes (their names say "parent" for historical reasons; they apply to every address
   * that inherits its country from an organization).
   */
  validateSchoolAddress(input: SchoolAddressInput, tx?: TransactionContext): Promise<ParentAddress> {
    return this.validateParentAddress(input, tx);
  }

  /**
   * The ORGANIZATION's own address (the country is CHOSEN here, so it cannot be derived): the country and the governorate are
   * required, the governorate must be a registered, ACTIVE governorate of that country (Geography `validateHierarchy`, which also
   * checks the country is registered and ACTIVE); center/city and village are FREE TEXT with the Parent Address normalization
   * (NFC, whitespace, at most 200 characters, a village only under a center). No registered center or village is ever required.
   * Geography errors: INVALID_GEOGRAPHY_HIERARCHY, GEOGRAPHY_NODE_NOT_FOUND, GEOGRAPHY_NODE_INACTIVE.
   */
  async validateOrganizationAddress(input: OrganizationAddressInput, tx?: TransactionContext): Promise<OrganizationAddress> {
    if (typeof input !== 'object' || input === null) throw unifiedAddressError('INVALID_PARENT_ADDRESS');
    if (typeof input.countryId !== 'string' || input.countryId.trim() === '') throw unifiedAddressError('INVALID_PARENT_ADDRESS', 'country');
    if (typeof input.governorateId !== 'string' || input.governorateId.trim() === '') throw unifiedAddressError('INVALID_PARENT_ADDRESS', 'governorate');
    const centerName = normalizeAddressText(input.centerName, 'center');
    const villageName = normalizeAddressText(input.villageName, 'village');
    if (villageName !== null && centerName === null) throw unifiedAddressError('INVALID_PARENT_ADDRESS', 'village');
    const validated = await this.geography.validateHierarchy({ governorateId: input.governorateId, centerId: null, villageId: null }, {}, tx);
    if (validated.country.id !== input.countryId) throw unifiedAddressError('ORGANIZATION_ADDRESS_COUNTRY_MISMATCH', 'governorate');
    return { countryId: validated.country.id, governorateId: validated.governorate.id, centerName, villageName };
  }

  /**
   * Reads a STORED address (current or history row). It does not re-validate: an address stays readable even if its
   * Governorate later becomes inactive. A history row's `governorateName` snapshot is used as is (no lookup), so a later
   * rename of the Governorate never changes how an old address reads; without a snapshot the current name is read.
   */
  async describeStoredParentAddress(stored: StoredParentAddress, tx?: TransactionContext): Promise<ParentAddress> {
    let governorateName = stored.governorateName ?? null;
    if (governorateName === null) {
      const governorate = await this.geography.getGovernorate(stored.governorateId, tx);
      if (!governorate) throw unifiedAddressError('PARENT_ADDRESS_GOVERNORATE_NOT_FOUND', 'governorate');
      governorateName = governorate.name;
    }
    return {
      governorateId: stored.governorateId,
      governorateName,
      centerName: stored.centerName ?? null,
      villageName: stored.villageName ?? null,
    };
  }
}

/** What downstream modules (Parents 17, Students 19, Excel Import 36) should depend on. */
export type UnifiedAddressLookup = Pick<
  UnifiedAddressService,
  'validateParentAddress' | 'validateSchoolAddress' | 'validateRawParentAddress' | 'describeStoredParentAddress' | 'validateOrganizationAddress'
>;
