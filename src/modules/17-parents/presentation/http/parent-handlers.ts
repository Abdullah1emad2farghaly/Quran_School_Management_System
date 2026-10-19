import type { PageRequest, PageResult } from '../../../00-shared-kernel/public';
import type { ParentAddressSubmission, ParentService } from '../../application/services/parent-service';
import type { ParentSortKey } from '../../application/ports/parent-repository';
import { parentError } from '../../domain/errors/parent-errors';
import { serializeParent, serializeParentSchoolLink } from './parent-serializer';

export type ParentHandlerService = Pick<ParentService, 'registerParent' | 'getParent' | 'getOwnProfile' | 'listParentsOfSchool' | 'updateParent' | 'removeSchoolLink'>;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const obj = (value: unknown): Json => (typeof value === 'object' && value !== null ? (value as Json) : {});

/**
 * The address of a request body: `address` (the raw `Governorate / Center or City / Village` text) XOR `addressFields`
 * (`{ governorateId, centerName?, villageName? }`). Both at once is ambiguous and refused; none yields `undefined`.
 */
function addressOf(body: Json): ParentAddressSubmission | undefined {
  const hasText = body.address !== undefined && body.address !== null;
  const hasFields = body.addressFields !== undefined && body.addressFields !== null;
  if (hasText && hasFields) throw parentError('PARENT_ADDRESS_REQUIRED');
  if (hasText) return { kind: 'raw', text: body.address };
  if (hasFields) {
    const f = obj(body.addressFields);
    return { kind: 'structured', governorateId: f.governorateId, centerName: f.centerName, villageName: f.villageName };
  }
  return undefined;
}

/**
 * Framework-free handlers behind the parent routes: they map an already validated request to the application service and the response
 * data. `actorId` / `userId` always come from the verified access token (`req.auth.userId`), never from the body.
 */
export function createParentHandlers(getService: () => ParentHandlerService) {
  return {
    /** The actor was already authorized as the manager of `body.schoolId` by the Authorization Engine. */
    createParent: async (actorId: string, body: unknown) => {
      const b = obj(body);
      const result = await getService().registerParent({ schoolId: b.schoolId, name: b.name, phone: b.phone, address: addressOf(b) }, actorId);
      return { parent: serializeParent(result.parent), link: serializeParentSchoolLink(result.link), accountCreated: result.accountCreated };
    },

    getOwnProfile: async (userId: string) => serializeParent(await getService().getOwnProfile(userId)),

    getParent: async (parentId: string) => serializeParent(await getService().getParent(parentId)),

    listParentsOfSchool: async (input: { schoolId: string; sort: { key: string; direction: 'asc' | 'desc' }; page: PageRequest }): Promise<PageResult<ReturnType<typeof serializeParent>>> => {
      const page = await getService().listParentsOfSchool({ schoolId: input.schoolId, sort: input.sort.key as ParentSortKey, direction: input.sort.direction, page: input.page });
      return { ...page, items: page.items.map(serializeParent) };
    },

    updateParent: async (parentId: string, actorId: string, body: unknown) => {
      const b = obj(body);
      const address = addressOf(b);
      return serializeParent(await getService().updateParent(parentId, { ...(b.name !== undefined ? { name: b.name } : {}), ...(address ? { address } : {}) }, actorId));
    },

    removeSchoolLink: async (parentId: string, schoolId: string, actorId: string) =>
      serializeParentSchoolLink(await getService().removeSchoolLink(parentId, schoolId, actorId)),
  };
}
