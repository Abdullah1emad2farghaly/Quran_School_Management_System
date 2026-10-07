import type { ErrorMessageEntry } from '../../../03-error-localization/public';
import { FileErrorCodes } from '../../domain/errors/file-errors';

export const FILE_ERROR_MESSAGES: readonly ErrorMessageEntry[] = [
  { code: FileErrorCodes.FILE_EMPTY, message: { ar: 'الملف فارغ.', en: 'The file is empty.' } },
  {
    code: FileErrorCodes.FILE_TOO_LARGE,
    message: { ar: 'حجم الملف أكبر من الحد المسموح ({maxMb} ميغابايت).', en: 'The file is larger than the allowed limit ({maxMb} MB).' },
  },
  {
    code: FileErrorCodes.FILE_TYPE_NOT_ALLOWED,
    message: { ar: 'نوع الملف غير مسموح. المسموح فقط ملفات Excel بصيغة xlsx.', en: 'File type not allowed. Only Excel .xlsx files are accepted.' },
  },
  { code: FileErrorCodes.FILE_CORRUPT, message: { ar: 'الملف تالف أو ليس ملف Excel صالحًا.', en: 'The file is corrupt or not a valid Excel file.' } },
  {
    code: FileErrorCodes.FILE_UNSAFE_CONTENT,
    message: { ar: 'يحتوي الملف على محتوى غير مسموح (مثل وحدات الماكرو أو الكائنات المضمنة).', en: 'The file contains disallowed content (such as macros or embedded objects).' },
  },
  { code: FileErrorCodes.FILE_NOT_FOUND, message: { ar: 'الملف غير موجود.', en: 'The file was not found.' } },
  { code: FileErrorCodes.FILE_INTEGRITY_FAILED, message: { ar: 'تعذّر التحقق من سلامة الملف.', en: 'File integrity check failed.' } },
];
