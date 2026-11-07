import type { ErrorMessageEntry } from '../../../03-error-localization/public';
import { NotificationErrorCodes } from '../../domain/errors/notification-errors';

export const NOTIFICATION_ERROR_MESSAGES: readonly ErrorMessageEntry[] = [
  {
    code: NotificationErrorCodes.INVALID_PUSH_SUBSCRIPTION,
    message: { ar: 'اشتراك الإشعارات الفوري غير صالح.', en: 'The push subscription is not valid.' },
  },
  {
    code: NotificationErrorCodes.PUSH_NOT_CONFIGURED,
    message: {
      ar: 'الإشعارات الفورية غير مفعّلة على الخادم. ستظل الإشعارات داخل التطبيق تعمل.',
      en: 'Push notifications are not enabled on this server. In-app notifications still work.',
    },
  },
  {
    code: NotificationErrorCodes.PUSH_SUBSCRIPTION_LIMIT_REACHED,
    message: {
      ar: 'وصل حسابك إلى الحد الأقصى لاشتراكات الإشعارات الفورية. ألغِ اشتراكًا ثم حاول مرة أخرى.',
      en: 'Your account has reached the maximum number of push subscriptions. Remove one and try again.',
    },
  },
];
