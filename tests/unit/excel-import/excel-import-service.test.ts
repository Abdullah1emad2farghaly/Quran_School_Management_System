import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import { registerAllErrorMessages } from '../../../src/app/bootstrap/register-error-messages';
import { ImportErrorCodes, ImportIssueCodes, ImportPermissions, IMPORT_PREVIEW_TARGET_TYPE } from '../../../src/modules/36-excel-import/public';
import { SCHOOL_TARGET_TYPE } from '../../../src/modules/16-schools/public';
import { GROUP, createExcelImportHarness, validRow, workbook } from '../../helpers/excel-import-harness';

registerAllErrorMessages();

const HOURS = 3_600_000;
const SCHEDULE_AR = 'السبت 16:00-17:00؛ الاثنين 16:00-17:00';
const codes = (p: { issues: readonly { code: string }[] }) => p.issues.map((i) => i.code);
const hasArabic = (s: string) => /[\u0600-\u06FF]/u.test(s);

async function setup(options: Parameters<typeof createExcelImportHarness>[0] = {}) {
  const t = await createExcelImportHarness(options);
  const school = await t.newSchool('مدرسة أ');
  const manager = await t.newSchoolManager(school.id);
  return { t, school, manager };
}

describe('the template', () => {
  it('is available in Arabic and English and refuses any other language', async () => {
    const { t } = await setup();
    expect((await t.importer.getTemplate('ar')).data.length).toBeGreaterThan(0);
    expect((await t.importer.getTemplate('en')).fileName).toMatch(/\.xlsx$/u);
    await expect(t.importer.getTemplate('fr')).rejects.toMatchObject({ code: ImportErrorCodes.EXCEL_IMPORT_TEMPLATE_LANGUAGE_INVALID });
  });
});

