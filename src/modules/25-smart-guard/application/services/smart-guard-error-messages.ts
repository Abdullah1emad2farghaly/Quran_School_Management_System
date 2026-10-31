import type { ErrorMessageEntry } from '../../../03-error-localization/public';
import { SmartGuardErrorCodes } from '../../domain/errors/smart-guard-errors';

export const SMART_GUARD_ERROR_MESSAGES: readonly ErrorMessageEntry[] = [
  { code: SmartGuardErrorCodes.SMART_GUARD_NOT_SESSION_TEACHER, message: { ar: 'هذا الإجراء متاح فقط للمعلم المكلّف بالجلسة.', en: 'This action is only available to the Teacher assigned to the session.' } },
  { code: SmartGuardErrorCodes.SMART_GUARD_OUTSIDE_SESSION_WINDOW, message: { ar: 'هذا الإجراء متاح فقط من 15 دقيقة قبل بدء الجلسة حتى نهايتها.', en: 'This action is only available from 15 minutes before the session starts until it ends.' } },
  { code: SmartGuardErrorCodes.SMART_GUARD_GPS_REQUIRED, message: { ar: 'يلزم تحديد الموقع (GPS) لتنفيذ هذا الإجراء. فعّل خدمة الموقع وأعد المحاولة.', en: 'Your GPS location is required for this action. Turn location on and try again.' } },
  { code: SmartGuardErrorCodes.SMART_GUARD_GPS_INVALID, message: { ar: 'بيانات الموقع (GPS) غير صالحة.', en: 'The GPS location data is not valid.' } },
  { code: SmartGuardErrorCodes.SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE, message: { ar: 'يجب أن تكون داخل نطاق المدرسة (على بعد {maxMeters} متر أو أقل) لتنفيذ هذا الإجراء.', en: 'You must be within {maxMeters} meters of the school to perform this action.' } },
  { code: SmartGuardErrorCodes.SMART_GUARD_GPS_ACCURACY_TOO_LOW, message: { ar: 'دقة تحديد الموقع غير كافية (الحد الأقصى {maxMeters} متر). انتظر حتى تتحسن الإشارة وأعد المحاولة.', en: 'The GPS accuracy is not good enough (maximum {maxMeters} meters). Wait for a better signal and try again.' } },
  { code: SmartGuardErrorCodes.SMART_GUARD_SESSION_CANCELLED, message: { ar: 'الجلسة ملغاة.', en: 'The session is cancelled.' } },
  { code: SmartGuardErrorCodes.SMART_GUARD_SCHOOL_NOT_ACTIVE, message: { ar: 'مدرسة الجلسة غير نشطة.', en: 'The school of the session is not active.' } },
];
