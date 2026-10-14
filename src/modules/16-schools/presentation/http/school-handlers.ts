import type { PageResult } from '../../../00-shared-kernel/public';
import type { SchoolService } from '../../application/services/school-service';
import type { SchoolSortKey } from '../../application/ports/school-repository';
import type { SchoolStatus } from '../../domain/value-objects/school-status';
import type { SchoolType } from '../../domain/value-objects/school-type';
import { serializeApproval, serializeManager, serializeSchool, serializeSubmission } from './school-serializer';

export type SchoolHandlerService = Pick<
  SchoolService,
  | 'createMainSchool'
  | 'submitSubSchool'
  | 'listSchools'
  | 'getSchoolForActor'
  | 'approveSubSchool'
  | 'rejectSubSchool'
  | 'deactivateSchool'
  | 'reactivateSchool'
  | 'correctPendingGps'
  | 'assignSchoolManager'
  | 'revokeSchoolManager'
>;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const obj = (value: unknown): Json => (typeof value === 'object' && value !== null ? (value as Json) : {});

/**
 * Framework-free handlers behind the school routes: they map an already validated request to the application service
 * and the response data. They know nothing about Express; the router adds validation, authentication and the envelope.
 * `actorId` always comes from the verified access token (`req.auth.userId`), never from the body.
 */
export function createSchoolHandlers(getService: () => SchoolHandlerService) {
  return {
    /** Authenticated: the caller (from the token) must administer the organization. */
    createMainSchool: async (actorId: string, body: unknown) => {
      const school = obj(obj(body).school);
      return serializeSchool(
        await getService().createMainSchool({
          actorId,
          organizationId: obj(body).organizationId,
          name: school.name,
          countryId: school.countryId,
          governorateId: school.governorateId,
          centerId: school.centerId ?? null,
          villageId: school.villageId ?? null,
          gps: school.gps,
        }),
      );
    },

    submitSubSchool: async (body: unknown, authenticatedUserId?: string) => {
      const school = obj(obj(body).school);
      return serializeSubmission(
        await getService().submitSubSchool({
          applicant: obj(body).applicant,
          parentSchoolId: obj(body).parentSchoolId,
          name: school.name,
          countryId: school.countryId,
          governorateId: school.governorateId,
          centerId: school.centerId ?? null,
          villageId: school.villageId ?? null,
          gps: school.gps,
          ...(authenticatedUserId ? { authenticatedUserId } : {}),
        }),
      );
    },

    listSchools: async (
      actorId: string,
      query: { statuses?: readonly string[]; type?: string; sort: { key: string; direction: 'asc' | 'desc' }; page: { page: number; pageSize: number } },
    ): Promise<PageResult<ReturnType<typeof serializeSchool>>> => {
      const result = await getService().listSchools({
        actorId,
        ...(query.statuses ? { statuses: query.statuses as SchoolStatus[] } : {}),
        ...(query.type ? { type: query.type as SchoolType } : {}),
        sort: query.sort.key as SchoolSortKey,
        direction: query.sort.direction,
        page: query.page,
      });
      return { ...result, items: result.items.map(serializeSchool) };
    },

    getSchool: async (actorId: string, schoolId: string) => serializeSchool(await getService().getSchoolForActor(schoolId, actorId)),

    approve: async (actorId: string, schoolId: string) => serializeApproval(await getService().approveSubSchool(schoolId, actorId)),

    reject: async (actorId: string, schoolId: string, body: unknown) => serializeSchool(await getService().rejectSubSchool(schoolId, actorId, obj(body).reason)),

    deactivate: async (actorId: string, schoolId: string) => serializeSchool(await getService().deactivateSchool(schoolId, actorId)),

    reactivate: async (actorId: string, schoolId: string) => serializeSchool(await getService().reactivateSchool(schoolId, actorId)),

    correctGps: async (actorId: string, schoolId: string, body: unknown) => serializeSchool(await getService().correctPendingGps(schoolId, obj(body).gps, actorId)),

    assignManager: async (actorId: string, schoolId: string, body: unknown) =>
      serializeManager(await getService().assignSchoolManager({ schoolId, userId: obj(body).userId, actorId })),

    revokeManager: async (actorId: string, schoolId: string) => serializeManager(await getService().revokeSchoolManager({ schoolId, actorId })),
  };
}
