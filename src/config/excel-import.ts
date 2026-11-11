import {
  ExcelImportService,
  ExcelJsWorkbookReader,
  ExcelJsWorkbookWriter,
  SequelizeImportPreviewRepository,
  createServiceImportDirectory,
  registerImportAuthorization,
} from '../modules/36-excel-import/public';
import { SystemClock } from '../modules/00-shared-kernel/public';
import { getAuthorizationPolicyRegistry, getAuthorizationResolvers } from './authorization';
import { getSequelize, getUnitOfWork } from './database';
import { getFileService } from './files';
import { getIdentityService } from './identity';
import { getParentService } from './parents';
import { getGroupScheduleService } from './schedules';
import { getSchoolService } from './schools';
import { getStudentService } from './students';
import { getTeacherService } from './teachers';
import { getGroupService } from './groups';
import { getUnifiedAddressService } from './unified-address';

let service: ExcelImportService | undefined;

/**
 * Module 36. Reads go through the importer's directory (public contracts of Modules 08, 15-20, 23); every write goes through the owning modules'
 * services. Reached lazily like the other config files, so nothing touches the database at import.
 */
export function getExcelImportService(): ExcelImportService {
  if (!service) {
    service = new ExcelImportService({
      previews: new SequelizeImportPreviewRepository(getSequelize()),
      directory: createServiceImportDirectory({
        schools: getSchoolService(),
        identity: getIdentityService(),
        parents: getParentService(),
        teachers: getTeacherService(),
        students: getStudentService(),
        groups: getGroupService(),
        schedules: getGroupScheduleService(),
        address: getUnifiedAddressService(),
      }),
      reader: new ExcelJsWorkbookReader(),
      writer: new ExcelJsWorkbookWriter(),
      files: getFileService(),
      parents: getParentService(),
      teachers: getTeacherService(),
      students: getStudentService(),
      groups: getGroupService(),
      schedules: getGroupScheduleService(),
      unitOfWork: getUnitOfWork(),
      clock: new SystemClock(),
    });
  }
  return service;
}

/** Excel Import permissions (SCHOOL_MANAGER only) and the MANAGEMENT/EXCEL_IMPORT_PREVIEW scope resolver: registered ONCE, through the shared engine. */
registerImportAuthorization({
  policies: getAuthorizationPolicyRegistry(),
  resolvers: getAuthorizationResolvers(),
  previews: { findScopeById: (previewId) => getExcelImportService().findScopeById(previewId) },
  schools: { isSchoolManager: (userId, schoolId) => getSchoolService().isSchoolManager(userId, schoolId) },
});
