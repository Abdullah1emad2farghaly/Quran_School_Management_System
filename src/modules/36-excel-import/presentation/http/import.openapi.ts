import { ref, schema as s, type AuthorizationDoc, type ErrorDoc, type ModuleApiDoc, type OperationDoc } from '../../../04-validation-api/public';
import { ImportPermissions } from '../../application/services/import-authorization';

const SCHOOL_ID = '9a4e7c21-6d03-4b58-8e1f-0c2d5b7a3f64';
const PREVIEW_ID = 'c3d81f6a-52b4-4e97-8a10-7b9e2d4f6c05';

const REFERENCE = 'docs/EXCEL-IMPORT.md; Master Specification §73-§79; docs/AUTHORIZATION-MATRIX.md (Excel Import 36)';
const MANAGER_ENFORCEMENT =
  "Enforced by the Authorization Engine (deny by default): the caller must hold the SCHOOL_MANAGER role. For an upload the school must be one the caller actively manages (derived from the caller's own manager links on the server, never from the file); for a preview the caller must be the person who created it AND still the active manager of its school. Every other role, including ORGANIZATION_MANAGER and MAIN_ADMIN, is denied.";

const schoolManager = (permissionId: string, scope: string): AuthorizationDoc => ({ authentication: 'required', roles: ['SCHOOL_MANAGER'], scope, enforcement: MANAGER_ENFORCEMENT, permissionId, decision: 'APPROVED', reference: REFERENCE });

const NOT_ALLOWED: ErrorDoc = { status: 403, codes: ['ACCESS_DENIED', 'PASSWORD_CHANGE_REQUIRED'], description: 'The caller lacks the permission or the scope (no reason is given), or the account must first change its initial password.' };
const previewNotFound: ErrorDoc = { status: 404, codes: ['EXCEL_IMPORT_PREVIEW_NOT_FOUND'], description: 'The preview does not exist or was created by someone else (the same neutral answer for both).' };
const expired: ErrorDoc = { status: 422, codes: ['EXCEL_IMPORT_PREVIEW_EXPIRED'], description: 'The preview is older than 24 hours. Upload the file again; nothing was changed.' };
const idParam = { id: { description: 'The preview id.', example: PREVIEW_ID, schema: s.uuid() } };

const bilingual = s.object({ ar: s.string({ example: 'العمود «اسم الحلقة» إلزامي ولا يمكن تركه فارغًا.' }), en: s.string({ example: 'The column "Group Name" is required and cannot be empty.' }) }, ['ar', 'en']);

const issueSchema = s.object(
  {
    rowNumber: s.integer({ nullable: true, description: 'The sheet row, or null for a finding about the file itself.', example: 3 }),
    column: s.string({ nullable: true, description: 'The column key (studentName, studentNationalId, parentName, parentPhone, parentAddress, groupName, teacherName, teacherPhone, learningMode, progression, startingSurah, groupSchedule), or null.', example: 'groupName' }),
    severity: s.string({ enum: ['ERROR', 'CONFLICT', 'WARNING'], description: 'ERROR and CONFLICT block the confirmation; WARNING never does.' }),
    code: s.string({ description: 'A stable, language-independent code. Findings that come from another module keep that module\'s own code (for example INVALID_STUDENT_NATIONAL_ID).', example: 'EXCEL_IMPORT_REQUIRED_VALUE' }),
    params: { type: 'object', additionalProperties: true, description: 'Values used in the message.', example: {} },
    message: bilingual,
  },
  ['rowNumber', 'column', 'severity', 'code', 'params', 'message'],
);

const slotSchema = s.object({ day: s.string({ enum: ['SATURDAY', 'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'] }), startTime: s.string({ example: '16:00' }), endTime: s.string({ example: '17:00' }) }, ['day', 'startTime', 'endTime']);
const decision = (description: string) => s.string({ nullable: true, description: `${description} NEW (will be created), EXISTING (reused), or null when the row has an error that stops the check.`, example: 'NEW' });