describe('preview and confirmation: the happy path', () => {
  it('previews WITHOUT writing anything, then creates everything on confirmation, by preview id (no second upload)', async () => {
    const { t, school, manager } = await setup();
    const a = validRow('ar', { groupSchedule: SCHEDULE_AR });
    const b = validRow('ar', { groupSchedule: SCHEDULE_AR });
    const preview = await t.upload(school.id, manager.id, workbook([a, b]));

    expect(preview).toMatchObject({ status: 'PENDING', canConfirm: true, blocking: 0, language: 'ar' });
    expect(preview.summary).toMatchObject({ totalRows: 2, rowsOk: 2, newStudents: 2, newParents: 2, newTeachers: 1, newGroups: 1, newUsers: 3, existingStudents: 0, errors: 0, conflicts: 0 });
    expect(preview.rows.items[0]!.group.schedule.display).toEqual({ ar: SCHEDULE_AR, en: 'Saturday 16:00-17:00; Monday 16:00-17:00' });
    // nothing was written
    expect(await t.students.findByNationalId(a.studentNationalId!)).toBeUndefined();
    expect(await t.groups.findActiveByName(school.id, GROUP)).toBeUndefined();
    expect(t.files.saved).toHaveLength(1);

    const confirmed = await t.importer.confirmPreview(preview.id, manager.id, 'ar');
    expect(confirmed).toMatchObject({ status: 'CONFIRMED', canConfirm: false, issues: [], rows: { total: 0 } });
    expect(confirmed.result).toEqual({ studentsCreated: 2, studentsReused: 0, parentsCreated: 2, parentsReused: 0, teachersCreated: 1, teachersReused: 0, groupsCreated: 1, groupsReused: 0, slotsCreated: 2, assignmentsCreated: 2 });

    const group = (await t.groups.findActiveByName(school.id, GROUP))!;
    expect(group).toMatchObject({ learningMode: 'GROUP', progression: 'FORWARD', startingSurah: 78 });
    expect(group.teacher).not.toBeNull();
    expect((await t.schedules.listSlots(group.id)).map((s) => s.dayOfWeek).sort()).toEqual(['MONDAY', 'SATURDAY']);
    for (const row of [a, b]) {
      const student = (await t.students.findByNationalId(row.studentNationalId!))!;
      expect(student.schoolId).toBe(school.id);
      expect((await t.groups.listAssignmentHistoryOfStudent(student.id)).find((x) => x.unassignedAt === null)?.groupId).toBe(group.id);
    }
    // the personal data of the preview is gone after the confirmation
    expect((await t.previews.findById(preview.id))!.sourceRows).toBeNull();
  });

  it('works end to end in English: English headers, English values and English weekday names', async () => {
    const { t, school, manager } = await setup();
    const row = validRow('en', { groupSchedule: 'SAT 16:00-17:00; MON 16:00-17:00' });
    const preview = await t.upload(school.id, manager.id, workbook([row], 'en'), 'en');
    expect(preview).toMatchObject({ canConfirm: true, language: 'en' });
    await t.importer.confirmPreview(preview.id, manager.id, 'en');
    const group = (await t.groups.findActiveByName(school.id, GROUP))!;
    expect(group.learningMode).toBe('GROUP');
    expect((await t.schedules.listSlots(group.id)).length).toBe(2);
  });

  it('an empty schedule cell imports the group without a schedule', async () => {
    const { t, school, manager } = await setup();
    const preview = await t.upload(school.id, manager.id, workbook([validRow()]));
    expect(preview.canConfirm).toBe(true);
    await t.importer.confirmPreview(preview.id, manager.id, 'ar');
    expect(await t.schedules.listSlots((await t.groups.findActiveByName(school.id, GROUP))!.id)).toEqual([]);
  });

  it('a second confirmation (or a confirmation after cancelling) is refused', async () => {
    const { t, school, manager } = await setup();
    const p1 = await t.upload(school.id, manager.id, workbook([validRow()]));
    await t.importer.confirmPreview(p1.id, manager.id, 'ar');
    await expect(t.importer.confirmPreview(p1.id, manager.id, 'ar')).rejects.toMatchObject({ code: ImportErrorCodes.EXCEL_IMPORT_PREVIEW_NOT_PENDING });
    const p2 = await t.upload(school.id, manager.id, workbook([validRow('ar', { groupName: 'حلقة العصر', studentNationalId: '30001019999999' })]));
    const cancelled = await t.importer.cancelPreview(p2.id, manager.id);
    expect(cancelled).toMatchObject({ status: 'CANCELLED', canConfirm: false, issues: [] });
    expect(t.files.deleted).toContain(t.files.saved[1]);
    await expect(t.importer.confirmPreview(p2.id, manager.id, 'ar')).rejects.toMatchObject({ code: ImportErrorCodes.EXCEL_IMPORT_PREVIEW_NOT_PENDING });
    expect(await t.groups.findActiveByName(school.id, 'حلقة العصر')).toBeUndefined();
  });
});

