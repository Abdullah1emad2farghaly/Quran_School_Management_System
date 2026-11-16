import type { NotificationDto } from '../dto/notification-dto';

/**
 * Real-time delivery of a notification to the browsers of ONE account that currently hold an authenticated connection (Socket.IO today; the port keeps Module 31 free
 * of any transport). The database stays the source of truth: the gateway only makes an already stored notification appear at once. Nothing here can fail a notification.
 *
 * "Device" means an authentication session (Module 10): a push subscription belongs to the session that created it, and a connection belongs to the session of its
 * access token. That is what lets the system push to the sessions that have no live connection and skip the ones that already received the notification.
 */
export interface RealtimeNotificationGateway {
  /** True when the account has at least one live authenticated connection (any device). Synchronous, no database access. */
  isUserOnline(userId: string): boolean;
  /** True when this authentication session currently has a live authenticated connection. */
  isSessionOnline(sessionId: string): boolean;
  /**
   * Emits the (already stored) notification to every live connection of the account and remembers, for a short time, which sessions received it.
   * Returns the ids of the sessions reached (empty when the account is offline).
   */
  publishNotification(userId: string, notification: NotificationDto): readonly string[];
  /** True when `publishNotification` reached this session for this notification (remembered for a few minutes only). */
  wasDeliveredToSession(sessionId: string, notificationId: string): boolean;
}

/** The gateway used when real-time is off: nobody is ever online, so behavior is exactly the Web Push behavior from before. */
export const noRealtimeGateway: RealtimeNotificationGateway = {
  isUserOnline: () => false,
  isSessionOnline: () => false,
  publishNotification: () => [],
  wasDeliveredToSession: () => false,
};

/** Closes live connections when their authentication session ends (logout, device revoked, password change, deactivation, expiry). */
export interface RealtimeConnectionControl {
  disconnectSession(sessionId: string): void;
}

/** Names of the events the server emits to a connected browser. The client sends none: it only listens. */
export const REALTIME_EVENTS = {
  /** A new notification, already stored (same shape as an item of `GET /notifications`). */
  NOTIFICATION_NEW: 'notification:new',
  /** Sent once after every (re)connection: the client should refetch the notifications it may have missed through the normal notification APIs. */
  READY: 'connection:ready',
} as const;
