import { foldWord } from './cell-text';

/** The Excel columns of Master Specification §75, in their approved order. */
export const IMPORT_COLUMN_KEYS = [
  'studentName',
  'studentNationalId',
  'parentName',
  'parentPhone',
  'parentAddress',
  'groupName',
  'teacherName',
  'teacherPhone',
  'learningMode',
  'progression',
  'startingSurah',
  'groupSchedule',
] as const;
export type ImportColumnKey = (typeof IMPORT_COLUMN_KEYS)[number];
export type ImportLanguage = 'ar' | 'en';
export const IMPORT_LANGUAGES: readonly ImportLanguage[] = ['ar', 'en'];
export const isImportLanguage = (v: unknown): v is ImportLanguage => v === 'ar' || v === 'en';

export interface LocalizedPair {
  readonly ar: string;
  readonly en: string;
}

export interface ImportColumn {
  readonly key: ImportColumnKey;
  /** §75: columns 1-11 are required; the Group Schedule (12) is optional. */
  readonly required: boolean;
  /** The header written in the downloadable template (the required mark `*` is added by the writer). */
  readonly header: LocalizedPair;
  /** Other header texts the importer recognizes (either language, with or without the `*`). */
  readonly aliases: readonly string[];
  /** Column help shown on the template's instruction sheet. */
  readonly help: LocalizedPair;
  /** A realistic example for the template's example row. */
  readonly example: LocalizedPair;
  /** Phone numbers and National IDs are stored as text so Excel never drops a leading zero or switches to scientific notation. */
  readonly text: boolean;
}

export const IMPORT_COLUMNS: readonly ImportColumn[] = [
  {
    key: 'studentName',
    required: true,
    header: { ar: 'اسم الطالب الكامل', en: 'Student Full Name' },
    aliases: ['اسم الطالب', 'Student Name'],
    help: {
      ar: 'ثلاثة أجزاء على الأقل. الجزء الثاني هو الاسم الأول لولي الأمر والجزء الثالث هو الاسم الثاني لولي الأمر.',
      en: 'At least three parts. The second part is the parent first name and the third part is the parent second name.',
    },
    example: { ar: 'عمر أحمد محمد', en: 'Omar Ahmed Mohamed' },
    text: false,
  },
  {
    key: 'studentNationalId',
    required: true,
    header: { ar: 'الرقم القومي للطالب', en: 'Student National ID' },
    aliases: ['الرقم القومي', 'National ID'],
    help: { ar: '14 رقمًا بالضبط (الأرقام العربية والإنجليزية مقبولة).', en: 'Exactly 14 digits (Arabic and English digits are accepted).' },
    example: { ar: '30001010123456', en: '30001010123456' },
    text: true,
  },
  {
    key: 'parentName',
    required: true,
    header: { ar: 'اسم ولي الأمر الكامل', en: 'Parent Full Name' },
    aliases: ['اسم ولي الأمر', 'Parent Name'],
    help: { ar: 'ثلاثة أجزاء بالضبط.', en: 'Exactly three parts.' },
    example: { ar: 'أحمد محمد علي', en: 'Ahmed Mohamed Ali' },
    text: false,
  },
  {
    key: 'parentPhone',
    required: true,
    header: { ar: 'هاتف ولي الأمر', en: 'Parent Phone' },
    aliases: ['رقم هاتف ولي الأمر', 'Parent Phone Number'],
    help: { ar: 'رقم الهاتف المحمول (مثال: 01012345678).', en: 'Mobile phone number (example: 01012345678).' },
    example: { ar: '01012345678', en: '01012345678' },
    text: true,
  },
  {
    key: 'parentAddress',
    required: true,
    header: { ar: 'عنوان ولي الأمر', en: 'Parent Address' },
    aliases: ['العنوان', 'Address'],
    help: {
      ar: 'خلية واحدة بالصيغة: المحافظة / المركز أو المدينة / القرية. المحافظة إلزامية والباقي اختياري (القرية تحتاج مركزًا).',
      en: 'One cell in the format: Governorate / Center or City / Village. The governorate is required; the rest is optional (a village needs a center).',
    },
    example: { ar: 'المنيا / سمالوط / برمشا', en: 'المنيا / سمالوط / برمشا' },
    text: false,
  },
  {
    key: 'groupName',
    required: true,
    header: { ar: 'اسم الحلقة', en: 'Group Name' },
    aliases: ['الحلقة', 'Group'],
    help: { ar: 'اسم الحلقة داخل المدرسة (من 1 إلى 200 حرف).', en: 'The group name inside the school (1 to 200 characters).' },
    example: { ar: 'حلقة الفجر', en: 'Fajr Circle' },
    text: false,
  },
  {
    key: 'teacherName',
    required: true,
    header: { ar: 'اسم المعلم', en: 'Teacher Name' },
    aliases: ['اسم المعلم الكامل', 'Teacher Full Name'],
    help: { ar: 'ثلاثة أجزاء بالضبط.', en: 'Exactly three parts.' },
    example: { ar: 'خالد أحمد حسن', en: 'Khaled Ahmed Hassan' },
    text: false,
  },
  {
    key: 'teacherPhone',
    required: true,
    header: { ar: 'هاتف المعلم', en: 'Teacher Phone' },
    aliases: ['رقم هاتف المعلم', 'Teacher Phone Number'],
    help: { ar: 'رقم الهاتف المحمول (مثال: 01098765432).', en: 'Mobile phone number (example: 01098765432).' },
    example: { ar: '01098765432', en: '01098765432' },
    text: true,
  },
  {
    key: 'learningMode',
    required: true,
    header: { ar: 'نمط التعلم', en: 'Learning Mode' },
    aliases: ['نمط التعلّم', 'Mode'],
    help: { ar: 'القيم المقبولة: جماعي أو فردي (GROUP أو INDIVIDUAL).', en: 'Accepted values: GROUP or INDIVIDUAL (Arabic: جماعي / فردي).' },
    example: { ar: 'جماعي', en: 'GROUP' },
    text: false,
  },
  {
    key: 'progression',
    required: true,
    header: { ar: 'اتجاه التقدم', en: 'Progression Direction' },
    aliases: ['اتجاه التقدّم', 'Progression'],
    help: { ar: 'القيم المقبولة: للأمام أو للخلف (FORWARD أو BACKWARD).', en: 'Accepted values: FORWARD or BACKWARD (Arabic: للأمام / للخلف).' },
    example: { ar: 'للأمام', en: 'FORWARD' },
    text: false,
  },
  {
    key: 'startingSurah',
    required: true,
    header: { ar: 'سورة البداية', en: 'Starting Surah' },
    aliases: ['السورة المبدوء بها', 'Starting Surah Number'],
    help: { ar: 'رقم السورة: عدد صحيح من 1 إلى 114.', en: 'The surah number: a whole number from 1 to 114.' },
    example: { ar: '78', en: '78' },
    text: false,
  },
  {
    key: 'groupSchedule',
    required: false,
    header: { ar: 'جدول الحلقة', en: 'Group Schedule' },
    aliases: ['الجدول', 'Schedule'],
    help: {
      ar: 'اختياري. موعد واحد على الأكثر لكل يوم، بالصيغة: اليوم ساعة-ساعة، وتُفصل المواعيد بـ ؛ مثال: السبت 16:00-17:00؛ الاثنين 16:00-17:00. اتركها فارغة بدون جدول.',
      en: 'Optional. At most one slot per weekday, in the format: DAY HH:MM-HH:MM, slots separated by ; Example: SAT 16:00-17:00; MON 16:00-17:00. Leave empty for no schedule.',
    },
    example: { ar: 'السبت 16:00-17:00؛ الاثنين 16:00-17:00', en: 'SAT 16:00-17:00; MON 16:00-17:00' },
    text: false,
  },
];

