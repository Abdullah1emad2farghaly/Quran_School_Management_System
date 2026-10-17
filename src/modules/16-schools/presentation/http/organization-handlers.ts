import type { PageResult } from '../../../00-shared-kernel/public';
import type { OrganizationRegistrationService } from '../../application/services/organization-registration-service';
import { serializeOrganization, serializeOrganizationRegistration } from './school-serializer';

export type OrganizationHandlerService = Pick<OrganizationRegistrationService, 'registerOrganization' | 'listOrganizationsForActor' | 'getOrganization'>;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const obj = (value: unknown): Json => (typeof value === 'object' && value !== null ? (value as Json) : {});

/** Framework-free handlers behind /organizations. The actor and `authenticatedUserId` come only from the verified token. */
export function createOrganizationHandlers(getService: () => OrganizationHandlerService) {
  return {
    register: async (body: unknown, authenticatedUserId?: string) => {
      const organization = obj(obj(body).organization);
      return serializeOrganizationRegistration(
        await getService().registerOrganization({
          applicant: obj(body).applicant,
          organization: {
            name: organization.name,
            countryId: organization.countryId,
            governorateId: organization.governorateId,
            centerName: organization.centerName ?? null,
            villageName: organization.villageName ?? null,
          },
          ...(authenticatedUserId ? { authenticatedUserId } : {}),
        }),
      );
    },

    list: async (actorId: string, page: { page: number; pageSize: number }): Promise<PageResult<ReturnType<typeof serializeOrganization>>> => {
      const result = await getService().listOrganizationsForActor(actorId, page);
      return { ...result, items: result.items.map(serializeOrganization) };
    },

    get: async (organizationId: string) => serializeOrganization(await getService().getOrganization(organizationId)),
  };
}
