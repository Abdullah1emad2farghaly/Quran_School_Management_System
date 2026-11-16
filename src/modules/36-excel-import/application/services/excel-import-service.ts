import { AppError, SystemClock, newUuid, type Clock, type TransactionContext, type UnitOfWork } from '../../../00-shared-kernel/public';
import { defaultMessageCatalog } from '../../../03-error-localization/public';
import { MAX_EXCEL_ROWS, type FileService } from '../../../07-file-infrastructure/public';
import type { ParentService } from '../../../17-parents/public';
import type { TeacherService } from '../../../18-teachers/public';
import type { StudentService } from '../../../19-students/public';
import type { GroupService } from '../../../20-groups/public';
import type { GroupScheduleService } from '../../../23-group-schedules/public';
import type { ImportPreviewRecord, ImportResultSummary, ParsedImportRow, PlannedRow } from '../../domain/entities/import-types';
import { ImportErrorCodes, importError } from '../../domain/errors/import-errors';
import { cellText } from '../../domain/value-objects/cell-text';
import { IMPORT_COLUMN_KEYS, isImportLanguage, recognizeHeaders, COLUMN_BY_KEY, type ImportColumnKey, type ImportLanguage } from '../../domain/value-objects/import-columns';
import { groupNameKey } from '../../../20-groups/public';
import { toPreviewDto, DEFAULT_ROWS_PAGE, MAX_ROWS_PAGE_SIZE, type ImportPreviewDto, type ImportRowsPage } from '../dto/import-dto';
import type { ImportDirectory } from '../ports/import-directory';
import type { ImportPreviewRepository } from '../ports/import-preview-repository';
import type { WorkbookReader, WorkbookWriter } from '../ports/workbook';
import { analyzeImport } from './import-analyzer';

export const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;
/** How many sheet rows are searched for the header row (a title above the headers is tolerated). */
const HEADER_SEARCH_ROWS = 10;
const PURGE_BATCH = 200;

export interface ExcelImportServiceDeps {
  readonly previews: ImportPreviewRepository;
  readonly directory: ImportDirectory;
  readonly reader: WorkbookReader;
  readonly writer: WorkbookWriter;
  /** Module 07: validates (type, size, signature, unsafe content) and stores the uploaded file privately. */
  readonly files: Pick<FileService, 'saveExcel' | 'delete'>;
  readonly parents: Pick<ParentService, 'registerParent'>;
  readonly teachers: Pick<TeacherService, 'registerTeacher'>;
  readonly students: Pick<StudentService, 'registerStudent'>;
  readonly groups: Pick<GroupService, 'createGroup' | 'assignStudent'>;
  readonly schedules: Pick<GroupScheduleService, 'addSlot'>;
  readonly unitOfWork: UnitOfWork;
  readonly clock?: Clock;
  /** Overridable for tests only. */
  readonly previewTtlMs?: number;
  readonly maxRows?: number;
}

export interface CreatePreviewInput {
  readonly actorId: string;
  /** Already authorized by the Authorization Engine as a school the actor manages (derived server-side, never read from the sheet). */
  readonly schoolId: string;
  readonly fileName: string;
  readonly data: Buffer;
  /** The caller's language (account preference, then Accept-Language): used for the messages that name columns. */
  readonly language: ImportLanguage;
}

const EMPTY_RESULT: ImportResultSummary = {
  studentsCreated: 0, studentsReused: 0, parentsCreated: 0, parentsReused: 0, teachersCreated: 0, teachersReused: 0, groupsCreated: 0, groupsReused: 0, slotsCreated: 0, assignmentsCreated: 0,
};

/**
 * Public application contract of Module 36 (Excel Import), Master Specification §73-§79 and the decisions approved on 2026-11-10.
 *
 * It does NOT authorize its callers: routes use the Authorization Engine (`excel-import.*` permissions, school manager only, own school) first.
 * What it enforces itself:
 *  - the school is the one the caller was authorized for (the sheet has no school column and is never trusted for one);
 *  - upload -> validate (Module 07) -> parse -> ANALYZE ONLY (nothing is written) -> a server-side preview kept 24 hours, private to its creator;
 *  - confirmation is by preview id (no second upload) and is ALL-OR-NOTHING: a preview with any error or conflict can never be confirmed; the
 *    analysis is run again inside the commit transaction (the data may have changed), and any failure rolls everything back;
 *  - every write goes through the owning modules' public services (Parents 17, Teachers 18, Students 19, Groups 20, Schedules 23) with the
 *    SAME transaction, so their identity, uniqueness, schedule and history rules apply exactly as for manual registration; existing students,
 *    groups, accounts and memberships are never moved, merged or changed;
 *  - personal data in a preview is removed when it is confirmed, cancelled or expired.
 */
export class ExcelImportService {
  private readonly clock: Clock;

