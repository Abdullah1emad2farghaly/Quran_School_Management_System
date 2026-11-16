import { AppError, type TransactionContext } from '../../../00-shared-kernel/public';
import { defaultMessageCatalog } from '../../../03-error-localization/public';
import { personNameKey, normalizePhone } from '../../../08-identity-core/public';
import { isSameParentName, normalizeParentName } from '../../../17-parents/public';
import { isSameTeacherName, normalizeTeacherName } from '../../../18-teachers/public';
import { normalizeNationalId, normalizeStudentName, studentNameMatchesParent } from '../../../19-students/public';
import { groupNameKey, normalizeGroupName } from '../../../20-groups/public';
import { slotsOverlap } from '../../../23-group-schedules/public';
import {
  isBlocking,
  type AnalyzedRow,
  type EntityDecision,
  type ImportIssue,
  type IssueSeverity,
  type ParsedImportRow,
  type PlannedRow,
  type PreviewAnalysis,
  type PreviewSlot,
  type PreviewSummary,
  type RowStatus,
} from '../../domain/entities/import-types';
import { ImportIssueCodes } from '../../domain/errors/import-errors';
import { COLUMN_BY_KEY, type ImportColumnKey, type ImportLanguage } from '../../domain/value-objects/import-columns';
import { parseLearningMode, parseProgression, parseStartingSurah } from '../../domain/value-objects/option-values';
import { DAY_LABELS, describeSlots, parseScheduleCell } from '../../domain/value-objects/schedule-cell';
import type { ImportDirectory } from '../ports/import-directory';

type Params = Readonly<Record<string, string | number>>;
type ParamsInput = Params | ((language: ImportLanguage) => Params);

/** Builds a finding with its Arabic AND English message. `{column}` is filled with the column's header of each language. */
export function makeIssue(severity: IssueSeverity, code: string, rowNumber: number | null, column: ImportColumnKey | null, params: ParamsInput = {}): ImportIssue {
  const paramsFor = (language: ImportLanguage): Params => ({ ...(typeof params === 'function' ? params(language) : params), ...(column ? { column: COLUMN_BY_KEY[column].header[language] } : {}) });
  return {
    rowNumber,
    column,
    severity,
    code,
    params: typeof params === 'function' ? params('en') : params,
    message: { ar: defaultMessageCatalog.message(code, 'ar', paramsFor('ar')), en: defaultMessageCatalog.message(code, 'en', paramsFor('en')) },
  };
}

interface Draft {
  readonly row: ParsedImportRow;
  readonly issues: ImportIssue[];
  studentName?: string;
  nationalId?: string;
  parentName?: string;
  parentPhone?: string;
  parentAddress?: string;
  groupName?: string;
  teacherName?: string;
  teacherPhone?: string;
  learningMode?: 'GROUP' | 'INDIVIDUAL';
  progression?: 'FORWARD' | 'BACKWARD';
  startingSurah?: number;
  slots: PreviewSlot[];
  scheduleValid: boolean;
  parentDecision: EntityDecision | null;
  teacherDecision: EntityDecision | null;
  studentDecision: EntityDecision | null;
  groupDecision: EntityDecision | null;
}

interface PersonResolution {
  readonly userExists: boolean;
  readonly recordId?: string;
  readonly userId?: string;
  readonly conflict?: string;
}

const rowsText = (rows: readonly number[]): string => rows.join(', ');
const slotKey = (s: { day: string; startTime: string; endTime: string }): string => `${s.day} ${s.startTime}-${s.endTime}`;

export interface AnalyzeInput {
  readonly rows: readonly ParsedImportRow[];
  readonly unknownColumns: readonly string[];
  readonly school: { readonly id: string; readonly organizationId: string };
  readonly directory: ImportDirectory;
  readonly language: ImportLanguage;
  readonly tx?: TransactionContext;
}

export interface AnalyzeResult {
  readonly analysis: PreviewAnalysis;
  /** Only the rows that passed every check; meaningful for the commit only when `analysis.canConfirm`. */
  readonly plan: readonly PlannedRow[];
}

