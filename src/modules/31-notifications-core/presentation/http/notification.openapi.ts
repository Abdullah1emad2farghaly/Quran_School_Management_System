import { authenticatedOnly, listQueryParameters, ref, schema as s, type ModuleApiDoc } from '../../../04-validation-api/public';
import { NOTIFICATION_LIST_SPEC } from './notification-routes';

const ID = '3d2f8b4a-6c1e-4f7a-9b50-2a8d4c6e1f93';
const ACCOUNT_SCOPE = "The caller's own account.";
const ENFORCEMENT = 'Authentication only: the account comes from the verified access token, so no other account\'s notifications or subscriptions can be named, read, changed or deleted.';
const auth = () => authenticatedOnly(ACCOUNT_SCOPE, ENFORCEMENT);
const PASSWORD_CHANGE = { status: 403, codes: ['PASSWORD_CHANGE_REQUIRED'], description: 'The account must first change its initial password.' } as const;

const notification = s.object(
  {
    id: s.uuid({ description: 'The notification id.' }),
    type: s.string({ description: 'Stable, language-independent kind, for example `EXAM_RESULT_RECORDED`.', example: 'EXAM_RESULT_RECORDED' }),
    title: s.string({ maxLength: 200, description: 'Already rendered in the language chosen when it was created (the account language, else Arabic). It never changes afterwards.', example: 'نتيجة الاختبار' }),
    body: s.string({ maxLength: 2000, description: 'The rendered text, in the same language as the title.' }),
    data: { ...s.object({}, [], { description: 'Language-neutral ids/parameters attached by the producing module (for example the exam id), or null.' }), nullable: true, additionalProperties: true },
    readAt: s.dateTime({ nullable: true, description: 'When the notification was first read (any device), or null if unread.' }),
    createdAt: s.dateTime({ description: 'When the notification was created.' }),
  },
  ['id', 'type', 'title', 'body', 'data', 'readAt', 'createdAt'],
);

const pushSubscription = s.object(
  {
    id: s.uuid({ description: 'The subscription id.' }),
    createdAt: s.dateTime(),
    lastSuccessAt: s.dateTime({ nullable: true, description: 'When a push last reached this browser, or null.' }),
    isCurrentSession: s.boolean({ description: 'True when this subscription was created by the session that made the request.' }),
  },
  ['id', 'createdAt', 'lastSuccessAt', 'isCurrentSession'],
);

const notificationExample = { id: ID, type: 'EXAM_RESULT_RECORDED', title: 'نتيجة الاختبار', body: 'تم تسجيل نتيجة اختبار الطالب.', data: { examId: '9a7c1e52-3b4d-4e68-8f10-5c2d7a9b0e41' }, readAt: null, createdAt: '2026-11-05T09:30:00.000Z' };
const subscriptionExample = { id: 'b8a41c07-52de-4a39-9c6f-1e0d7a3f5b28', createdAt: '2026-11-05T09:00:00.000Z', lastSuccessAt: null, isCurrentSession: true };

/**
 * Module 31 contract. Documents the account-level notification API and the Web Push subscription API. SMS and email are not part of this module.
 */