  constructor(private readonly deps: ExcelImportServiceDeps) {
    this.clock = deps.clock ?? new SystemClock();
  }

  // ---------------------------------------------------------------------------------------------- template

  async getTemplate(language: unknown): Promise<{ data: Buffer; fileName: string }> {
    if (!isImportLanguage(language)) throw importError(ImportErrorCodes.EXCEL_IMPORT_TEMPLATE_LANGUAGE_INVALID);
    const data = await this.deps.writer.buildTemplate(language);
    return { data, fileName: language === 'ar' ? 'قالب-استيراد-الطلاب.xlsx' : 'students-import-template.xlsx' };
  }

  // ---------------------------------------------------------------------------------------------- preview

  async createPreview(input: CreatePreviewInput): Promise<ImportPreviewDto> {
    const school = await this.deps.directory.findSchool(input.schoolId);
    if (!school || school.status !== 'ACTIVE') throw importError(ImportErrorCodes.EXCEL_IMPORT_SCHOOL_NOT_ACTIVE);
    await this.purgeExpired();

    const stored = await this.deps.files.saveExcel({ originalName: input.fileName, data: input.data, purpose: 'excel_import', ownerUserId: input.actorId });
    try {
      const { rows, unknownColumns } = await this.readRows(input.data, input.language);
      const { analysis } = await analyzeImport({ rows, unknownColumns, school, directory: this.deps.directory, language: input.language });
      const now = this.clock.now();
      const record: ImportPreviewRecord = {
        id: newUuid(),
        schoolId: school.id,
        organizationId: school.organizationId,
        createdBy: input.actorId,
        fileId: stored.id,
        originalName: input.fileName,
        language: input.language,
        status: 'PENDING',
        canConfirm: analysis.canConfirm,
        blocking: analysis.blocking,
        summary: analysis.summary,
        sourceRows: rows,
        analysis: { rows: analysis.rows, issues: analysis.issues },
        result: null,
        createdAt: now,
        expiresAt: new Date(now.getTime() + (this.deps.previewTtlMs ?? PREVIEW_TTL_MS)),
        decidedAt: null,
        decidedBy: null,
        version: 1,
      };
      await this.deps.unitOfWork.run((tx) => this.deps.previews.insert(record, tx));
      return toPreviewDto(record, DEFAULT_ROWS_PAGE, now);
    } catch (error) {
      await this.deps.files.delete(stored.id).catch(() => undefined);
      throw error;
    }
  }

  async getPreview(previewId: string, actorId: string, paging: Partial<ImportRowsPage> = {}): Promise<ImportPreviewDto> {
    const record = await this.requireOwn(await this.deps.previews.findById(previewId), actorId);
    this.assertNotExpired(record);
    const page = Math.max(1, Math.floor(paging.page ?? DEFAULT_ROWS_PAGE.page));
    const pageSize = Math.min(MAX_ROWS_PAGE_SIZE, Math.max(1, Math.floor(paging.pageSize ?? DEFAULT_ROWS_PAGE.pageSize)));
    return toPreviewDto(record, { page, pageSize }, this.clock.now());
  }

  async cancelPreview(previewId: string, actorId: string): Promise<ImportPreviewDto> {
    const { record, fileId } = await this.deps.unitOfWork.run(async (tx) => {
      const current = await this.requireOwn(await this.deps.previews.lockById(previewId, tx), actorId);
      this.assertNotExpired(current);
      if (current.status !== 'PENDING') throw importError(ImportErrorCodes.EXCEL_IMPORT_PREVIEW_NOT_PENDING);
      const next: ImportPreviewRecord = { ...current, status: 'CANCELLED', canConfirm: false, sourceRows: null, analysis: null, decidedAt: this.clock.now(), decidedBy: actorId, version: current.version + 1 };
      await this.deps.previews.update(next, tx);
      return { record: next, fileId: current.fileId };
    });
    if (fileId) await this.deps.files.delete(fileId).catch(() => undefined);
    return toPreviewDto(record, DEFAULT_ROWS_PAGE, this.clock.now());
  }

  // ---------------------------------------------------------------------------------------------- confirmation (all-or-nothing)

