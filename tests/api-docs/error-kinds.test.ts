import type { OpenAPIV3 } from 'openapi-types';
import { beforeAll, describe, expect, it } from 'vitest';
import { HTTP_STATUS_BY_KIND, defaultMessageCatalog } from '../../src/modules/03-error-localization/public';
import { buildApiDocument } from '../../src/app/openapi/api-documents';
import { registerAllErrorMessages } from '../../src/app/bootstrap/register-error-messages';
import { identityError, IdentityErrorCodes } from '../../src/modules/08-identity-core/domain/errors/identity-errors';
import { roleError, RoleErrorCodes } from '../../src/modules/09-roles-permissions/domain/errors/role-errors';
import { sessionError, SessionErrorCodes } from '../../src/modules/10-sessions-jwt/domain/errors/session-errors';
import { recoveryError, RecoveryErrorCodes, rateLimitedError } from '../../src/modules/11-otp-password-recovery/domain/errors/recovery-errors';
import { organizationError, OrganizationErrorCodes } from '../../src/modules/13-organization-core/domain/errors/organization-errors';
import { geographyError, GeographyErrorCodes } from '../../src/modules/14-geography/domain/errors/geography-errors';
import { unifiedAddressError, UnifiedAddressErrorCodes } from '../../src/modules/15-unified-address/domain/errors/unified-address-errors';
import { schoolError, SchoolErrorCodes } from '../../src/modules/16-schools/domain/errors/school-errors';
import { parentError, ParentErrorCodes } from '../../src/modules/17-parents/domain/errors/parent-errors';
import { teacherError, TeacherErrorCodes } from '../../src/modules/18-teachers/domain/errors/teacher-errors';
import { studentError, StudentErrorCodes } from '../../src/modules/19-students/domain/errors/student-errors';
import { groupError, GroupErrorCodes } from '../../src/modules/20-groups/domain/errors/group-errors';
import { quranError, QuranErrorCodes } from '../../src/modules/21-quran-structure/domain/errors/quran-errors';
import { scheduleError, ScheduleErrorCodes } from '../../src/modules/23-group-schedules/public';
import { classSessionError, ClassSessionErrorCodes } from '../../src/modules/24-sessions/public';
import { smartGuardError, SmartGuardErrorCodes } from '../../src/modules/25-smart-guard/public';
import { attendanceError, AttendanceErrorCodes } from '../../src/modules/26-attendance/public';
import { operationsOf } from './support/lint';

type Factory = (code: never) => { kind: keyof typeof HTTP_STATUS_BY_KIND };
const SOURCES: ReadonlyArray<readonly [Record<string, string>, Factory]> = [
  [IdentityErrorCodes, identityError as Factory],
  [RoleErrorCodes, roleError as Factory],
  [SessionErrorCodes, sessionError as Factory],
  [RecoveryErrorCodes, recoveryError as Factory],
  [OrganizationErrorCodes, organizationError as Factory],
  [GeographyErrorCodes, geographyError as Factory],
  [UnifiedAddressErrorCodes, ((code: never) => unifiedAddressError(code)) as Factory],
  [SchoolErrorCodes, schoolError as Factory],
  [ParentErrorCodes, parentError as Factory],
  [TeacherErrorCodes, teacherError as Factory],
  [StudentErrorCodes, studentError as Factory],
  [GroupErrorCodes, groupError as Factory],
  [QuranErrorCodes, quranError as Factory],
  [ScheduleErrorCodes, scheduleError as Factory],
  [ClassSessionErrorCodes, classSessionError as Factory],
  [SmartGuardErrorCodes, smartGuardError as Factory],
  [AttendanceErrorCodes, attendanceError as Factory],
];

/** The status each module-owned code REALLY answers: taken from the module's own error factory, never retyped. */
function realStatus(code: string): number | undefined {
  for (const [codes, factory] of SOURCES) {
    if (Object.values(codes).includes(code)) return HTTP_STATUS_BY_KIND[factory(code as never).kind];
  }
  if (code === 'RATE_LIMITED') return HTTP_STATUS_BY_KIND[rateLimitedError(1).kind];
  return undefined;
}

/** The application-wide standard codes (docs/API-STANDARDS.md): answered by the shared error handling, not by one module. */
const STANDARD: Readonly<Record<string, number>> = { VALIDATION_FAILED: 400, INVALID_JSON: 400, PAYLOAD_TOO_LARGE: 413, INTERNAL_ERROR: 500, AUTHENTICATION_REQUIRED: 401, ACCESS_DENIED: 403 };

describe('documented error codes agree with the real errors', () => {
  let rows: Array<{ where: string; status: number; code: string }>;

  beforeAll(() => {
    registerAllErrorMessages();
    rows = [];
    for (const o of operationsOf(buildApiDocument())) {
      for (const [status, response] of Object.entries(o.operation.responses as Record<string, OpenAPIV3.ResponseObject>)) {
        const examples = response.content?.['application/json']?.examples ?? {};
        for (const example of Object.values(examples) as OpenAPIV3.ExampleObject[]) {
          const code = (example.value as { error?: { code?: string } } | undefined)?.error?.code;
          if (code) rows.push({ where: `${o.method.toUpperCase()} ${o.path}`, status: Number(status), code });
        }
      }
    }
  });

  it('collects the documented errors', () => {
    expect(rows.length).toBeGreaterThan(100);
  });

  it('every documented code is registered in the message catalog (Arabic and English)', () => {
    for (const r of rows) {
      for (const locale of ['ar', 'en'] as const) {
        expect(defaultMessageCatalog.has?.(r.code) ?? defaultMessageCatalog.message(r.code, locale), `${r.where}: ${r.code}`).toBeTruthy();
      }
    }
  });

  it('every documented (status, code) pair is the status the real error kind maps to', () => {
    const wrong: string[] = [];
    for (const r of rows) {
      const actual = STANDARD[r.code] ?? realStatus(r.code);
      if (actual === undefined) wrong.push(`${r.where}: code ${r.code} is not defined by any module error factory`);
      else if (actual !== r.status) wrong.push(`${r.where}: ${r.code} is documented as ${r.status} but the real error answers ${actual}`);
    }
    expect(wrong).toEqual([]);
  });
});