const rowSchema = s.object(
  {
    rowNumber: s.integer({ example: 2 }),
    status: s.string({ enum: ['OK', 'WARNING', 'ERROR', 'CONFLICT'] }),
    student: s.object({ name: s.string(), nationalId: s.string(), decision: decision('The student.') }, ['name', 'nationalId', 'decision']),
    parent: s.object({ name: s.string(), phone: s.string(), address: s.string(), decision: decision('The parent.') }, ['name', 'phone', 'address', 'decision']),
    teacher: s.object({ name: s.string(), phone: s.string(), decision: decision('The teacher.') }, ['name', 'phone', 'decision']),
    group: s.object(
      {
        name: s.string(),
        decision: decision('The group.'),
        learningMode: s.string({ nullable: true, example: 'GROUP' }),
        progression: s.string({ nullable: true, example: 'FORWARD' }),
        startingSurah: s.integer({ nullable: true, example: 78 }),
        schedule: s.object({ slots: s.array(slotSchema), display: bilingual }, ['slots', 'display'], { description: 'The parsed schedule, normalized to the existing weekday/time representation and written back in both languages.' }),
      },
      ['name', 'decision', 'learningMode', 'progression', 'startingSurah', 'schedule'],
    ),
    issues: s.array(issueSchema),
  },
  ['rowNumber', 'status', 'student', 'parent', 'teacher', 'group', 'issues'],
);

const count = (description: string) => s.integer({ minimum: 0, description });
const summarySchema = s.object(
  {
    totalRows: count('Data rows in the file.'),
    rowsOk: count('Rows without any finding.'),
    rowsWithWarnings: count('Rows with only warnings.'),
    rowsWithErrors: count('Rows with at least one error.'),
    rowsWithConflicts: count('Rows with at least one conflict (and no error).'),
    newUsers: count('Login accounts that will be created (a phone used by a parent and a teacher counts once).'),
    existingUsers: count('Existing login accounts that will be reused.'),
    newStudents: count('Students that will be created.'),
    existingStudents: count('Existing students recognized by National ID.'),
    newParents: count('Parent records that will be created.'),
    existingParents: count('Existing parents that will be reused.'),
    newTeachers: count('Teacher records that will be created.'),
    existingTeachers: count('Existing teachers that will be reused.'),
    newGroups: count('Groups that will be created.'),
    existingGroups: count('Existing groups that will be reused unchanged.'),
    errors: count('Findings with severity ERROR.'),
    conflicts: count('Findings with severity CONFLICT.'),
    warnings: count('Findings with severity WARNING.'),
  },
  ['totalRows', 'rowsOk', 'rowsWithWarnings', 'rowsWithErrors', 'rowsWithConflicts', 'newUsers', 'existingUsers', 'newStudents', 'existingStudents', 'newParents', 'existingParents', 'newTeachers', 'existingTeachers', 'newGroups', 'existingGroups', 'errors', 'conflicts', 'warnings'],
);

const resultSchema = s.object(
  {
    studentsCreated: count('Students created.'),
    studentsReused: count('Existing students reused.'),
    parentsCreated: count('Parent records created.'),
    parentsReused: count('Existing parents reused (linked to the school when needed).'),
    teachersCreated: count('Teacher records created.'),
    teachersReused: count('Existing teachers reused (linked to the school when needed).'),
    groupsCreated: count('Groups created.'),
    groupsReused: count('Existing groups reused unchanged.'),
    slotsCreated: count('Schedule slots created.'),
    assignmentsCreated: count('Student-to-group assignments created.'),
  },
  ['studentsCreated', 'studentsReused', 'parentsCreated', 'parentsReused', 'teachersCreated', 'teachersReused', 'groupsCreated', 'groupsReused', 'slotsCreated', 'assignmentsCreated'],
);