  async confirmPreview(previewId: string, actorId: string, language: ImportLanguage): Promise<ImportPreviewDto> {
    const record = await this.deps.unitOfWork.run(async (tx) => {
      const current = await this.requireOwn(await this.deps.previews.lockById(previewId, tx), actorId);
      this.assertNotExpired(current);
      if (current.status !== 'PENDING') throw importError(ImportErrorCodes.EXCEL_IMPORT_PREVIEW_NOT_PENDING);
      if (!current.canConfirm || !current.sourceRows) throw importError(ImportErrorCodes.EXCEL_IMPORT_CONFIRMATION_BLOCKED, { blocking: current.blocking });

      const school = await this.deps.directory.findSchool(current.schoolId, tx);
      if (!school || school.status !== 'ACTIVE') throw importError(ImportErrorCodes.EXCEL_IMPORT_SCHOOL_NOT_ACTIVE);
      // The data may have changed since the preview (24 hours): the same analysis runs again on the same rows, inside this transaction.
      const fresh = await analyzeImport({ rows: current.sourceRows, unknownColumns: [], school, directory: this.deps.directory, language: current.language, tx });
      if (!fresh.analysis.canConfirm) {
        throw importError(ImportErrorCodes.EXCEL_IMPORT_PREVIEW_STALE, { blocking: fresh.analysis.blocking }, { issues: fresh.analysis.issues.filter((i) => i.severity !== 'WARNING').slice(0, 50) });
      }
      const result = await this.execute(fresh.plan, school.id, actorId, language, tx);
      const next: ImportPreviewRecord = { ...current, status: 'CONFIRMED', canConfirm: false, sourceRows: null, analysis: null, result, decidedAt: this.clock.now(), decidedBy: actorId, version: current.version + 1 };
      await this.deps.previews.update(next, tx);
      return next;
    });
    return toPreviewDto(record, DEFAULT_ROWS_PAGE, this.clock.now());
  }

  /** Removes the personal data of previews whose 24 hours passed and deletes their stored files. Safe to call at any time. */
  async purgeExpired(): Promise<number> {
    const fileIds = await this.deps.unitOfWork.run((tx) => this.deps.previews.expireDue(this.clock.now(), PURGE_BATCH, tx));
    for (const id of fileIds) await this.deps.files.delete(id).catch(() => undefined);
    return fileIds.length;
  }

  /** What the Authorization Engine resolver needs (read from the server, never from the client). */
  async findScopeById(previewId: string): Promise<{ id: string; schoolId: string; createdBy: string } | undefined> {
    const record = await this.deps.previews.findById(previewId);
    return record ? { id: record.id, schoolId: record.schoolId, createdBy: record.createdBy } : undefined;
  }

  // ---------------------------------------------------------------------------------------------- internals

  private async requireOwn(record: ImportPreviewRecord | undefined, actorId: string): Promise<ImportPreviewRecord> {
    // The same neutral answer for "does not exist" and "belongs to someone else".
    if (!record || record.createdBy !== actorId) throw importError(ImportErrorCodes.EXCEL_IMPORT_PREVIEW_NOT_FOUND);
    return record;
  }

  private assertNotExpired(record: ImportPreviewRecord): void {
    if (record.status === 'EXPIRED' || (record.status === 'PENDING' && record.expiresAt.getTime() <= this.clock.now().getTime())) {
      throw importError(ImportErrorCodes.EXCEL_IMPORT_PREVIEW_EXPIRED);
    }
  }

  /** Finds the header row, checks the columns and returns every non-empty data row as text. */
  private async readRows(data: Buffer, language: ImportLanguage): Promise<{ rows: ParsedImportRow[]; unknownColumns: string[] }> {
    const sheet = await this.deps.reader.read(data);
    const candidates = sheet.rows.slice(0, HEADER_SEARCH_ROWS).map((r) => ({ row: r, recognition: recognizeHeaders(r.cells.map((c) => cellText(c))) }));
    const best = candidates.reduce<(typeof candidates)[number] | undefined>((a, b) => (!a || b.recognition.positions.size > a.recognition.positions.size ? b : a), undefined);
    if (!best || best.recognition.positions.size === 0) throw importError(ImportErrorCodes.EXCEL_IMPORT_HEADER_NOT_FOUND);
    const names = (keys: readonly ImportColumnKey[]): string => keys.map((k) => COLUMN_BY_KEY[k].header[language]).join(language === 'ar' ? '، ' : ', ');
    if (best.recognition.missing.length > 0) throw importError(ImportErrorCodes.EXCEL_IMPORT_MISSING_COLUMNS, { columns: names(best.recognition.missing) }, { columns: best.recognition.missing });
    if (best.recognition.duplicated.length > 0) throw importError(ImportErrorCodes.EXCEL_IMPORT_DUPLICATE_COLUMNS, { columns: names(best.recognition.duplicated) }, { columns: best.recognition.duplicated });

    const maxRows = this.deps.maxRows ?? MAX_EXCEL_ROWS;
    const rows: ParsedImportRow[] = [];
    for (const raw of sheet.rows) {
      if (raw.rowNumber <= best.row.rowNumber) continue;
      const entries = IMPORT_COLUMN_KEYS.map((key) => [key, cellText(raw.cells[best.recognition.positions.get(key) ?? -1])] as const);
      if (entries.every(([, text]) => text === '')) continue;
      if (rows.length >= maxRows) throw importError(ImportErrorCodes.EXCEL_IMPORT_TOO_MANY_ROWS, { max: maxRows });
      rows.push({ rowNumber: raw.rowNumber, ...Object.fromEntries(entries) } as ParsedImportRow);
    }
    if (rows.length === 0) throw importError(ImportErrorCodes.EXCEL_IMPORT_NO_ROWS);
    return { rows, unknownColumns: best.recognition.unknown.map((u) => u.text) };
  }