describe('all-or-nothing', () => {
  it('any error blocks the confirmation and nothing at all is saved, not even the valid rows', async () => {
    const { t, school, manager } = await setup();
    const good = validRow();
    const bad = validRow('ar', { studentNationalId: '123' });
    const preview = await t.upload(school.id, manager.id, workbook([good, bad]));
    expect(preview).toMatchObject({ canConfirm: false });
    expect(preview.blocking).toBeGreaterThan(0);
    expect(preview.issues.find((i) => i.rowNumber === 3 && i.column === 'studentNationalId')?.severity).toBe('ERROR');
    await expect(t.importer.confirmPreview(preview.id, manager.id, 'ar')).rejects.toMatchObject({ code: ImportErrorCodes.EXCEL_IMPORT_CONFIRMATION_BLOCKED });
    expect(await t.students.findByNationalId(good.studentNationalId!)).toBeUndefined();
    expect(await t.groups.findActiveByName(school.id, GROUP)).toBeUndefined();
    expect((await t.previews.findById(preview.id))!.status).toBe('PENDING');
  });

  it('a failure while writing rolls EVERYTHING back (the first rows are not kept)', async () => {
    let calls = 0;
    const { t, school, manager } = await setup({
      wrap: (deps) => ({
        ...deps,
        students: {
          registerStudent: async (...args: Parameters<typeof deps.students.registerStudent>) => {
            calls += 1;
            if (calls === 2) throw new AppError('STUDENT_NATIONAL_ID_CONFLICT', 'CONFLICT');
            return deps.students.registerStudent(...args);
          },
        },
      }),
    });
    const a = validRow();
    const b = validRow();
    const preview = await t.upload(school.id, manager.id, workbook([a, b]));
    expect(preview.canConfirm).toBe(true);
    const failure = await t.importer.confirmPreview(preview.id, manager.id, 'ar').catch((e: unknown) => e);
    expect(failure).toMatchObject({ code: ImportErrorCodes.EXCEL_IMPORT_COMMIT_FAILED, details: { row: 3, cause: 'STUDENT_NATIONAL_ID_CONFLICT' } });
    expect(await t.students.findByNationalId(a.studentNationalId!)).toBeUndefined();
    expect(await t.groups.findActiveByName(school.id, GROUP)).toBeUndefined();
    expect((await t.previews.findById(preview.id))!.status).toBe('PENDING');
  });

  it('data that changed after the preview is caught by the second analysis inside the commit: nothing is saved', async () => {
    const { t, school, manager } = await setup();
    const row = validRow();
    const preview = await t.upload(school.id, manager.id, workbook([row]));
    expect(preview.canConfirm).toBe(true);
    // meanwhile, another parent registers a student with the same National ID
    const otherParent = await t.newParent(school.id, manager.id, 'منى كمال فهمي');
    await t.registerStudent(school.id, otherParent.id, manager.id, { nationalId: row.studentNationalId, fullName: 'سلمى منى كمال' });
    await expect(t.importer.confirmPreview(preview.id, manager.id, 'ar')).rejects.toMatchObject({ code: ImportErrorCodes.EXCEL_IMPORT_PREVIEW_STALE });
    expect(await t.groups.findActiveByName(school.id, GROUP)).toBeUndefined();
    expect((await t.previews.findById(preview.id))!.status).toBe('PENDING');
  });
});