const previewSchema = s.object(
  {
    id: s.uuid({ description: 'Use it to read, confirm or cancel (no second upload is needed).' }),
    schoolId: s.uuid(),
    status: s.string({ enum: ['PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED'] }),
    language: s.string({ enum: ['ar', 'en'], description: 'The language used for the messages that name columns.' }),
    fileName: s.string({ example: 'students.xlsx' }),
    canConfirm: s.boolean({ description: 'True only while PENDING, not expired, and with NO error and NO conflict (all-or-nothing).' }),
    blocking: count('Errors + conflicts.'),
    createdAt: s.dateTime(),
    expiresAt: s.dateTime({ description: '24 hours after creation.' }),
    summary: ref('ExcelImportSummary'),
    issues: s.array(ref('ExcelImportIssue'), { description: 'EVERY finding of the file with its Arabic and English message. Empty once the preview is confirmed or cancelled (the personal data is removed).' }),
    rows: s.object({ items: s.array(ref('ExcelImportRow')), page: s.integer({ minimum: 1 }), pageSize: s.integer({ minimum: 1, maximum: 500 }), total: count('All analyzed rows.') }, ['items', 'page', 'pageSize', 'total'], { description: 'One page of the analyzed rows (`?page=` and `?pageSize=` on the read endpoint; the upload answer is page 1 of 100).' }),
    result: s.nullableRef('ExcelImportResult'),
  },
  ['id', 'schoolId', 'status', 'language', 'fileName', 'canConfirm', 'blocking', 'createdAt', 'expiresAt', 'summary', 'issues', 'rows', 'result'],
);

const summaryExample = { totalRows: 1, rowsOk: 1, rowsWithWarnings: 0, rowsWithErrors: 0, rowsWithConflicts: 0, newUsers: 2, existingUsers: 0, newStudents: 1, existingStudents: 0, newParents: 1, existingParents: 0, newTeachers: 1, existingTeachers: 0, newGroups: 1, existingGroups: 0, errors: 0, conflicts: 0, warnings: 0 };
const rowExample = {
  rowNumber: 2,
  status: 'OK',
  student: { name: 'عمر أحمد محمد', nationalId: '30001010123456', decision: 'NEW' },
  parent: { name: 'أحمد محمد علي', phone: '+201012345678', address: 'المنيا / سمالوط / برمشا', decision: 'NEW' },
  teacher: { name: 'خالد أحمد حسن', phone: '+201098765432', decision: 'NEW' },
  group: {
    name: 'حلقة الفجر',
    decision: 'NEW',
    learningMode: 'GROUP',
    progression: 'FORWARD',
    startingSurah: 78,
    schedule: { slots: [{ day: 'SATURDAY', startTime: '16:00', endTime: '17:00' }], display: { ar: 'السبت 16:00-17:00', en: 'Saturday 16:00-17:00' } },
  },
  issues: [],
};
const previewExample = (over: Record<string, unknown> = {}) => ({
  id: PREVIEW_ID,
  schoolId: SCHOOL_ID,
  status: 'PENDING',
  language: 'ar',
  fileName: 'students.xlsx',
  canConfirm: true,
  blocking: 0,
  createdAt: '2026-11-10T09:30:00.000Z',
  expiresAt: '2026-11-11T09:30:00.000Z',
  summary: summaryExample,
  issues: [],
  rows: { items: [rowExample], page: 1, pageSize: 100, total: 1 },
  result: null,
  ...over,
});
const resultExample = { studentsCreated: 1, studentsReused: 0, parentsCreated: 1, parentsReused: 0, teachersCreated: 1, teachersReused: 0, groupsCreated: 1, groupsReused: 0, slotsCreated: 1, assignmentsCreated: 1 };

