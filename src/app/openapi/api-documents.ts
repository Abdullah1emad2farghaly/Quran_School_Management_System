import { defaultMessageCatalog } from '../../modules/03-error-localization/public';
import { buildOpenApiDocument, type MessageLookup, type ModuleApiDoc, type OpenApiDocument } from '../../modules/04-validation-api/public';
import { authApiDoc } from '../../modules/10-sessions-jwt/public';
import { recoveryApiDoc } from '../../modules/11-otp-password-recovery/public';
import { organizationApiDoc, schoolApiDoc } from '../../modules/16-schools/public';
import { parentApiDoc } from '../../modules/17-parents/public';
import { teacherApiDoc } from '../../modules/18-teachers/public';
import { studentApiDoc } from '../../modules/19-students/public';
import { groupApiDoc } from '../../modules/20-groups/public';
import { scheduleApiDoc } from '../../modules/23-group-schedules/public';
import { classSessionApiDoc } from '../../modules/24-sessions/public';
import { quranApiDoc } from '../../modules/21-quran-structure/public';
import { healthApiDoc } from '../routes/health.openapi';
import { API_BASE_PATH } from '../routes';

export const API_TITLE = 'QSMS API';
export const API_VERSION = 'v1';

/**
 * EVERY module that exposes HTTP endpoints registers its contract here. The route-inventory test fails when a mounted route is
 * missing from (or an operation here is missing in) the real router, so a module cannot be completed without its documentation.
 */
export const API_MODULE_DOCS: readonly ModuleApiDoc[] = [healthApiDoc, authApiDoc, recoveryApiDoc, organizationApiDoc, schoolApiDoc, parentApiDoc, teacherApiDoc, studentApiDoc, groupApiDoc, quranApiDoc, scheduleApiDoc, classSessionApiDoc];

/** Assembles the served OpenAPI document. Error messages come from the real catalog (register the messages first). */
export function buildApiDocument(messages: MessageLookup = defaultMessageCatalog): OpenApiDocument {
  return buildOpenApiDocument({ modules: API_MODULE_DOCS, basePath: API_BASE_PATH, title: API_TITLE, version: API_VERSION, messages });
}