describe('conflicts and identities', () => {
  it('a duplicate National ID inside the file is a conflict on every row involved', async () => {
    const { t, school, manager } = await setup();
    const a = validRow();
    const b = validRow('ar', { studentNationalId: a.studentNationalId! });
    const preview = await t.upload(school.id, manager.id, workbook([a, b]));
    expect(preview.canConfirm).toBe(false);
    const dup = preview.issues.filter((i) => i.code === ImportIssueCodes.EXCEL_IMPORT_DUPLICATE_NATIONAL_ID);
    expect(dup.map((i) => [i.rowNumber, i.severity])).toEqual([[2, 'CONFLICT'], [3, 'CONFLICT']]);
  });

  it('an existing student in ANOTHER group is a conflict: never moved, never changed', async () => {
    const { t, school, manager } = await setup();
    const first = validRow('ar', { parentPhone: '01055550001' });
    const p1 = await t.upload(school.id, manager.id, workbook([first]));
    await t.importer.confirmPreview(p1.id, manager.id, 'ar');
    const student = (await t.students.findByNationalId(first.studentNationalId!))!;
    const before = (await t.groups.listAssignmentHistoryOfStudent(student.id)).length;

    const again = { ...first, groupName: 'حلقة المغرب' };
    const p2 = await t.upload(school.id, manager.id, workbook([again]));
    expect(p2.canConfirm).toBe(false);
    expect(p2.issues.find((i) => i.code === ImportIssueCodes.EXCEL_IMPORT_STUDENT_IN_OTHER_GROUP)).toMatchObject({ severity: 'CONFLICT', rowNumber: 2, params: { group: GROUP } });
    await expect(t.importer.confirmPreview(p2.id, manager.id, 'ar')).rejects.toMatchObject({ code: ImportErrorCodes.EXCEL_IMPORT_CONFIRMATION_BLOCKED });
    expect((await t.groups.listAssignmentHistoryOfStudent(student.id)).length).toBe(before);
    expect(await t.groups.findActiveByName(school.id, 'حلقة المغرب')).toBeUndefined();
  });

  it('an existing student already in THIS group is only a warning, reused without any change', async () => {
    const { t, school, manager } = await setup();
    const first = validRow('ar', { parentPhone: '01055550002' });
    await t.importer.confirmPreview((await t.upload(school.id, manager.id, workbook([first]))).id, manager.id, 'ar');
    const p2 = await t.upload(school.id, manager.id, workbook([first]));
    expect(p2).toMatchObject({ canConfirm: true, blocking: 0 });
    expect(p2.issues.map((i) => [i.code, i.severity])).toEqual([[ImportIssueCodes.EXCEL_IMPORT_STUDENT_ALREADY_IN_GROUP, 'WARNING']]);
    const done = await t.importer.confirmPreview(p2.id, manager.id, 'ar');
    expect(done.result).toMatchObject({ studentsCreated: 0, studentsReused: 1, parentsCreated: 0, parentsReused: 1, teachersReused: 1, groupsReused: 1, assignmentsCreated: 0 });
  });

  it('an existing student with a DIFFERENT parent is a conflict', async () => {
    const { t, school, manager } = await setup();
    const first = validRow('ar', { parentPhone: '01055550003' });
    await t.importer.confirmPreview((await t.upload(school.id, manager.id, workbook([first]))).id, manager.id, 'ar');
    const other = { ...first, parentPhone: '01055550004', parentName: 'أحمد محمد سعيد' };
    const p = await t.upload(school.id, manager.id, workbook([other]));
    expect(codes(p)).toContain(ImportIssueCodes.EXCEL_IMPORT_STUDENT_PARENT_CONFLICT);
    expect(p.canConfirm).toBe(false);
  });

  it('an existing parent and teacher are reused (no duplicate accounts); a new student of the same parent joins the group', async () => {
    const { t, school, manager } = await setup();
    const first = validRow('ar', { parentPhone: '01055550005' });
    await t.importer.confirmPreview((await t.upload(school.id, manager.id, workbook([first]))).id, manager.id, 'ar');
    const sibling = validRow('ar', { parentPhone: '01055550005', studentName: 'يوسف أحمد محمد' });
    const p = await t.upload(school.id, manager.id, workbook([sibling]));
    expect(p.summary).toMatchObject({ newParents: 0, existingParents: 1, newTeachers: 0, existingTeachers: 1, newUsers: 0, existingUsers: 2, newGroups: 0, existingGroups: 1, newStudents: 1 });
    await t.importer.confirmPreview(p.id, manager.id, 'ar');
    const s1 = (await t.students.findByNationalId(first.studentNationalId!))!;
    const s2 = (await t.students.findByNationalId(sibling.studentNationalId!))!;
    expect(s2.parentId).toBe(s1.parentId);
  });

  it('the same phone with a different name is an identity conflict (accounts are never merged), in the file and against existing accounts', async () => {
    const { t, school, manager } = await setup();
    const inFile = await t.upload(school.id, manager.id, workbook([validRow('ar', { parentPhone: '01066660001' }), validRow('ar', { parentPhone: '01066660001', parentName: 'سعيد حسن محمود', studentName: 'عمر حسن محمود' })]));
    expect(codes(inFile)).toContain(ImportIssueCodes.EXCEL_IMPORT_PARENT_DATA_CONFLICT);

    await t.importer.confirmPreview((await t.upload(school.id, manager.id, workbook([validRow()]))).id, manager.id, 'ar');
    const clash = await t.upload(school.id, manager.id, workbook([validRow('ar', { teacherName: 'سعيد حسن محمود' })]));
    expect(codes(clash)).toContain(ImportIssueCodes.EXCEL_IMPORT_TEACHER_NAME_CONFLICT);
    expect(clash.canConfirm).toBe(false);
  });

  it('a phone used by a parent in one row and a teacher in another with the same name is ONE person (one account)', async () => {
    const { t, school, manager } = await setup();
    const row = validRow('ar', { teacherName: 'أحمد محمد علي', teacherPhone: '01077770001', parentPhone: '01077770001' });
    const p = await t.upload(school.id, manager.id, workbook([row]));
    expect(p.canConfirm).toBe(true);
    expect(p.summary.newUsers).toBe(1);
    await t.importer.confirmPreview(p.id, manager.id, 'ar');
  });

  it('an existing group is reused only when the teacher, settings and schedule all match; otherwise it is a conflict and is never changed', async () => {
    const { t, school, manager } = await setup();
    await t.importer.confirmPreview((await t.upload(school.id, manager.id, workbook([validRow('ar', { groupSchedule: SCHEDULE_AR })]))).id, manager.id, 'ar');
    const same = await t.upload(school.id, manager.id, workbook([validRow('ar', { groupSchedule: SCHEDULE_AR })]));
    expect(same.canConfirm).toBe(true);
    expect(same.rows.items[0]!.group.decision).toBe('EXISTING');
    const noSchedule = await t.upload(school.id, manager.id, workbook([validRow()]));
    expect(noSchedule.canConfirm).toBe(true); // an empty cell leaves the existing group alone

    const otherTeacher = await t.upload(school.id, manager.id, workbook([validRow('ar', { groupSchedule: SCHEDULE_AR, teacherName: 'سعيد حسن محمود', teacherPhone: '01088880001' })]));
    expect(codes(otherTeacher)).toContain(ImportIssueCodes.EXCEL_IMPORT_GROUP_TEACHER_CONFLICT);
    const otherSettings = await t.upload(school.id, manager.id, workbook([validRow('ar', { groupSchedule: SCHEDULE_AR, learningMode: 'فردي' })]));
    expect(codes(otherSettings)).toContain(ImportIssueCodes.EXCEL_IMPORT_GROUP_SETTINGS_CONFLICT);
    const otherSchedule = await t.upload(school.id, manager.id, workbook([validRow('ar', { groupSchedule: 'الأحد 10:00-11:00' })]));
    expect(codes(otherSchedule)).toContain(ImportIssueCodes.EXCEL_IMPORT_GROUP_SCHEDULE_CONFLICT);
  });

  it('rows of one group with different data are a conflict', async () => {
    const { t, school, manager } = await setup();
    const p = await t.upload(school.id, manager.id, workbook([validRow('ar', { groupSchedule: SCHEDULE_AR }), validRow('ar', { groupSchedule: 'الأحد 10:00-11:00' })]));
    expect(codes(p).filter((c) => c === ImportIssueCodes.EXCEL_IMPORT_GROUP_ROWS_INCONSISTENT)).toHaveLength(2);
  });
});