const operations: OperationDoc[] = [
  {
    method: 'get',
    path: '/template',
    operationId: 'downloadExcelImportTemplate',
    summary: 'Download the Arabic or English import template',
    description:
      'Returns the .xlsx template: the data sheet with the 12 column headers (required ones marked with `*`) in the requested language, drop-down lists for the learning mode and progression, phone and National ID columns formatted as text, and an instructions sheet with every supported value and format (weekday names included). **Arabic** is for users who do not read English; both templates are recognized by the importer, and so are the headers of either language. `language` defaults to the language of the request (account preference, then `Accept-Language`).',
    authorization: schoolManager(ImportPermissions.DOWNLOAD_TEMPLATE, 'None (a template holds no data).'),
    query: [{ name: 'language', in: 'query', required: false, description: 'ar or en.', schema: { type: 'string', enum: ['ar', 'en'] }, example: 'ar' }],
    success: { status: 200, description: 'The .xlsx template (binary).', binary: { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } },
    errors: [NOT_ALLOWED],
  },
  {
    method: 'post',
    path: '/previews',
    operationId: 'createExcelImportPreview',
    summary: 'Upload a workbook and get the import preview',
    description:
      'Uploads ONE .xlsx file (multipart field `file`, at most 10 MB and 10,000 data rows) into the manager\'s own school and returns the PREVIEW. **Nothing is written to students, parents, teachers, groups or schedules.** The file is validated by content (Module 07), the header row is recognized in Arabic or English, every row is validated with the owning modules\' rules, and the preview says what will be created or reused and lists every error, conflict and warning in Arabic and English. The preview is kept on the server for **24 hours**. **School:** never read from the file; it is the one school the caller manages, or the one selected with `schoolId` when the caller manages several (verified by the Authorization Engine).',
    authorization: schoolManager(ImportPermissions.CREATE_PREVIEW, 'The school the caller actively manages (derived on the server).'),
    query: [{ name: 'schoolId', in: 'query', required: false, description: 'Only needed by a manager of several schools: which one to import into.', schema: { type: 'string', format: 'uuid' }, example: SCHOOL_ID }],
    request: {
      contentType: 'multipart/form-data',
      description: 'A multipart form with exactly one file field named `file` (.xlsx).',
      schema: s.object({ file: s.string({ format: 'binary', description: 'The .xlsx workbook.' }) }, ['file']),
      examples: { workbook: { summary: 'One workbook', value: { file: 'students.xlsx' } } },
    },
    success: { status: 201, description: 'The preview (PENDING) with its summary, every finding and the first page of rows.', data: ref('ExcelImportPreview'), example: previewExample() },
    errors: [
      { status: 400, codes: ['EXCEL_IMPORT_FILE_REQUIRED', 'FILE_EMPTY', 'FILE_TYPE_NOT_ALLOWED', 'FILE_CORRUPT', 'FILE_UNSAFE_CONTENT', 'EXCEL_IMPORT_FILE_UNREADABLE', 'EXCEL_IMPORT_HEADER_NOT_FOUND', 'EXCEL_IMPORT_MISSING_COLUMNS', 'EXCEL_IMPORT_DUPLICATE_COLUMNS', 'EXCEL_IMPORT_NO_ROWS'], description: 'No file, a file that is not a valid .xlsx, or a sheet whose header row or required columns cannot be recognized.' },
      NOT_ALLOWED,
      { status: 413, codes: ['FILE_TOO_LARGE', 'EXCEL_IMPORT_TOO_MANY_ROWS'], description: 'More than 10 MB or more than 10,000 data rows.' },
      { status: 422, codes: ['EXCEL_IMPORT_SCHOOL_SELECTION_REQUIRED', 'EXCEL_IMPORT_SCHOOL_NOT_ACTIVE'], description: 'The caller manages several schools and chose none, or the school is not ACTIVE.' },
    ],
  },
  {
    method: 'get',
    path: '/previews/:id',
    operationId: 'getExcelImportPreview',
    summary: 'Read a preview',
    description: 'Returns the preview of the caller\'s own upload: its status, summary, every finding and one page of the analyzed rows. A confirmed or cancelled preview keeps its summary and result but no rows or findings (the personal data is removed). An expired preview is refused.',
    authorization: schoolManager(ImportPermissions.READ_PREVIEW, 'The preview (created by the caller, whose school the caller still manages).'),
    pathParams: idParam,
    query: [
      { name: 'page', in: 'query', required: false, description: 'Rows page (default 1).', schema: { type: 'integer', minimum: 1 }, example: 1 },
      { name: 'pageSize', in: 'query', required: false, description: 'Rows per page (default 100, at most 500).', schema: { type: 'integer', minimum: 1, maximum: 500 }, example: 100 },
    ],
    success: { status: 200, description: 'The preview.', data: ref('ExcelImportPreview'), example: previewExample() },
    errors: [NOT_ALLOWED, previewNotFound, expired],
  },
  {
    method: 'post',
    path: '/previews/:id/confirm',
    operationId: 'confirmExcelImportPreview',
    summary: 'Confirm the import (all-or-nothing)',
    description:
      'Imports the previewed rows. The preview must be PENDING, not expired, and have **no error and no conflict** (otherwise nothing happens). The analysis is run again inside the commit transaction because the data may have changed; if it now has blocking findings the import is refused. Every write goes through the Parents, Teachers, Students, Groups and Group Schedules services in ONE transaction: **any failure rolls everything back and nothing is saved**. Existing students, groups, accounts and memberships are never moved, merged or changed. The answer is the confirmed preview with its `result` counts.',
    authorization: schoolManager(ImportPermissions.CONFIRM, 'The preview (created by the caller, whose school the caller still manages).'),
    pathParams: idParam,
    success: { status: 200, description: 'The preview, now CONFIRMED, with the result counts.', data: ref('ExcelImportPreview'), example: previewExample({ status: 'CONFIRMED', canConfirm: false, issues: [], rows: { items: [], page: 1, pageSize: 100, total: 0 }, result: resultExample }) },
    errors: [
      NOT_ALLOWED,
      previewNotFound,
      expired,
      { status: 409, codes: ['EXCEL_IMPORT_PREVIEW_NOT_PENDING', 'EXCEL_IMPORT_PREVIEW_STALE', 'EXCEL_IMPORT_COMMIT_FAILED'], description: 'Already confirmed or cancelled; the data changed since the preview and blocking findings appeared; or a row failed during the commit (the whole import was rolled back).' },
      { status: 422, codes: ['EXCEL_IMPORT_CONFIRMATION_BLOCKED', 'EXCEL_IMPORT_SCHOOL_NOT_ACTIVE'], description: 'The preview has errors or conflicts (all-or-nothing), or the school is not ACTIVE.' },
    ],
  },
  {
    method: 'post',
    path: '/previews/:id/cancel',
    operationId: 'cancelExcelImportPreview',
    summary: 'Cancel a preview',
    description: 'Discards a PENDING preview: its personal data and the stored file are removed. Nothing was ever imported.',
    authorization: schoolManager(ImportPermissions.CANCEL, 'The preview (created by the caller, whose school the caller still manages).'),
    pathParams: idParam,
    success: { status: 200, description: 'The preview, now CANCELLED.', data: ref('ExcelImportPreview'), example: previewExample({ status: 'CANCELLED', canConfirm: false, issues: [], rows: { items: [], page: 1, pageSize: 100, total: 0 } }) },
    errors: [NOT_ALLOWED, previewNotFound, expired, { status: 409, codes: ['EXCEL_IMPORT_PREVIEW_NOT_PENDING'], description: 'Already confirmed or cancelled.' }],
  },
];

/** OpenAPI contract of `/excel-imports` (`import-routes.ts`). Module 36: Excel Import. */
export const excelImportApiDoc: ModuleApiDoc = {
  moduleId: '36',
  mountPath: '/excel-imports',
  tag: {
    name: 'Excel Import',
    description:
      'Bulk import of students, parents, teachers, groups and group schedules from an Arabic or English .xlsx template by the School Manager: upload, full preview with Arabic/English findings, then an all-or-nothing confirmation by preview id. The school is always the manager\'s own; existing students, groups and accounts are never moved or changed.',
  },
  operations,
  schemas: {
    ExcelImportIssue: issueSchema,
    ExcelImportRow: rowSchema,
    ExcelImportSummary: summarySchema,
    ExcelImportResult: resultSchema,
    ExcelImportPreview: previewSchema,
  },
};
