import { ExcelImportService, IMPORT_COLUMNS, InMemoryImportPreviewRepository, createServiceImportDirectory, registerImportAuthorization, type ExcelImportServiceDeps, type ImportLanguage, type WorkbookReader } from '../../src/modules/36-excel-import/public';
import { createSchedulesHarness } from './schedules-harness';

export const GROUP = 'حلقة الفجر';
let counter = 0;

/** A reader that understands a JSON "workbook" (`{ "rows": [[...cells]] }`): the real .xlsx parsing is covered by the ExcelJS tests. */
export class JsonWorkbookReader implements WorkbookReader {
  async read(data: Buffer) {
    const parsed = JSON.parse(data.toString('utf8')) as { rows: (string | number | null)[][] };
    return { rows: parsed.rows.map((cells, i) => ({ rowNumber: i + 1, cells })) };
  }
}

type Cells = Record<string, string>;

/** A valid row in Arabic (or English) with the column keys of the template; every call gets a fresh National ID and fresh phones unless overridden. */
export function validRow(language: ImportLanguage = 'ar', over: Cells = {}): Cells {
  counter += 1;
  const ar = language === 'ar';
  return {
    studentName: 'عمر أحمد محمد',
    studentNationalId: String(30001010000000 + counter),
    parentName: 'أحمد محمد علي',
    parentPhone: `0101111${String(counter).padStart(4, '0')}`,
    parentAddress: 'المنيا / سمالوط / برمشا',
    groupName: GROUP,
    teacherName: 'خالد أحمد حسن',
    teacherPhone: '01022220001',
    learningMode: ar ? 'جماعي' : 'GROUP',
    progression: ar ? 'للأمام' : 'FORWARD',
    startingSurah: '78',
    groupSchedule: '',
    ...over,
  };
}

/** A workbook buffer: a header row in the given language followed by the given rows (column order of the template). */
export function workbook(rows: Cells[], language: ImportLanguage = 'ar', opts: { headers?: string[]; extraHeader?: string } = {}): Buffer {
  const headers = opts.headers ?? [...IMPORT_COLUMNS.map((c) => `${c.header[language]}${c.required ? ' *' : ''}`), ...(opts.extraHeader ? [opts.extraHeader] : [])];
  const body = rows.map((r) => [...IMPORT_COLUMNS.map((c) => r[c.key] ?? ''), ...(opts.extraHeader ? ['x'] : [])]);
  return Buffer.from(JSON.stringify({ rows: [headers, ...body] }), 'utf8');
}

export interface FakeFiles {
  readonly saved: string[];
  readonly deleted: string[];
  saveExcel: (input: { originalName: string }) => Promise<{ id: string }>;
  delete: (id: string) => Promise<void>;
}

/** Module 36 over the REAL Parents, Teachers, Students, Groups and Schedules services, the real Authorization Engine and an in-memory preview store. */
export async function createExcelImportHarness(options: { maxRows?: number; previewTtlMs?: number; wrap?: (deps: ExcelImportServiceDeps) => ExcelImportServiceDeps } = {}) {
  const previews = new InMemoryImportPreviewRepository();
  const t = await createSchedulesHarness({ extraStores: [previews] });
  const files: FakeFiles = {
    saved: [],
    deleted: [],
    saveExcel: async () => {
      const id = `file-${files.saved.length + 1}`;
      files.saved.push(id);
      return { id };
    },
    delete: async (id) => {
      files.deleted.push(id);
    },
  };
  const directory = createServiceImportDirectory({
    schools: t.service,
    identity: t.h.identity,
    parents: t.parents,
    teachers: t.teachers,
    students: t.students,
    groups: t.groups,
    schedules: t.schedules,
    address: t.address,
  });
  const base: ExcelImportServiceDeps = {
    previews,
    directory,
    reader: new JsonWorkbookReader(),
    writer: { buildTemplate: async (language) => Buffer.from(`template-${language}`) },
    files: files as never,
    parents: t.parents,
    teachers: t.teachers,
    students: t.students,
    groups: t.groups,
    schedules: t.schedules,
    unitOfWork: t.unitOfWork,
    clock: t.h.clock,
    ...(options.maxRows ? { maxRows: options.maxRows } : {}),
    ...(options.previewTtlMs ? { previewTtlMs: options.previewTtlMs } : {}),
  };
  const importer = new ExcelImportService(options.wrap ? options.wrap(base) : base);
  registerImportAuthorization({ policies: t.policies, resolvers: t.resolvers, previews: importer, schools: t.service });

  const upload = (schoolId: string, actorId: string, data: Buffer, language: ImportLanguage = 'ar', fileName = 'students.xlsx') =>
    importer.createPreview({ actorId, schoolId, fileName, data, language });
  return { ...t, importer, previews, files, upload, directory };
}