export const notificationApiDoc: ModuleApiDoc = {
  moduleId: '31',
  mountPath: '/notifications',
  tag: {
    name: 'Notifications',
    description:
      'In-app notifications and Web Push subscriptions. Notifications belong to the ACCOUNT, not to a device: every device logged in to the account sees the same notifications, and read/delete/clear-all act on the whole account. Delete and clear-all are permanent (hard delete).',
  },
  operations: [
    {
      method: 'get',
      path: '/',
      operationId: 'listNotifications',
      summary: "List the caller's notifications",
      description: 'A paginated list of the account\'s notifications, newest first by default (`sort=createdAt`, `-createdAt`). `filter[unread]=true` lists only unread ones. Sent with `Cache-Control: no-store`.',
      authorization: auth(),
      query: listQueryParameters(NOTIFICATION_LIST_SPEC),
      success: { status: 200, description: 'A page of notifications.', paginated: true, data: ref('Notification'), example: notificationExample, noStore: true },
      errors: [PASSWORD_CHANGE],
    },
    {
      method: 'get',
      path: '/unread-count',
      operationId: 'countUnreadNotifications',
      summary: 'Number of unread notifications',
      description: 'The number of unread notifications of the account (the same on every device). Cheap to poll.',
      authorization: auth(),
      success: { status: 200, description: 'The unread count.', data: s.object({ unreadCount: s.integer({ minimum: 0, example: 3 }) }, ['unreadCount']), example: { unreadCount: 3 }, noStore: true },
      errors: [PASSWORD_CHANGE],
    },
    {
      method: 'post',
      path: '/read-all',
      operationId: 'markAllNotificationsRead',
      summary: 'Mark all notifications as read',
      description: 'Marks every unread notification of the account as read (on every device). Notifications that were already read keep their original read time.',
      authorization: auth(),
      success: { status: 204, description: 'Done. No content.', noStore: true },
      errors: [PASSWORD_CHANGE],
    },
    {
      method: 'delete',
      path: '/',
      operationId: 'clearAllNotifications',
      summary: 'Clear all notifications (permanent)',
      description: 'PERMANENTLY deletes every notification of the account, on every device. There is no soft delete and no archive. It does not touch any other module\'s data, and it never recreates the notifications later (their once-only keys are kept).',
      authorization: auth(),
      success: { status: 204, description: 'Done. No content.', noStore: true },
      errors: [PASSWORD_CHANGE],
    },
    {
      method: 'post',
      path: '/:id/read',
      operationId: 'markNotificationRead',
      summary: 'Mark one notification as read',
      description: 'Marks one of the account\'s notifications as read on every device. Idempotent: it keeps the first read time. An id that is unknown, deleted or belongs to another account answers 204 and changes nothing, so ids of other accounts cannot be probed.',
      authorization: auth(),
      pathParams: { id: { description: 'The notification id.', example: ID, schema: s.uuid() } },
      success: { status: 204, description: 'Done. No content.', noStore: true },
      errors: [PASSWORD_CHANGE],
    },
    {
      method: 'delete',
      path: '/:id',
      operationId: 'deleteNotification',
      summary: 'Delete one notification (permanent)',
      description: 'PERMANENTLY deletes one of the account\'s notifications on every device (hard delete, no archive). Idempotent: an id that is unknown, already deleted or belongs to another account answers 204 and changes nothing, which also keeps two devices deleting at the same time harmless.',
      authorization: auth(),
      pathParams: { id: { description: 'The notification id.', example: ID, schema: s.uuid() } },
      success: { status: 204, description: 'Done. No content.', noStore: true },
      errors: [PASSWORD_CHANGE],
    },
    {
      method: 'get',
      path: '/push/public-key',
      operationId: 'getPushPublicKey',
      summary: 'The Web Push (VAPID) public key',
      description: 'The public key a browser needs to subscribe to Web Push (`applicationServerKey`). The private key is never exposed.',
      authorization: auth(),
      success: { status: 200, description: 'The VAPID public key.', data: s.object({ publicKey: s.string({ description: 'Base64url VAPID public key.' }) }, ['publicKey']), example: { publicKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U' }, noStore: true },
      errors: [PASSWORD_CHANGE, { status: 422, codes: ['PUSH_NOT_CONFIGURED'], description: 'Web Push is not configured on this server (no VAPID keys). In-app notifications still work.' }],
    },
    {
      method: 'get',
      path: '/push-subscriptions',
      operationId: 'listPushSubscriptions',
      summary: "List the caller's push subscriptions",
      description: 'The account\'s push subscriptions (ids and times only; never the endpoint or the keys). A subscription belongs to the authentication session that created it and is deleted when that session ends.',
      authorization: auth(),
      success: { status: 200, description: 'The subscriptions.', data: s.object({ items: s.array(ref('PushSubscription')) }, ['items']), example: { items: [subscriptionExample] }, noStore: true },
      errors: [PASSWORD_CHANGE],
    },
    {
      method: 'post',
      path: '/push-subscriptions',
      operationId: 'subscribePush',
      summary: 'Register this browser for Web Push',
      description:
        'Registers (or refreshes) the browser\'s push subscription for the session that made the request. Send the `endpoint` and `keys` from the browser\'s `PushSubscription`. Idempotent for the same endpoint. Only `https` push-service endpoints are accepted. An account can have several subscriptions (a safety cap of 10 applies). When this browser was subscribed by another account it moves to this one and anything still queued for the other account is dropped.',
      authorization: auth(),
      request: {
        description: 'The browser PushSubscription.',
        schema: s.object(
          {
            endpoint: s.string({ maxLength: 2048, description: 'The push service URL (https).', example: 'https://fcm.googleapis.com/fcm/send/abc123' }),
            keys: s.object({ p256dh: s.string({ description: 'Base64url public key of the browser.' }), auth: s.string({ description: 'Base64url authentication secret.' }) }, ['p256dh', 'auth']),
          },
          ['endpoint', 'keys'],
        ),
        examples: { browser: { summary: 'A subscription from a browser', value: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } } } },
      },
      success: { status: 200, description: 'The subscription.', data: ref('PushSubscription'), example: subscriptionExample, noStore: true },
      errors: [
        PASSWORD_CHANGE,
        { status: 400, codes: ['INVALID_PUSH_SUBSCRIPTION'], description: 'The endpoint is not an acceptable https push-service URL, or a key is not valid.' },
        { status: 422, codes: ['PUSH_NOT_CONFIGURED', 'PUSH_SUBSCRIPTION_LIMIT_REACHED'], description: 'Web Push is not configured on this server, or the account already has the maximum number of subscriptions.' },
      ],
    },
    {
      method: 'post',
      path: '/push-subscriptions/unsubscribe',
      operationId: 'unsubscribePush',
      summary: 'Remove this browser from Web Push',
      description: 'Removes the account\'s push subscription with this endpoint. Call it before logging out. Idempotent. It never touches notifications or the account\'s other subscriptions.',
      authorization: auth(),
      request: {
        description: 'The endpoint to remove.',
        schema: s.object({ endpoint: s.string({ maxLength: 2048 }) }, ['endpoint']),
        examples: { browser: { summary: 'Remove one browser', value: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123' } } },
      },
      success: { status: 204, description: 'Done. No content.', noStore: true },
      errors: [PASSWORD_CHANGE, { status: 400, codes: ['INVALID_PUSH_SUBSCRIPTION'], description: 'The endpoint is missing or too long.' }],
    },
  ],
  schemas: { Notification: notification, PushSubscription: pushSubscription },
};
