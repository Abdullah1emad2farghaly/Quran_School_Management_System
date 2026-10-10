import type { ErrorMessageEntry } from '../../../03-error-localization/public';
import { RoleErrorCodes } from '../../domain/errors/role-errors';

export const ROLE_ERROR_MESSAGES: readonly ErrorMessageEntry[] = [
  { code: RoleErrorCodes.INVALID_ROLE, message: { ar: 'الدور غير صالح.', en: 'The role is not valid.' } },
  {
    code: RoleErrorCodes.ROLE_NOT_ASSIGNABLE,
    message: { ar: 'لا يمكن إسناد هذا الدور إلى مستخدم.', en: 'This role cannot be assigned to a user.' },
  },
  {
    code: RoleErrorCodes.ROLE_ALREADY_ASSIGNED,
    message: { ar: 'المستخدم لديه هذا الدور بالفعل.', en: 'The user already has this role.' },
  },
  {
    code: RoleErrorCodes.ROLE_ASSIGNMENT_NOT_FOUND,
    message: { ar: 'المستخدم ليس لديه هذا الدور حاليًا.', en: 'The user does not currently have this role.' },
  },
  {
    code: RoleErrorCodes.LAST_ACTIVE_ROLE,
    message: {
      ar: 'لا يمكن إلغاء آخر دور فعّال للمستخدم.',
      en: "The user's last active role cannot be revoked.",
    },
  },
  {
    code: RoleErrorCodes.ROLE_CONCURRENT_MODIFICATION,
    message: {
      ar: 'تم تعديل أدوار المستخدم من طلب آخر. أعد المحاولة.',
      en: "The user's roles were modified by another request. Please try again.",
    },
  },
];
