import type { ErrorMessageEntry } from '../../../03-error-localization/public';
import { SchoolErrorCodes } from '../../domain/errors/school-errors';

export const SCHOOL_ERROR_MESSAGES: readonly ErrorMessageEntry[] = [
  { code: SchoolErrorCodes.INVALID_SCHOOL_NAME, message: { ar: 'اسم المدرسة غير صالح: مطلوب ولا يتجاوز 200 حرف.', en: 'The school name is not valid: it is required and at most 200 characters.' } },
  { code: SchoolErrorCodes.INVALID_GPS_COORDINATES, message: { ar: 'إحداثيات GPS غير صالحة.', en: 'The GPS coordinates are not valid.' } },
  { code: SchoolErrorCodes.GPS_ACCURACY_EXCEEDS_LIMIT, message: { ar: 'دقة GPS أسوأ من 20 مترًا؛ حاول مرة أخرى في مكان مكشوف.', en: 'The GPS accuracy is worse than 20 metres; try again in an open area.' } },
  { code: SchoolErrorCodes.INVALID_REJECTION_REASON, message: { ar: 'سبب الرفض مطلوب ولا يتجاوز 500 حرف.', en: 'A rejection reason is required (at most 500 characters).' } },
  { code: SchoolErrorCodes.SCHOOL_NOT_FOUND, message: { ar: 'المدرسة غير موجودة.', en: 'The school was not found.' } },
  { code: SchoolErrorCodes.SCHOOL_NAME_ALREADY_EXISTS, message: { ar: 'يوجد مدرسة بنفس الاسم في هذه المؤسسة.', en: 'A school with this name already exists in the organization.' } },
  { code: SchoolErrorCodes.SCHOOL_ORGANIZATION_INACTIVE, message: { ar: 'المؤسسة غير نشطة ولا يمكن إنشاء مدارس تحتها.', en: 'The organization is inactive; schools cannot be created under it.' } },
  { code: SchoolErrorCodes.SCHOOL_PARENT_INVALID, message: { ar: 'المدرسة الأم يجب أن تكون مدرسة رئيسية نشطة.', en: 'The parent must be an active main school.' } },
  { code: SchoolErrorCodes.SCHOOL_INVALID_STATUS_TRANSITION, message: { ar: 'لا يمكن تغيير حالة المدرسة بهذه الطريقة.', en: 'The school status cannot be changed this way.' } },
  { code: SchoolErrorCodes.SCHOOL_GPS_LOCKED, message: { ar: 'لا يمكن تعديل موقع المدرسة بعد الاعتماد.', en: 'The official school location cannot be changed after approval.' } },
  { code: SchoolErrorCodes.SCHOOL_MANAGER_NOT_ELIGIBLE, message: { ar: 'المستخدم غير مؤهل ليكون مدير مدرسة.', en: 'The user is not eligible to be a school manager.' } },
  { code: SchoolErrorCodes.SCHOOL_ACTION_NOT_ALLOWED, message: { ar: 'غير مصرح لك بتنفيذ هذا الإجراء.', en: 'You are not allowed to perform this action.' } },
  { code: SchoolErrorCodes.SCHOOL_NOT_ACTIVE, message: { ar: 'المدرسة غير نشطة.', en: 'The school is not active.' } },
  { code: SchoolErrorCodes.SCHOOL_ALREADY_HAS_MANAGER, message: { ar: 'للمدرسة مدير نشط بالفعل.', en: 'The school already has an active manager.' } },
  { code: SchoolErrorCodes.SCHOOL_MANAGER_ASSIGNMENT_NOT_FOUND, message: { ar: 'لا يوجد مدير نشط لهذه المدرسة.', en: 'The school has no active manager.' } },
  { code: SchoolErrorCodes.SCHOOL_COUNTRY_MISMATCH, message: { ar: 'دولة المدرسة يجب أن تكون دولة مؤسستها.', en: 'The school country must be the country of its organization.' } },
  { code: SchoolErrorCodes.INVALID_APPLICANT_NAME, message: { ar: 'اسم مقدم الطلب غير صالح: مطلوب ولا يتجاوز 200 حرف.', en: 'The applicant name is not valid: it is required and at most 200 characters.' } },
  { code: SchoolErrorCodes.SCHOOL_APPLICANT_IDENTITY_MISMATCH, message: { ar: 'رقم الهاتف لا يخص الحساب المسجّل به الدخول.', en: 'The phone number does not belong to the account you are logged in with.' } },
  { code: SchoolErrorCodes.SCHOOL_CONCURRENT_MODIFICATION, message: { ar: 'تم تعديل المدرسة بواسطة عملية أخرى؛ أعد المحاولة.', en: 'The school was changed by another operation; try again.' } },
];
