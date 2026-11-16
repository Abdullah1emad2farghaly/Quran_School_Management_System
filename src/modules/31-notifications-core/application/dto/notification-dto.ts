/** A notification as the account sees it (the title and body are already in the language chosen when it was created). */
export interface NotificationDto {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  /** Language-neutral ids/parameters attached by the producing module (for example the exam id), or null. */
  readonly data: Readonly<Record<string, unknown>> | null;
  readonly readAt: Date | null;
  readonly createdAt: Date;
}

/** What a producing module (Module 32 and later) asks Module 31 to notify. Module 31 knows no business events. */
export interface NotifyInput {
  /** User account ids (never device or session ids). One notification is created per distinct account. */
  readonly recipientUserIds: readonly string[];
  /** Key of a registered template (Arabic and English text). */
  readonly templateKey: string;
  /** Values for the `{name}` placeholders of the template. */
  readonly params?: Readonly<Record<string, string | number>>;
  /** Language-neutral data stored with the notification (at most 4 KB as JSON). */
  readonly data?: Readonly<Record<string, unknown>>;
  /**
   * Once-only key, per recipient (at most 191 characters). The SAME key never creates a second notification for the same account, even after the
   * first one was deleted (Q1): build it from the event id, or from type + aggregate + variant for reminders.
   */
  readonly dedupKey: string;
}

export interface NotifyResult {
  readonly created: readonly string[];
  /** Accounts that already had this once-only key: no notification was created for them. */
  readonly duplicates: readonly string[];
}

export interface PushSubscriptionInput {
  readonly endpoint: unknown;
  readonly p256dh: unknown;
  readonly auth: unknown;
}

/** A push subscription of the caller's account (never the endpoint or the keys). */
export interface PushSubscriptionDto {
  readonly id: string;
  readonly createdAt: Date;
  readonly lastSuccessAt: Date | null;
  /** True when it was created by the session that made this request. */
  readonly isCurrentSession: boolean;
}
