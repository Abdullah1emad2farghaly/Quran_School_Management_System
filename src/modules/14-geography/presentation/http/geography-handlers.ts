import { organizationError } from '../../../13-organization-core/public';
import { geographyError } from '../../domain/errors/geography-errors';
import type { GeographyLookup } from '../../application/services/geography-service';

/**
 * The ONLY organization data Module 14 needs for the registration lookup (Module 13's read-only contract): the organization when it may
 * receive a school submission (ACTIVE with a country), otherwise `undefined`. The country comes from the database, never from the client.
 */
export interface SubmissionOrganizationLookup {
  findSubmissionEligibleById(id: string): Promise<{ readonly id: string; readonly name: string; readonly countryId: string } | undefined>;
}

/** What the public registration form receives for every item. Nothing else is ever exposed (no code, status, parent id or level). */
export interface GeographyLookupItem {
  readonly id: string;
  readonly name: string;
}

export interface GovernorateLookupQuery {
  readonly countryId?: string;
  readonly organizationId?: string;
}

const toItem = ({ id, name }: { readonly id: string; readonly name: string }): GeographyLookupItem => ({ id, name });

/** Framework-free handlers behind /geography (public, read-only registration lookups). */
export function createGeographyHandlers(getGeography: () => Pick<GeographyLookup, 'getCountry' | 'listActiveCountries' | 'listActiveGovernorates'>, getOrganizations: () => SubmissionOrganizationLookup) {
  return {
    listCountries: async (): Promise<GeographyLookupItem[]> => (await getGeography().listActiveCountries()).map(toItem),

    /**
     * Exactly one of `countryId` / `organizationId` (the route validates that). With `organizationId` the country is DERIVED from that organization
     * (it must be eligible for school submissions, otherwise ORGANIZATION_NOT_FOUND: an ineligible organization is not revealed). With `countryId` the
     * country must exist (GEOGRAPHY_NODE_NOT_FOUND) and be ACTIVE (GEOGRAPHY_NODE_INACTIVE).
     */
    listGovernorates: async (query: GovernorateLookupQuery): Promise<GeographyLookupItem[]> => {
      const geography = getGeography();
      let countryId: string;
      if (query.organizationId !== undefined) {
        const organization = await getOrganizations().findSubmissionEligibleById(query.organizationId);
        if (!organization) throw organizationError('ORGANIZATION_NOT_FOUND');
        countryId = organization.countryId;
      } else {
        countryId = query.countryId as string;
      }
      const country = await geography.getCountry(countryId);
      if (!country) throw geographyError('GEOGRAPHY_NODE_NOT_FOUND');
      if (country.status !== 'ACTIVE') throw geographyError('GEOGRAPHY_NODE_INACTIVE');
      return (await geography.listActiveGovernorates(countryId)).map(toItem);
    },
  };
}