describe('group schedule rules (Module 23 rules apply, nothing new is invented)', () => {
  it('two slots on the same weekday in one cell are an error even when they do not overlap', async () => {
    const { t, school, manager } = await setup();
    const p = await t.upload(school.id, manager.id, workbook([validRow('ar', { groupSchedule: 'السبت 08:00-09:00؛ السبت 16:00-17:00' })]));
    expect(p.issues[0]).toMatchObject({ code: ImportIssueCodes.EXCEL_IMPORT_SCHEDULE_DUPLICATE_DAY, severity: 'ERROR', column: 'groupSchedule' });
    expect(p.canConfirm).toBe(false);
  });

  it('one teacher cannot teach two overlapping slots: between two groups of the file, and against groups that already exist', async () => {
    const { t, school, manager } = await setup();
    const inFile = await t.upload(school.id, manager.id, workbook([validRow('ar', { groupName: 'حلقة أ', groupSchedule: 'السبت 16:00-17:00' }), validRow('ar', { groupName: 'حلقة ب', groupSchedule: 'السبت 16:30-17:30' })]));
    expect(codes(inFile).filter((c) => c === ImportIssueCodes.EXCEL_IMPORT_TEACHER_SCHEDULE_CONFLICT).length).toBeGreaterThanOrEqual(2);
    expect(inFile.canConfirm).toBe(false);

    const fine = await t.upload(school.id, manager.id, workbook([validRow('ar', { groupName: 'حلقة أ', groupSchedule: 'السبت 16:00-17:00' }), validRow('ar', { groupName: 'حلقة ب', groupSchedule: 'السبت 17:00-18:00' })]));
    expect(fine.canConfirm).toBe(true);
    await t.importer.confirmPreview(fine.id, manager.id, 'ar');

    const existing = await t.upload(school.id, manager.id, workbook([validRow('ar', { groupName: 'حلقة ج', groupSchedule: 'السبت 16:30-17:30' })]));
    expect(codes(existing)).toContain(ImportIssueCodes.EXCEL_IMPORT_TEACHER_SCHEDULE_CONFLICT);
    expect(existing.canConfirm).toBe(false);
  });
});