export const COLUMN_BY_KEY: Readonly<Record<ImportColumnKey, ImportColumn>> = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c.key, c])) as Record<ImportColumnKey, ImportColumn>;

/** Every recognized header text (folded) -> its column. The template headers of BOTH languages and the aliases are accepted in either template. */
const HEADER_INDEX: ReadonlyMap<string, ImportColumnKey> = (() => {
  const map = new Map<string, ImportColumnKey>();
  for (const c of IMPORT_COLUMNS) for (const text of [c.header.ar, c.header.en, ...c.aliases]) map.set(foldWord(text), c.key);
  return map;
})();

export const recognizeHeader = (text: string): ImportColumnKey | undefined => HEADER_INDEX.get(foldWord(text));

export interface HeaderRecognition {
  /** Column index (0-based position in the row) of every recognized column. */
  readonly positions: ReadonlyMap<ImportColumnKey, number>;
  /** Header cells that are not part of the template (ignored, reported as warnings). */
  readonly unknown: readonly { readonly position: number; readonly text: string }[];
  /** Columns that appear more than once (blocking). */
  readonly duplicated: readonly ImportColumnKey[];
  /** Required columns that are absent (blocking). */
  readonly missing: readonly ImportColumnKey[];
}

export function recognizeHeaders(cells: readonly string[]): HeaderRecognition {
  const positions = new Map<ImportColumnKey, number>();
  const unknown: { position: number; text: string }[] = [];
  const duplicated = new Set<ImportColumnKey>();
  cells.forEach((text, position) => {
    if (text === '') return;
    const key = recognizeHeader(text);
    if (!key) unknown.push({ position, text });
    else if (positions.has(key)) duplicated.add(key);
    else positions.set(key, position);
  });
  const missing = IMPORT_COLUMNS.filter((c) => c.required && !positions.has(c.key)).map((c) => c.key);
  return { positions, unknown, duplicated: [...duplicated], missing };
}