  /** Runs the plan through the owning modules' services in the caller's transaction. Any failure throws and the whole transaction rolls back. */
  private async execute(plan: readonly PlannedRow[], schoolId: string, actorId: string, language: ImportLanguage, tx: TransactionContext): Promise<ImportResultSummary> {
    const { directory, teachers, parents, students, groups, schedules } = this.deps;
    const result = { ...EMPTY_RESULT } as { -readonly [K in keyof ImportResultSummary]: number };
    const teacherIds = new Map<string, string>();
    const parentIds = new Map<string, string>();
    const groupIds = new Map<string, string>();

    for (const row of plan) {
      try {
        let teacherId = teacherIds.get(row.teacherPhone);
        if (!teacherId) {
          const user = await directory.findUserByPhone(row.teacherPhone, tx);
          const known = user ? await directory.findTeacherByUserId(user.id, tx) : undefined;
          if (known && (await directory.isTeacherLinked(known.id, schoolId, tx))) {
            teacherId = known.id;
            result.teachersReused++;
          } else {
            teacherId = (await teachers.registerTeacher({ schoolId, name: row.teacherName, phone: row.teacherPhone }, actorId, tx)).teacher.id;
            if (known) result.teachersReused++;
            else result.teachersCreated++;
          }
          teacherIds.set(row.teacherPhone, teacherId);
        }

        let parentId = parentIds.get(row.parentPhone);
        if (!parentId) {
          const user = await directory.findUserByPhone(row.parentPhone, tx);
          const known = user ? await directory.findParentByUserId(user.id, tx) : undefined;
          if (known && (await directory.isParentLinked(known.id, schoolId, tx))) {
            parentId = known.id;
            result.parentsReused++;
          } else {
            parentId = (await parents.registerParent({ schoolId, name: row.parentName, phone: row.parentPhone, address: { kind: 'raw', text: row.parentAddress } }, actorId, tx)).parent.id;
            if (known) result.parentsReused++;
            else result.parentsCreated++;
          }
          parentIds.set(row.parentPhone, parentId);
        }

        const key = groupNameKey(row.groupName);
        let groupId = groupIds.get(key);
        if (!groupId) {
          const existing = await directory.findActiveGroupByName(schoolId, row.groupName, tx);
          if (existing) {
            groupId = existing.id;
            result.groupsReused++;
          } else {
            groupId = (await groups.createGroup({ schoolId, name: row.groupName, learningMode: row.learningMode, progression: row.progression, startingSurah: row.startingSurah, teacherId }, actorId, tx)).id;
            result.groupsCreated++;
            for (const slot of row.slots) {
              await schedules.addSlot(groupId, { dayOfWeek: slot.day, startTime: slot.startTime, endTime: slot.endTime }, actorId, tx);
              result.slotsCreated++;
            }
          }
          groupIds.set(key, groupId);
        }

        const existingStudent = await directory.findStudentByNationalId(row.nationalId, tx);
        if (existingStudent) {
          const current = await directory.currentGroupOfStudent(existingStudent.id, tx);
          result.studentsReused++;
          if (!current) {
            await groups.assignStudent(groupId, existingStudent.id, actorId, tx);
            result.assignmentsCreated++;
          } else if (current.id !== groupId) {
            // Cannot happen after a clean analysis; never move a student.
            throw importError(ImportErrorCodes.EXCEL_IMPORT_PREVIEW_STALE, { blocking: 1 });
          }
        } else {
          const created = await students.registerStudent({ schoolId, parentId, fullName: row.studentName, nationalId: row.nationalId }, actorId, tx);
          result.studentsCreated++;
          await groups.assignStudent(groupId, created.id, actorId, tx);
          result.assignmentsCreated++;
        }
      } catch (error) {
        if (error instanceof AppError && error.code !== ImportErrorCodes.EXCEL_IMPORT_PREVIEW_STALE) {
          const reason = defaultMessageCatalog.message(error.code, language, error.params);
          throw importError(ImportErrorCodes.EXCEL_IMPORT_COMMIT_FAILED, { row: row.rowNumber, reason }, { row: row.rowNumber, cause: error.code });
        }
        throw error;
      }
    }
    return result;
  }
}

/** Read-only contract for other modules and the Authorization Engine resolver. */
export type ImportPreviewLookup = Pick<ExcelImportService, 'findScopeById'>;