describe('Arabic and English messages', () => {
  it('every finding carries a stable code and its message in BOTH languages (Arabic in Arabic letters, naming the column in the template\'s own words)', async () => {
    const { t, school, manager } = await setup();
    const p = await t.upload(school.id, manager.id, workbook([validRow('ar', { groupName: '', learningMode: 'غير معروف', startingSurah: '300', groupSchedule: 'Funday 16:00-17:00', studentNationalId: '12' })]));
    expect(p.issues.length).toBeGreaterThanOrEqual(5);
    for (const issue of p.issues) {
      expect(issue.code).toMatch(/^[A-Z_]+$/u);
      expect(hasArabic(issue.message.ar), issue.code).toBe(true);
      expect(issue.message.en.trim(), issue.code).not.toBe('');
      expect(issue.message.en, issue.code).not.toEqual(issue.message.ar);
    }
    const required = p.issues.find((i) => i.code === ImportIssueCodes.EXCEL_IMPORT_REQUIRED_VALUE)!;
    expect(required.message.ar).toContain('اسم الحلقة');
    expect(required.message.en).toContain('Group Name');
    expect(p.issues.find((i) => i.code === ImportIssueCodes.EXCEL_IMPORT_INVALID_LEARNING_MODE)!.message.ar).toContain('جماعي');
  });

  it('the findings of the owning modules (name, National ID, address) keep their own codes and bilingual messages', async () => {
    const { t, school, manager } = await setup();
    const p = await t.upload(school.id, manager.id, workbook([validRow('ar', { studentName: 'عمر أحمد', parentAddress: 'مكان غير موجود / س / ص', teacherPhone: '123' })]));
    expect(p.issues.length).toBeGreaterThanOrEqual(3);
    for (const issue of p.issues) {
      expect(hasArabic(issue.message.ar), issue.code).toBe(true);
      expect(issue.message.en, issue.code).toMatch(/[A-Za-z]/u);
    }
  });
});