/**
 * The importer's brain (Master Specification §74-§79): turns the sheet's rows into findings and decisions WITHOUT writing anything.
 *  1. Per row: normalizes and validates every cell with the owning modules' own rules (names, National ID, phones, group name, address) and the
 *     importer's own vocabulary (learning mode, progression, surah number, Group Schedule cell). Their error codes and Arabic/English messages are kept.
 *  2. Across rows: duplicate National IDs, the same phone with different identities, and one group written with different data are CONFLICTS.
 *  3. Against the system: per phone and National ID the same identity rules as Modules 17/18/19/20 decide create / reuse / conflict
 *     (never merge, never move a student, never change an existing group), and teacher schedules are checked across every school (§35).
 * It is deterministic for a given data state, so the commit simply runs it again inside its transaction.
 */
export async function analyzeImport(input: AnalyzeInput): Promise<AnalyzeResult> {
  const { directory, school, tx } = input;
  const drafts: Draft[] = input.rows.map((row) => ({
    row,
    issues: [],
    slots: [],
    scheduleValid: false,
    parentDecision: null,
    teacherDecision: null,
    studentDecision: null,
    groupDecision: null,
  }));
  const fileIssues: ImportIssue[] = input.unknownColumns.map((text) => makeIssue('WARNING', ImportIssueCodes.EXCEL_IMPORT_UNKNOWN_COLUMN, null, null, { column: text }));

  // ------------------------------------------------------------------------------------------------ 1. per-row validation
  const addIssue = (d: Draft, severity: IssueSeverity, code: string, column: ImportColumnKey | null, params?: ParamsInput): void => {
    d.issues.push(makeIssue(severity, code, d.row.rowNumber, column, params));
  };
  const check = <T>(d: Draft, column: ImportColumnKey, work: (text: string) => T): T | undefined => {
    const text = d.row[column];
    if (text === '') {
      addIssue(d, 'ERROR', ImportIssueCodes.EXCEL_IMPORT_REQUIRED_VALUE, column);
      return undefined;
    }
    try {
      return work(text);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      addIssue(d, 'ERROR', error.code, column, (error.params ?? {}) as Params);
      return undefined;
    }
  };
  const addressChecks = new Map<string, Promise<string | undefined>>();
  const checkAddress = (text: string): Promise<string | undefined> => {
    let pending = addressChecks.get(text);
    if (!pending) {
      pending = directory.validateParentAddress(text, school.organizationId, tx).then(
        () => undefined,
        (error: unknown) => {
          if (error instanceof AppError) return JSON.stringify({ code: error.code, params: error.params ?? {} });
          throw error;
        },
      );
      addressChecks.set(text, pending);
    }
    return pending;
  };

  for (const d of drafts) {
    d.studentName = check(d, 'studentName', (t) => normalizeStudentName(t));
    d.nationalId = check(d, 'studentNationalId', (t) => normalizeNationalId(t));
    d.parentName = check(d, 'parentName', (t) => normalizeParentName(t));
    d.parentPhone = check(d, 'parentPhone', (t) => normalizePhone(t));
    d.groupName = check(d, 'groupName', (t) => normalizeGroupName(t));
    d.teacherName = check(d, 'teacherName', (t) => normalizeTeacherName(t));
    d.teacherPhone = check(d, 'teacherPhone', (t) => normalizePhone(t));
    d.learningMode = check(d, 'learningMode', (t) => {
      const v = parseLearningMode(t);
      if (!v) throw new AppError(ImportIssueCodes.EXCEL_IMPORT_INVALID_LEARNING_MODE, 'VALIDATION', undefined, { value: t });
      return v;
    });
    d.progression = check(d, 'progression', (t) => {
      const v = parseProgression(t);
      if (!v) throw new AppError(ImportIssueCodes.EXCEL_IMPORT_INVALID_PROGRESSION, 'VALIDATION', undefined, { value: t });
      return v;
    });
    d.startingSurah = check(d, 'startingSurah', (t) => {
      const v = parseStartingSurah(t);
      if (v === undefined) throw new AppError(ImportIssueCodes.EXCEL_IMPORT_INVALID_STARTING_SURAH, 'VALIDATION', undefined, { value: t });
      return v;
    });
    if (d.row.groupSchedule === '') d.scheduleValid = true;
    else {
      const { slots, problems } = parseScheduleCell(d.row.groupSchedule);
      for (const p of problems) addIssue(d, 'ERROR', p.code, 'groupSchedule', { entry: p.entry });
      d.slots = slots.map((s) => ({ day: s.day, startTime: s.startTime, endTime: s.endTime }));
      d.scheduleValid = problems.length === 0;
    }
    if (d.studentName && d.parentName && !studentNameMatchesParent(d.studentName, d.parentName)) addIssue(d, 'ERROR', 'STUDENT_NAME_PARENT_MISMATCH', 'studentName');
    // The address text must be accepted by Module 15 for the school's organization (the governorate must exist, a village needs a center...).
    const address = check(d, 'parentAddress', (t) => t);
    if (address !== undefined) {
      const failure = await checkAddress(address);
      if (failure) {
        const { code, params } = JSON.parse(failure) as { code: string; params: Params };
        addIssue(d, 'ERROR', code, 'parentAddress', params);
      } else d.parentAddress = address;
    }
  }

  // ------------------------------------------------------------------------------------------------ 2. conflicts between rows
  const byNationalId = new Map<string, Draft[]>();
  for (const d of drafts) if (d.nationalId) byNationalId.set(d.nationalId, [...(byNationalId.get(d.nationalId) ?? []), d]);
  for (const list of byNationalId.values()) {
    if (list.length < 2) continue;
    const rows = rowsText(list.map((d) => d.row.rowNumber));
    for (const d of list) addIssue(d, 'CONFLICT', ImportIssueCodes.EXCEL_IMPORT_DUPLICATE_NATIONAL_ID, 'studentNationalId', { rows });
  }

  // One phone is one person: every use of a phone (as Parent and/or Teacher) must carry the same name (Master Specification §34 and §21).
  interface PhoneUse {
    readonly draft: Draft;
    readonly role: 'PARENT' | 'TEACHER';
    readonly name: string;
  }
  const phoneUses = new Map<string, PhoneUse[]>();
  for (const d of drafts) {
    if (d.parentPhone && d.parentName) phoneUses.set(d.parentPhone, [...(phoneUses.get(d.parentPhone) ?? []), { draft: d, role: 'PARENT', name: d.parentName }]);
    if (d.teacherPhone && d.teacherName) phoneUses.set(d.teacherPhone, [...(phoneUses.get(d.teacherPhone) ?? []), { draft: d, role: 'TEACHER', name: d.teacherName }]);
  }
  for (const uses of phoneUses.values()) {
    const names = new Set(uses.map((u) => personNameKey(u.name)));
    const addresses = new Set(uses.filter((u) => u.role === 'PARENT').map((u) => (u.draft.parentAddress ?? '').toLowerCase()));
    if (names.size < 2 && addresses.size < 2) continue;
    const rows = rowsText([...new Set(uses.map((u) => u.draft.row.rowNumber))]);
    for (const u of uses) {
      if (u.role === 'PARENT') addIssue(u.draft, 'CONFLICT', ImportIssueCodes.EXCEL_IMPORT_PARENT_DATA_CONFLICT, 'parentPhone', { rows });
      else addIssue(u.draft, 'CONFLICT', ImportIssueCodes.EXCEL_IMPORT_TEACHER_DATA_CONFLICT, 'teacherPhone', { rows });
    }
  }

  const slotsSignature = (slots: readonly PreviewSlot[]): string => [...slots].map(slotKey).sort().join('|');
  const byGroup = new Map<string, Draft[]>();
  for (const d of drafts) if (d.groupName) byGroup.set(groupNameKey(d.groupName), [...(byGroup.get(groupNameKey(d.groupName)) ?? []), d]);
  for (const list of byGroup.values()) {
    const typed = list.filter((d) => d.teacherPhone && d.learningMode && d.progression && d.startingSurah !== undefined && d.scheduleValid);
    const signatures = new Set(typed.map((d) => `${d.teacherPhone}#${d.learningMode}#${d.progression}#${d.startingSurah}#${slotsSignature(d.slots)}`));
    if (signatures.size < 2) continue;
    const rows = rowsText(list.map((d) => d.row.rowNumber));
    for (const d of list) addIssue(d, 'CONFLICT', ImportIssueCodes.EXCEL_IMPORT_GROUP_ROWS_INCONSISTENT, 'groupName', { rows });
  }

  // ------------------------------------------------------------------------------------------------ 3. against the system
  const userCache = new Map<string, ReturnType<ImportDirectory['findUserByPhone']>>();
  const userOf = (phone: string) => {
    let p = userCache.get(phone);
    if (!p) {
      p = directory.findUserByPhone(phone, tx);
      userCache.set(phone, p);
    }
    return p;
  };

  // The same decisions as ParentService.registerParent / TeacherService.registerTeacher, read-only.
  const parentCache = new Map<string, Promise<PersonResolution>>();
  const resolveParent = (phone: string, name: string): Promise<PersonResolution> => {
    const key = `${phone}#${personNameKey(name)}`;
    let p = parentCache.get(key);
    if (!p) {
      p = (async (): Promise<PersonResolution> => {
        const user = await userOf(phone);
        if (!user) return { userExists: false };
        if (!user.isActive) return { userExists: true, userId: user.id, conflict: ImportIssueCodes.EXCEL_IMPORT_PARENT_ACCOUNT_INACTIVE };
        const parent = await directory.findParentByUserId(user.id, tx);
        if (parent && parent.organizationId !== school.organizationId) return { userExists: true, userId: user.id, conflict: ImportIssueCodes.EXCEL_IMPORT_PARENT_ORGANIZATION_CONFLICT };
        if (!isSameParentName(user.fullName, name)) return { userExists: true, userId: user.id, conflict: ImportIssueCodes.EXCEL_IMPORT_PARENT_NAME_CONFLICT };
        return { userExists: true, userId: user.id, ...(parent ? { recordId: parent.id } : {}) };
      })();
      parentCache.set(key, p);
    }
    return p;
  };
  const teacherCache = new Map<string, Promise<PersonResolution>>();
  const resolveTeacher = (phone: string, name: string): Promise<PersonResolution> => {
    const key = `${phone}#${personNameKey(name)}`;
    let p = teacherCache.get(key);
    if (!p) {
      p = (async (): Promise<PersonResolution> => {
        const user = await userOf(phone);
        if (!user) return { userExists: false };
        if (!user.isActive) return { userExists: true, userId: user.id, conflict: ImportIssueCodes.EXCEL_IMPORT_TEACHER_ACCOUNT_INACTIVE };
        if (!isSameTeacherName(user.fullName, name)) return { userExists: true, userId: user.id, conflict: ImportIssueCodes.EXCEL_IMPORT_TEACHER_NAME_CONFLICT };
        const teacher = await directory.findTeacherByUserId(user.id, tx);
        if (teacher) {
          if (teacher.organizationId !== school.organizationId) return { userExists: true, userId: user.id, conflict: ImportIssueCodes.EXCEL_IMPORT_TEACHER_ORGANIZATION_CONFLICT };
          return { userExists: true, userId: user.id, recordId: teacher.id };
        }
        const parent = await directory.findParentByUserId(user.id, tx);
        if (parent && parent.organizationId !== school.organizationId) return { userExists: true, userId: user.id, conflict: ImportIssueCodes.EXCEL_IMPORT_TEACHER_ORGANIZATION_CONFLICT };
        return { userExists: true, userId: user.id };
      })();
      teacherCache.set(key, p);
    }
    return p;
  };

  const parentOf = new Map<Draft, PersonResolution>();
  const teacherOf = new Map<Draft, PersonResolution>();
  for (const d of drafts) {
    if (d.parentPhone && d.parentName) {
      const r = await resolveParent(d.parentPhone, d.parentName);
      parentOf.set(d, r);
      if (r.conflict) addIssue(d, 'CONFLICT', r.conflict, 'parentPhone');
      else d.parentDecision = r.recordId ? 'EXISTING' : 'NEW';
    }
    if (d.teacherPhone && d.teacherName) {
      const r = await resolveTeacher(d.teacherPhone, d.teacherName);
      teacherOf.set(d, r);
      if (r.conflict) addIssue(d, 'CONFLICT', r.conflict, 'teacherPhone');
      else d.teacherDecision = r.recordId ? 'EXISTING' : 'NEW';
    }
  }

  // Groups: an existing ACTIVE group of the school with this name is reused only when EVERYTHING in the file matches it.
  const groupCache = new Map<string, Promise<{ existing: Awaited<ReturnType<ImportDirectory['findActiveGroupByName']>>; slots: string }>>();
  const groupOf = (name: string) => {
    const key = groupNameKey(name);
    let p = groupCache.get(key);
    if (!p) {
      p = (async () => {
        const existing = await directory.findActiveGroupByName(school.id, name, tx);
        const slots = existing ? slotsSignature((await directory.listSlotsOfGroup(existing.id, tx)).map((s) => ({ day: s.day as PreviewSlot['day'], startTime: s.startTime, endTime: s.endTime }))) : '';
        return { existing, slots };
      })();
      groupCache.set(key, p);
    }
    return p;
  };
  const existingGroupId = new Map<Draft, string>();
  for (const d of drafts) {
    if (!d.groupName) continue;
    const { existing, slots } = await groupOf(d.groupName);
    if (!existing) {
      d.groupDecision = 'NEW';
      continue;
    }
    d.groupDecision = 'EXISTING';
    existingGroupId.set(d, existing.id);
    const teacher = teacherOf.get(d);
    if (teacher && !teacher.conflict && teacher.recordId !== existing.teacherId) addIssue(d, 'CONFLICT', ImportIssueCodes.EXCEL_IMPORT_GROUP_TEACHER_CONFLICT, 'groupName');
    if (d.learningMode && d.progression && d.startingSurah !== undefined && (existing.learningMode !== d.learningMode || existing.progression !== d.progression || existing.startingSurah !== d.startingSurah)) {
      addIssue(d, 'CONFLICT', ImportIssueCodes.EXCEL_IMPORT_GROUP_SETTINGS_CONFLICT, 'groupName');
    }
    // An empty schedule cell leaves an existing group alone; a filled one must be exactly its current schedule.
    if (d.scheduleValid && d.row.groupSchedule !== '' && slotsSignature(d.slots) !== slots) addIssue(d, 'CONFLICT', ImportIssueCodes.EXCEL_IMPORT_GROUP_SCHEDULE_CONFLICT, 'groupSchedule');
  }

  // Students: the National ID is the trusted identifier; an existing student is NEVER moved, replaced or re-parented.
  const studentCache = new Map<string, Promise<{ student: Awaited<ReturnType<ImportDirectory['findStudentByNationalId']>>; group: { id: string; name: string | null } | undefined }>>();
  const studentOf = (nationalId: string) => {
    let p = studentCache.get(nationalId);
    if (!p) {
      p = (async () => {
        const student = await directory.findStudentByNationalId(nationalId, tx);
        return { student, group: student ? await directory.currentGroupOfStudent(student.id, tx) : undefined };
      })();
      studentCache.set(nationalId, p);
    }
    return p;
  };
  for (const d of drafts) {
    if (!d.nationalId) continue;
    const { student, group } = await studentOf(d.nationalId);
    if (!student) {
      d.studentDecision = 'NEW';
      continue;
    }
    d.studentDecision = 'EXISTING';
    const parent = parentOf.get(d);
    if (student.schoolId !== school.id) addIssue(d, 'CONFLICT', ImportIssueCodes.EXCEL_IMPORT_STUDENT_OTHER_SCHOOL, 'studentNationalId');
    else if (parent && !parent.conflict && parent.recordId !== student.parentId) addIssue(d, 'CONFLICT', ImportIssueCodes.EXCEL_IMPORT_STUDENT_PARENT_CONFLICT, 'studentNationalId');
    else if (student.status !== 'ACTIVE') addIssue(d, 'CONFLICT', ImportIssueCodes.EXCEL_IMPORT_STUDENT_NOT_ACTIVE, 'studentNationalId');
    else if (group) {
      if (existingGroupId.get(d) === group.id) addIssue(d, 'WARNING', ImportIssueCodes.EXCEL_IMPORT_STUDENT_ALREADY_IN_GROUP, 'studentNationalId');
      else addIssue(d, 'CONFLICT', ImportIssueCodes.EXCEL_IMPORT_STUDENT_IN_OTHER_GROUP, 'studentNationalId', { group: group.name ?? '' });
    }
  }

  // Teacher schedule conflicts (§35): the new groups' slots against the same Teacher's slots in the file and in EVERY school.
  interface NewGroupSlots {
    readonly key: string;
    readonly teacherPhone: string;
    readonly teacherUserId: string | undefined;
    readonly slots: readonly PreviewSlot[];
    readonly drafts: Draft[];
  }
  const newGroups = new Map<string, NewGroupSlots>();
  for (const d of drafts) {
    if (d.groupDecision !== 'NEW' || !d.groupName || !d.teacherPhone || !d.scheduleValid || d.slots.length === 0) continue;
    const key = groupNameKey(d.groupName);
    const entry = newGroups.get(key);
    if (entry) entry.drafts.push(d);
    else newGroups.set(key, { key, teacherPhone: d.teacherPhone, teacherUserId: teacherOf.get(d)?.userId, slots: d.slots, drafts: [d] });
  }
  const teacherSlotsCache = new Map<string, ReturnType<ImportDirectory['listSlotsOfTeacher']>>();
  const existingSlotsOf = (userId: string) => {
    let p = teacherSlotsCache.get(userId);
    if (!p) {
      p = directory.listSlotsOfTeacher(userId, tx);
      teacherSlotsCache.set(userId, p);
    }
    return p;
  };
  const range = (s: PreviewSlot) => ({ startMinute: Number(s.startTime.slice(0, 2)) * 60 + Number(s.startTime.slice(3)), endMinute: Number(s.endTime.slice(0, 2)) * 60 + Number(s.endTime.slice(3)) });
  const slotText = (s: { day: string; startTime: string; endTime: string }, language: ImportLanguage): string => `${DAY_LABELS[s.day as PreviewSlot['day']]?.[language] ?? s.day} ${s.startTime}-${s.endTime}`;
  const conflictOnDrafts = (list: readonly Draft[], mine: PreviewSlot, other: { day: string; startTime: string; endTime: string }, otherName: string): void => {
    for (const d of list) {
      addIssue(d, 'CONFLICT', ImportIssueCodes.EXCEL_IMPORT_TEACHER_SCHEDULE_CONFLICT, 'groupSchedule', (language) => ({ slot: slotText(mine, language), other: `${otherName} ${slotText(other, language)}`.trim() }));
    }
  };
  const groups = [...newGroups.values()];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]!;
    for (let j = i + 1; j < groups.length; j++) {
      const h = groups[j]!;
      if (h.teacherPhone !== g.teacherPhone) continue;
      for (const a of g.slots) for (const b of h.slots) {
        if (a.day === b.day && slotsOverlap(range(a), range(b))) {
          conflictOnDrafts(g.drafts, a, b, h.drafts[0]!.groupName ?? '');
          conflictOnDrafts(h.drafts, b, a, g.drafts[0]!.groupName ?? '');
        }
      }
    }
    if (g.teacherUserId) {
      for (const existing of await existingSlotsOf(g.teacherUserId)) {
        for (const a of g.slots) {
          if (a.day === existing.day && slotsOverlap(range(a), range({ day: a.day, startTime: existing.startTime, endTime: existing.endTime }))) conflictOnDrafts(g.drafts, a, existing, existing.groupName);
        }
      }
    }
  }

  // ------------------------------------------------------------------------------------------------ result
  const statusOf = (issues: readonly ImportIssue[]): RowStatus =>
    issues.some((i) => i.severity === 'ERROR') ? 'ERROR' : issues.some((i) => i.severity === 'CONFLICT') ? 'CONFLICT' : issues.some((i) => i.severity === 'WARNING') ? 'WARNING' : 'OK';
  const rows: AnalyzedRow[] = drafts.map((d) => ({
    rowNumber: d.row.rowNumber,
    status: statusOf(d.issues),
    student: { name: d.studentName ?? d.row.studentName, nationalId: d.nationalId ?? d.row.studentNationalId, decision: d.studentDecision },
    parent: { name: d.parentName ?? d.row.parentName, phone: d.parentPhone ?? d.row.parentPhone, address: d.parentAddress ?? d.row.parentAddress, decision: d.parentDecision },
    teacher: { name: d.teacherName ?? d.row.teacherName, phone: d.teacherPhone ?? d.row.teacherPhone, decision: d.teacherDecision },
    group: {
      name: d.groupName ?? d.row.groupName,
      decision: d.groupDecision,
      learningMode: d.learningMode ?? null,
      progression: d.progression ?? null,
      startingSurah: d.startingSurah ?? null,
      schedule: { slots: d.slots, display: { ar: describeSlots(d.slots, 'ar'), en: describeSlots(d.slots, 'en') } },
    },
    issues: d.issues,
  }));
  const issues: ImportIssue[] = [...fileIssues, ...drafts.flatMap((d) => d.issues)];
  const blocking = issues.filter((i) => isBlocking(i.severity)).length;

  const distinct = <T>(items: readonly (T | undefined)[]): Set<T> => new Set(items.filter((x): x is T => x !== undefined));
  const phoneUser = new Map<string, boolean>();
  for (const d of drafts) {
    if (d.parentPhone && parentOf.get(d)) phoneUser.set(d.parentPhone, parentOf.get(d)!.userExists);
    if (d.teacherPhone && teacherOf.get(d)) phoneUser.set(d.teacherPhone, teacherOf.get(d)!.userExists);
  }
  const countBy = (pick: (d: Draft) => [string | undefined, EntityDecision | null], decision: EntityDecision): number =>
    distinct(drafts.map((d) => { const [key, dec] = pick(d); return dec === decision ? key : undefined; })).size;
  const summary: PreviewSummary = {
    totalRows: rows.length,
    rowsOk: rows.filter((r) => r.status === 'OK').length,
    rowsWithWarnings: rows.filter((r) => r.status === 'WARNING').length,
    rowsWithErrors: rows.filter((r) => r.status === 'ERROR').length,
    rowsWithConflicts: rows.filter((r) => r.status === 'CONFLICT').length,
    newUsers: [...phoneUser.values()].filter((exists) => !exists).length,
    existingUsers: [...phoneUser.values()].filter((exists) => exists).length,
    newStudents: countBy((d) => [d.nationalId, d.studentDecision], 'NEW'),
    existingStudents: countBy((d) => [d.nationalId, d.studentDecision], 'EXISTING'),
    newParents: countBy((d) => [d.parentPhone, d.parentDecision], 'NEW'),
    existingParents: countBy((d) => [d.parentPhone, d.parentDecision], 'EXISTING'),
    newTeachers: countBy((d) => [d.teacherPhone, d.teacherDecision], 'NEW'),
    existingTeachers: countBy((d) => [d.teacherPhone, d.teacherDecision], 'EXISTING'),
    newGroups: countBy((d) => [d.groupName ? groupNameKey(d.groupName) : undefined, d.groupDecision], 'NEW'),
    existingGroups: countBy((d) => [d.groupName ? groupNameKey(d.groupName) : undefined, d.groupDecision], 'EXISTING'),
    errors: issues.filter((i) => i.severity === 'ERROR').length,
    conflicts: issues.filter((i) => i.severity === 'CONFLICT').length,
    warnings: issues.filter((i) => i.severity === 'WARNING').length,
  };

  const plan: PlannedRow[] = [];
  for (const d of drafts) {
    if (d.studentName && d.nationalId && d.parentName && d.parentPhone && d.parentAddress && d.groupName && d.teacherName && d.teacherPhone && d.learningMode && d.progression && d.startingSurah !== undefined && d.scheduleValid) {
      plan.push({
        rowNumber: d.row.rowNumber,
        studentName: d.studentName,
        nationalId: d.nationalId,
        parentName: d.parentName,
        parentPhone: d.parentPhone,
        parentAddress: d.parentAddress,
        groupName: d.groupName,
        teacherName: d.teacherName,
        teacherPhone: d.teacherPhone,
        learningMode: d.learningMode,
        progression: d.progression,
        startingSurah: d.startingSurah,
        slots: d.slots,
      });
    }
  }
  return { analysis: { summary, rows, issues, blocking, canConfirm: blocking === 0 && rows.length > 0 }, plan };
}
