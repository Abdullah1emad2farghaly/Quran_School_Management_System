import type { AuthorizationPolicyRegistry, AuthorizationResolvers } from '../../../12-authorization-engine/public';
import type { SchoolLookup } from '../../../16-schools/public';
import type { ImportPreviewLookup } from './excel-import-service';

/** Permissions of the Excel Import resource (registered ONLY through the shared Authorization Engine). */
export const ImportPermissions = {
  /** Download the Arabic or English template (no data involved). */
  DOWNLOAD_TEMPLATE: 'excel-import.template.download',
  /** Upload a file and get its preview, into a school the caller manages. */
  CREATE_PREVIEW: 'excel-import.preview.create',
  READ_PREVIEW: 'excel-import.preview.read',
  CONFIRM: 'excel-import.preview.confirm',
  CANCEL: 'excel-import.preview.cancel',
} as const;

/** Scope target type of a preview (the SCHOOL target type belongs to Module 16 and its resolver is reused as is). */
export const IMPORT_PREVIEW_TARGET_TYPE = 'EXCEL_IMPORT_PREVIEW';

export interface ImportAuthorizationDeps {
  readonly policies: Pick<AuthorizationPolicyRegistry, 'register'>;
  readonly resolvers: Pick<AuthorizationResolvers, 'registerScopeResolver'>;
  readonly previews: ImportPreviewLookup;
  readonly schools: Pick<SchoolLookup, 'isSchoolManager'>;
}

/**
 * Module 36 registers what it owns (approved 2026-11-10; anything not listed stays denied):
 *   - SCHOOL_MANAGER only: download the templates, upload into a school THEY manage (scope target SCHOOL, resolved from server data), and read,
 *     confirm or cancel THEIR OWN previews (scope target EXCEL_IMPORT_PREVIEW: the preview must have been created by the caller AND the caller
 *     must still be the active manager of the preview's school).
 *   - PARENT, TEACHER, ORGANIZATION_MANAGER, MAIN_ADMIN and every other role: NO Excel Import permission.
 * Call once per process (a second registration is a configuration error by design).
 */
export function registerImportAuthorization(deps: ImportAuthorizationDeps): void {
  const manager = ['SCHOOL_MANAGER'] as const;
  deps.policies.register({ code: ImportPermissions.DOWNLOAD_TEMPLATE, roles: manager, scope: 'UNSCOPED' });
  deps.policies.register({ code: ImportPermissions.CREATE_PREVIEW, roles: manager, scope: 'MANAGEMENT' });
  deps.policies.register({ code: ImportPermissions.READ_PREVIEW, roles: manager, scope: 'MANAGEMENT' });
  deps.policies.register({ code: ImportPermissions.CONFIRM, roles: manager, scope: 'MANAGEMENT' });
  deps.policies.register({ code: ImportPermissions.CANCEL, roles: manager, scope: 'MANAGEMENT' });

  deps.resolvers.registerScopeResolver('MANAGEMENT', IMPORT_PREVIEW_TARGET_TYPE, {
    covers: async ({ userId, role, kind, target }) => {
      if (kind !== 'MANAGEMENT' || target.type !== IMPORT_PREVIEW_TARGET_TYPE || role !== 'SCHOOL_MANAGER') return false;
      const preview = await deps.previews.findScopeById(target.id);
      if (!preview || preview.createdBy !== userId) return false;
      return deps.schools.isSchoolManager(userId, preview.schoolId);
    },
  });
}