describe('the file itself', () => {
  it('refuses a missing required column, a repeated column, a sheet without a header row and a sheet without data (and removes the stored file)', async () => {
    const { t, school, manager } = await setup();
    const headers = IMPORT_HEADERS();
    await expect(t.upload(school.id, manager.id, workbook([validRow()], 'ar', { headers: headers.slice(0, 5) }))).rejects.toMatchObject({ code: ImportErrorCodes.EXCEL_IMPORT_MISSING_COLUMNS });
    await expect(t.upload(school.id, manager.id, workbook([validRow()], 'ar', { headers: [...headers, headers[0]!] }))).rejects.toMatchObject({ code: ImportErrorCodes.EXCEL_IMPORT_DUPLICATE_COLUMNS });
    await expect(t.upload(school.id, manager.id, Buffer.from(JSON.stringify({ rows: [['a', 'b'], ['c', 'd']] })))).rejects.toMatchObject({ code: ImportErrorCodes.EXCEL_IMPORT_HEADER_NOT_FOUND });
    await expect(t.upload(school.id, manager.id, workbook([]))).rejects.toMatchObject({ code: ImportErrorCodes.EXCEL_IMPORT_NO_ROWS });
    expect(t.files.deleted).toHaveLength(t.files.saved.length);
  });

  it('refuses more rows than the limit, and ignores (with a warning) a column that is not part of the template', async () => {
    const { t, school, manager } = await setup({ maxRows: 2 });
    await expect(t.upload(school.id, manager.id, workbook([validRow(), validRow(), validRow()]))).rejects.toMatchObject({ code: ImportErrorCodes.EXCEL_IMPORT_TOO_MANY_ROWS });
    const p = await t.upload(school.id, manager.id, workbook([validRow()], 'ar', { extraHeader: 'ملاحظات' }));
    expect(p.canConfirm).toBe(true);
    expect(p.issues).toMatchObject([{ code: ImportIssueCodes.EXCEL_IMPORT_UNKNOWN_COLUMN, severity: 'WARNING', rowNumber: null }]);
  });

  it('skips fully empty rows and finds the header row below a title', async () => {
    const { t, school, manager } = await setup();
    const sheet = JSON.parse(workbook([validRow()]).toString()) as { rows: unknown[][] };
    const withTitle = Buffer.from(JSON.stringify({ rows: [['قائمة الطلاب'], ...sheet.rows, ['', '']] }));
    const p = await t.upload(school.id, manager.id, withTitle);
    expect(p.summary.totalRows).toBe(1);
    expect(p.canConfirm).toBe(true);
  });

  it('refuses a school that does not exist or is not active', async () => {
    const { t, manager } = await setup();
    await expect(t.upload('00000000-0000-4000-8000-000000000000', manager.id, workbook([validRow()]))).rejects.toMatchObject({ code: ImportErrorCodes.EXCEL_IMPORT_SCHOOL_NOT_ACTIVE });
  });
});

function IMPORT_HEADERS(): string[] {
  return (JSON.parse(workbook([validRow()]).toString()) as { rows: string[][] }).rows[0]!;
}

describe('preview lifetime (24 hours)', () => {
  it('is rejected safely after it expires: nothing is read, imported or changed, and the personal data is purged', async () => {
    const { t, school, manager } = await setup();
    const row = validRow();
    const preview = await t.upload(school.id, manager.id, workbook([row]));
    expect(preview.expiresAt.getTime() - preview.createdAt.getTime()).toBe(24 * HOURS);
    t.h.advance(23 * HOURS);
    expect((await t.importer.getPreview(preview.id, manager.id)).canConfirm).toBe(true);
    t.h.advance(2 * HOURS);
    for (const attempt of [() => t.importer.getPreview(preview.id, manager.id), () => t.importer.confirmPreview(preview.id, manager.id, 'ar'), () => t.importer.cancelPreview(preview.id, manager.id)]) {
      await expect(attempt()).rejects.toMatchObject({ code: ImportErrorCodes.EXCEL_IMPORT_PREVIEW_EXPIRED });
    }
    expect(await t.students.findByNationalId(row.studentNationalId!)).toBeUndefined();
    expect(await t.importer.purgeExpired()).toBe(1);
    const stored = (await t.previews.findById(preview.id))!;
    expect(stored).toMatchObject({ status: 'EXPIRED', sourceRows: null, analysis: null });
    expect(t.files.deleted).toContain(t.files.saved[0]);
    await expect(t.importer.confirmPreview(preview.id, manager.id, 'ar')).rejects.toMatchObject({ code: ImportErrorCodes.EXCEL_IMPORT_PREVIEW_EXPIRED });
  });

  it('is rows-paginated when read', async () => {
    const { t, school, manager } = await setup();
    const preview = await t.upload(school.id, manager.id, workbook([validRow(), validRow(), validRow()]));
    const page = await t.importer.getPreview(preview.id, manager.id, { page: 2, pageSize: 2 });
    expect(page.rows).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(page.rows.items.map((r) => r.rowNumber)).toEqual([4]);
  });
});

