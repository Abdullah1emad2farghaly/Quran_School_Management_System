import { Workbook } from 'exceljs';
import { MAX_EXCEL_ROWS } from '../../../07-file-infrastructure/public';
import { IMPORT_COLUMNS, type ImportLanguage } from '../../domain/value-objects/import-columns';
import { DAY_LABELS } from '../../domain/value-objects/schedule-cell';
import type { WorkbookWriter } from '../../application/ports/workbook';
import { DAYS_OF_WEEK } from '../../../23-group-schedules/public';

interface Texts {
  readonly dataSheet: string;
  readonly helpSheet: string;
  readonly title: string;
  readonly intro: readonly string[];
  readonly columnHeader: readonly [string, string, string, string];
  readonly yes: string;
  readonly no: string;
  readonly daysTitle: string;
  readonly modeList: string;
  readonly progressionList: string;
}

const TEXTS: Readonly<Record<ImportLanguage, Texts>> = {
  ar: {
    dataSheet: 'الاستيراد',
    helpSheet: 'التعليمات',
    title: 'تعليمات استيراد الطلاب والحلقات',
    intro: [
      'اكتب بيانات كل طالب في صف واحد تحت العناوين في ورقة «الاستيراد»، ولا تغيّر أسماء الأعمدة. الأعمدة المعلّمة بنجمة (*) إلزامية.',
      'يمكن أن يتكرر ولي الأمر والمعلم والحلقة في عدة صفوف بنفس البيانات تمامًا (أخ وأخت، أو عدة طلاب في حلقة واحدة).',
      `الحد الأقصى ${MAX_EXCEL_ROWS} صف وحجم الملف 10 ميجابايت. الملف بصيغة xlsx فقط.`,
      'بعد رفع الملف تظهر معاينة كاملة بما سيُنشأ وما سيُعاد استخدامه وبأي أخطاء أو تعارضات. لا يتم حفظ أي شيء قبل أن تؤكد.',
      'الاستيراد «كله أو لا شيء»: إذا وُجد أي خطأ أو تعارض لا يمكن التأكيد، ولا يتم حفظ أي صف. المعاينة صالحة 24 ساعة.',
      'لا يتم أبدًا نقل طالب موجود إلى حلقة أخرى ولا تعديل حلقة أو حساب موجود: أي تعارض يظهر لك لتصحيحه.',
    ],
    columnHeader: ['العمود', 'إلزامي', 'الشرح', 'مثال'],
    yes: 'نعم',
    no: 'لا',
    daysTitle: 'أسماء الأيام المقبولة في جدول الحلقة',
    modeList: '"جماعي,فردي"',
    progressionList: '"للأمام,للخلف"',
  },
  en: {
    dataSheet: 'Import',
    helpSheet: 'Instructions',
    title: 'Students and groups import: instructions',
    intro: [
      'Write each student on one row under the headers of the "Import" sheet, and keep the column names. Columns marked with an asterisk (*) are required.',
      'A parent, a teacher or a group may repeat on several rows with exactly the same data (siblings, or several students in one group).',
      `At most ${MAX_EXCEL_ROWS} rows and 10 MB. .xlsx files only.`,
      'After the upload you get a full preview of what will be created, what will be reused, and any errors or conflicts. Nothing is saved before you confirm.',
      'The import is all-or-nothing: with any error or conflict it cannot be confirmed and no row is saved. The preview is valid for 24 hours.',
      'An existing student is never moved to another group and an existing group or account is never changed: any conflict is shown so you can correct it.',
    ],
    columnHeader: ['Column', 'Required', 'Description', 'Example'],
    yes: 'Yes',
    no: 'No',
    daysTitle: 'Accepted weekday names in the Group Schedule column',
    modeList: '"GROUP,INDIVIDUAL"',
    progressionList: '"FORWARD,BACKWARD"',
  },
};

/** ExcelJS implementation of the template writer: headers in the requested language, text-formatted phone/ID columns, drop-downs, and an instruction sheet. */
export class ExcelJsWorkbookWriter implements WorkbookWriter {
  async buildTemplate(language: ImportLanguage): Promise<Buffer> {
    const t = TEXTS[language];
    const rtl = language === 'ar';
    const workbook = new Workbook();
    workbook.creator = 'QSMS';

    const data = workbook.addWorksheet(t.dataSheet, { views: [{ rightToLeft: rtl, state: 'frozen', ySplit: 1 }] });
    data.columns = IMPORT_COLUMNS.map((c) => ({
      header: `${c.header[language]}${c.required ? ' *' : ''}`,
      key: c.key,
      width: c.key === 'groupSchedule' || c.key === 'parentAddress' ? 38 : 26,
      // Phone numbers and National IDs are text so Excel keeps the leading zero and every digit.
      style: c.text ? { numFmt: '@', alignment: { horizontal: rtl ? 'right' : 'left' } } : { alignment: { horizontal: rtl ? 'right' : 'left' } },
    }));
    const header = data.getRow(1);
    header.font = { bold: true };
    header.alignment = { vertical: 'middle', horizontal: rtl ? 'right' : 'left', wrapText: true };
    header.height = 32;
    const last = MAX_EXCEL_ROWS + 1;
    const columnLetter = (key: string): string => String.fromCharCode(65 + IMPORT_COLUMNS.findIndex((c) => c.key === key));
    // ExcelJS 4.x has `worksheet.dataValidations` at runtime, but its published typings do not declare it.
    const validations = (data as unknown as { dataValidations: { add(address: string, validation: unknown): void } }).dataValidations;
    validations.add(`${columnLetter('learningMode')}2:${columnLetter('learningMode')}${last}`, { type: 'list', allowBlank: true, formulae: [t.modeList] });
    validations.add(`${columnLetter('progression')}2:${columnLetter('progression')}${last}`, { type: 'list', allowBlank: true, formulae: [t.progressionList] });

    const help = workbook.addWorksheet(t.helpSheet, { views: [{ rightToLeft: rtl }] });
    help.getColumn(1).width = 28;
    help.getColumn(2).width = 12;
    help.getColumn(3).width = 90;
    help.getColumn(4).width = 38;
    help.addRow([t.title]).font = { bold: true, size: 14 };
    help.addRow([]);
    for (const line of t.intro) help.addRow([line]);
    help.addRow([]);
    const head = help.addRow([...t.columnHeader]);
    head.font = { bold: true };
    for (const c of IMPORT_COLUMNS) help.addRow([c.header[language], c.required ? t.yes : t.no, c.help[language], c.example[language]]);
    help.addRow([]);
    help.addRow([t.daysTitle]).font = { bold: true };
    for (const day of DAYS_OF_WEEK) help.addRow([DAY_LABELS[day].ar, DAY_LABELS[day].en, day.slice(0, 3)]);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer as ArrayBuffer);
  }
}