describe('authorization and school isolation', () => {
  it('only the School Manager has Excel Import permissions, only for their own school and their own previews', async () => {
    const { t, school, manager } = await setup();
    const schoolB = await t.newSchool('مدرسة ب');
    const managerB = await t.newSchoolManager(schoolB.id);
    const parent = await t.newParent(school.id, manager.id);
    const teacher = await t.newTeacher(school.id, manager.id);
    const preview = await t.upload(school.id, manager.id, workbook([validRow()]));
    const allowed = async (userId: string, permission: string, target?: { type: string; id: string }) => (await t.engine.authorize({ userId, permission, ...(target ? { target } : {}) })).allowed;
    const onSchool = (id: string) => ({ type: SCHOOL_TARGET_TYPE, id });
    const onPreview = { type: IMPORT_PREVIEW_TARGET_TYPE, id: preview.id };

    expect(await allowed(manager.id, ImportPermissions.DOWNLOAD_TEMPLATE)).toBe(true);
    expect(await allowed(manager.id, ImportPermissions.CREATE_PREVIEW, onSchool(school.id))).toBe(true);
    expect(await allowed(manager.id, ImportPermissions.CREATE_PREVIEW, onSchool(schoolB.id))).toBe(false); // another school
    for (const p of [ImportPermissions.READ_PREVIEW, ImportPermissions.CONFIRM, ImportPermissions.CANCEL]) {
      expect(await allowed(manager.id, p, onPreview), p).toBe(true);
      expect(await allowed(managerB.id, p, onPreview), `${p}: another school's manager`).toBe(false);
    }
    for (const userId of [parent.userId, teacher.userId, t.orgAdmin.id]) {
      expect(await allowed(userId, ImportPermissions.DOWNLOAD_TEMPLATE)).toBe(false);
      expect(await allowed(userId, ImportPermissions.CREATE_PREVIEW, onSchool(school.id))).toBe(false);
      for (const p of [ImportPermissions.READ_PREVIEW, ImportPermissions.CONFIRM, ImportPermissions.CANCEL]) expect(await allowed(userId, p, onPreview), p).toBe(false);
    }
    // a preview that does not exist grants nothing
    expect(await allowed(manager.id, ImportPermissions.CONFIRM, { type: IMPORT_PREVIEW_TARGET_TYPE, id: '00000000-0000-4000-8000-000000000000' })).toBe(false);
    // the access disappears with the manager link (resolved from server data)
    await t.service.revokeSchoolManager({ schoolId: school.id, actorId: t.orgAdmin.id });
    expect(await allowed(manager.id, ImportPermissions.CONFIRM, onPreview)).toBe(false);
    expect(await allowed(manager.id, ImportPermissions.CREATE_PREVIEW, onSchool(school.id))).toBe(false);
  });

  it('the service itself answers "not found" for a preview of someone else (the same answer as for a missing one)', async () => {
    const { t, school, manager } = await setup();
    const schoolB = await t.newSchool('مدرسة ب');
    const managerB = await t.newSchoolManager(schoolB.id);
    const preview = await t.upload(school.id, manager.id, workbook([validRow()]));
    for (const attempt of [() => t.importer.getPreview(preview.id, managerB.id), () => t.importer.confirmPreview(preview.id, managerB.id, 'ar'), () => t.importer.cancelPreview(preview.id, managerB.id)]) {
      await expect(attempt()).rejects.toMatchObject({ code: ImportErrorCodes.EXCEL_IMPORT_PREVIEW_NOT_FOUND });
    }
    await expect(t.importer.getPreview('00000000-0000-4000-8000-000000000000', manager.id)).rejects.toMatchObject({ code: ImportErrorCodes.EXCEL_IMPORT_PREVIEW_NOT_FOUND });
  });

  it('an import writes only into the school it was authorized for, whatever the file says', async () => {
    const { t, school, manager } = await setup();
    const schoolB = await t.newSchool('مدرسة ب');
    const row = validRow('ar', { schoolId: schoolB.id } as never);
    const preview = await t.upload(school.id, manager.id, workbook([row]));
    await t.importer.confirmPreview(preview.id, manager.id, 'ar');
    expect((await t.students.findByNationalId(row.studentNationalId!))!.schoolId).toBe(school.id);
    expect(await t.groups.findActiveByName(schoolB.id, GROUP)).toBeUndefined();
  });
});
