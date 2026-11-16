import { buildPageResult, newUuid, type Clock, type PageResult, type TransactionContext, type UnitOfWork } from '../../../00-shared-kernel/public';
import { isLocale, type Locale } from '../../../01-configuration/public';
import { interpolate, localize } from '../../../03-error-localization/public';
import type { ListQuery } from '../../../04-validation-api/public';
import { NotificationDefinitionError } from '../../domain/errors/notification-errors';
import { DEFAULT_NOTIFICATION_LOCALE, NOTIFICATION_LIMITS } from '../../domain/value-objects/notification-rules';
import type { NotificationDto, NotifyInput, NotifyResult } from '../dto/notification-dto';
import type { AccountLanguageResolver } from '../ports/account-language-resolver';
import type { NewPushDelivery, NotificationRecord, NotificationRepository } from '../ports/notification-repository';
<<<<<<< HEAD
import type { RealtimeNotificationGateway } from '../ports/realtime-gateway';
=======
>>>>>>> a54dc5556dea92ae5f6404ebe5d964eb0b936ccc
import type { NotificationTemplate, NotificationTemplateRegistry } from './template-registry';

export interface NotificationServiceDeps {
  readonly repository: NotificationRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly templates: NotificationTemplateRegistry;
  readonly language: AccountLanguageResolver;
  /** False when no VAPID keys are configured: notifications are still created, no push delivery is queued. */
  readonly pushEnabled: boolean;
<<<<<<< HEAD
  /** Real-time delivery to connected browsers (optional; without it behavior is exactly the Web Push behavior). It never changes what is stored or queued. */
  readonly realtime?: RealtimeNotificationGateway;
  /** Called when a real-time emission fails (it never fails the notification). */
  readonly onRealtimeError?: (error: unknown) => void;
}

/** Waits before checking that a notification created inside a CALLER's transaction has been committed (the service cannot see that commit). Total about 5 seconds. */
const COMMIT_CHECK_DELAYS_MS: readonly number[] = [50, 250, 700, 1500, 2500];

=======
}

>>>>>>> a54dc5556dea92ae5f6404ebe5d964eb0b936ccc
interface Prepared {
  readonly template: NotificationTemplate;
  readonly recipients: readonly string[];
  readonly dedupKey: string;
  readonly params: Readonly<Record<string, string | number>> | undefined;
  readonly dataJson: string | null;
}

const ellipsize = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

function parseData(json: string | null): Readonly<Record<string, unknown>> | null {
  if (json === null) return null;
  try {
    const value: unknown = JSON.parse(json);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function toNotificationDto(r: NotificationRecord): NotificationDto {
  return { id: r.id, type: r.type, title: r.title, body: r.body, data: parseData(r.data), readAt: r.readAt, createdAt: r.createdAt };
}

/**
 * Module 31 core (Master Specification §62-63 and the approved Module 31 decisions).
 *  - Notifications belong to the ACCOUNT, never to a device or a session. Every read/mark/delete method takes the caller's account id and can only touch its own rows.
 *  - `notify` is the contract for producing modules: per recipient it records the once-only key FIRST (Q1; a duplicate creates nothing), renders the title and body
 *    in the account's language or Arabic and PERSISTS the rendered text (Q2), stores the notification, and queues one push delivery per current push subscription.
 *  - Delete and clear-all are HARD deletes (no soft delete, no archive); the once-only key is kept so a retried event or a repeated reminder cannot bring it back.
 * It never reads another module's tables and consumes no business event itself.
 */
export class NotificationService {
  constructor(private readonly deps: NotificationServiceDeps) {}

  /**
   * Creates one notification per distinct recipient account. Pass `tx` to join the caller's transaction (for example an outbox handler's), otherwise it runs in its own.
   * Programming mistakes of the caller (unknown template, bad key, oversized data) throw NotificationDefinitionError.
   */
  async notify(input: NotifyInput, tx?: TransactionContext): Promise<NotifyResult> {
    const prepared = this.prepare(input);
    if (prepared.recipients.length === 0) return { created: [], duplicates: [] };
<<<<<<< HEAD
    if (tx) {
      // The caller's transaction decides when this becomes visible, so a real-time event is emitted only once the row can be read from outside it.
      const { result, records } = await this.createAll(prepared, tx);
      this.publishAfterCommit(records);
      return result;
    }
    const { result, records } = await this.deps.unitOfWork.run((t) => this.createAll(prepared, t));
    this.publishNow(records); // the transaction above has committed
    return result;
=======
    return tx ? this.createAll(prepared, tx) : this.deps.unitOfWork.run((t) => this.createAll(prepared, t));
>>>>>>> a54dc5556dea92ae5f6404ebe5d964eb0b936ccc
  }

  async list(userId: string, query: ListQuery): Promise<PageResult<NotificationDto>> {
    const { items, total } = await this.deps.repository.listNotifications(userId, {
      unreadOnly: query.filters.unread === true,
      newestFirst: (query.sort[0]?.direction ?? 'desc') === 'desc',
      page: query.page,
    });
    return buildPageResult(items.map(toNotificationDto), total, query.page);
  }

  async unreadCount(userId: string): Promise<number> {
    return this.deps.repository.countUnread(userId);
  }

  /** Marks one of the caller's notifications read. Idempotent: it keeps the first read time, and an unknown or foreign id changes nothing. */
  async markRead(userId: string, notificationId: string): Promise<void> {
    await this.deps.unitOfWork.run((tx) => this.deps.repository.markRead(userId, notificationId, this.deps.clock.now(), tx));
  }

  async markAllRead(userId: string): Promise<void> {
    await this.deps.unitOfWork.run((tx) => this.deps.repository.markAllRead(userId, this.deps.clock.now(), tx));
  }

  /** HARD delete of one of the caller's notifications. Idempotent: an unknown, already deleted or foreign id changes nothing (and is indistinguishable). */
  async deleteNotification(userId: string, notificationId: string): Promise<void> {
    await this.deps.unitOfWork.run((tx) => this.deps.repository.deleteNotification(userId, notificationId, tx));
  }

  /** HARD delete of every notification of the caller's account. */
  async clearAll(userId: string): Promise<void> {
    await this.deps.unitOfWork.run((tx) => this.deps.repository.deleteAllNotifications(userId, tx));
  }

  // ---------------------------------------------------------------------------------------------------------------------------------------------------

  private prepare(input: NotifyInput): Prepared {
    const template = this.deps.templates.get(input.templateKey);
    if (!template) throw new NotificationDefinitionError(`Unknown notification template "${String(input.templateKey)}"`);
    const dedupKey = typeof input.dedupKey === 'string' ? input.dedupKey.trim() : '';
    if (dedupKey === '' || dedupKey.length > NOTIFICATION_LIMITS.dedupKeyMax) {
      throw new NotificationDefinitionError(`The once-only key must be 1 to ${NOTIFICATION_LIMITS.dedupKeyMax} characters`);
    }
    if (!Array.isArray(input.recipientUserIds)) throw new NotificationDefinitionError('recipientUserIds must be an array');
    const recipients = [...new Set(input.recipientUserIds.filter((id): id is string => typeof id === 'string' && id.trim() !== ''))];
    if (recipients.length > NOTIFICATION_LIMITS.maxRecipientsPerCall) {
      throw new NotificationDefinitionError(`At most ${NOTIFICATION_LIMITS.maxRecipientsPerCall} recipients per call`);
    }
    for (const [name, value] of Object.entries(input.params ?? {})) {
      if (typeof value !== 'string' && typeof value !== 'number') throw new NotificationDefinitionError(`Parameter "${name}" must be a string or a number`);
    }
    let dataJson: string | null = null;
    if (input.data !== undefined) {
      dataJson = JSON.stringify(input.data);
      if (dataJson === undefined || new TextEncoder().encode(dataJson).length > NOTIFICATION_LIMITS.dataMaxBytes) {
        throw new NotificationDefinitionError(`The notification data must be JSON of at most ${NOTIFICATION_LIMITS.dataMaxBytes} bytes`);
      }
    }
    return { template, recipients, dedupKey, params: input.params, dataJson };
  }

<<<<<<< HEAD
  /** Emits to the account's live connections right away (the notification is already committed). Never throws. */
  private publishNow(records: readonly NotificationRecord[]): void {
    const gateway = this.deps.realtime;
    if (!gateway) return;
    for (const record of records) {
      try {
        gateway.publishNotification(record.recipientUserId, toNotificationDto(record));
      } catch (error) {
        this.deps.onRealtimeError?.(error);
      }
    }
  }

  /**
   * For notifications created inside a caller's transaction: only accounts that are online are considered (no database work for offline ones); the row is looked up
   * outside the transaction after short waits and emitted as soon as it is visible. If it never becomes visible (rolled back) nothing is emitted. A user who was offline
   * or whose connection dropped meanwhile gets it from the notification APIs, which remain the source of truth.
   */
  private publishAfterCommit(records: readonly NotificationRecord[]): void {
    const gateway = this.deps.realtime;
    if (!gateway) return;
    for (const record of records) {
      if (!gateway.isUserOnline(record.recipientUserId)) continue;
      void this.emitWhenVisible(record);
    }
  }

  private async emitWhenVisible(record: NotificationRecord): Promise<void> {
    try {
      for (const delay of COMMIT_CHECK_DELAYS_MS) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, delay);
          timer.unref?.();
        });
        const stored = await this.deps.repository.findNotification(record.recipientUserId, record.id);
        if (stored) {
          this.deps.realtime?.publishNotification(stored.recipientUserId, toNotificationDto(stored));
          return;
        }
      }
    } catch (error) {
      this.deps.onRealtimeError?.(error);
    }
  }

  private async createAll(p: Prepared, tx: TransactionContext): Promise<{ result: NotifyResult; records: NotificationRecord[] }> {
    const { repository, clock, language, pushEnabled } = this.deps;
    const created: string[] = [];
    const duplicates: string[] = [];
    const records: NotificationRecord[] = [];
=======
  private async createAll(p: Prepared, tx: TransactionContext): Promise<NotifyResult> {
    const { repository, clock, language, pushEnabled } = this.deps;
    const created: string[] = [];
    const duplicates: string[] = [];
>>>>>>> a54dc5556dea92ae5f6404ebe5d964eb0b936ccc
    for (const recipient of p.recipients) {
      const now = clock.now();
      // 1. The once-only key FIRST: a duplicate (retried event, repeated reminder, or a notification the user already deleted) creates nothing.
      if (!(await repository.insertDedupKey(recipient, p.dedupKey, now, tx))) {
        duplicates.push(recipient);
        continue;
      }
      // 2. The account's language, else Arabic; the RENDERED text is what gets stored, so it never changes afterwards.
      const configured = await language.languageOf(recipient);
      const locale: Locale = configured !== undefined && isLocale(configured) ? configured : DEFAULT_NOTIFICATION_LOCALE;
      const record: NotificationRecord = {
        id: newUuid(),
        recipientUserId: recipient,
        type: p.template.type,
        title: ellipsize(interpolate(localize(p.template.title, locale), p.params), NOTIFICATION_LIMITS.titleMax),
        body: ellipsize(interpolate(localize(p.template.body, locale), p.params), NOTIFICATION_LIMITS.bodyMax),
        data: p.dataJson,
        readAt: null,
        createdAt: now,
      };
      await repository.insertNotification(record, tx);
      // 3. One push delivery per current subscription of the ACCOUNT (never per notification device); delivery happens later, outside this transaction.
      if (pushEnabled) {
        const subscriptions = await repository.listSubscriptionsOfUser(recipient, tx);
        const deliveries: NewPushDelivery[] = subscriptions.map((s) => ({ id: newUuid(), notificationId: record.id, subscriptionId: s.id, recipientUserId: recipient, createdAt: now }));
        if (deliveries.length > 0) await repository.insertDeliveries(deliveries, tx);
      }
      created.push(recipient);
<<<<<<< HEAD
      records.push(record);
    }
    return { result: { created, duplicates }, records };
=======
    }
    return { created, duplicates };
>>>>>>> a54dc5556dea92ae5f6404ebe5d964eb0b936ccc
  }
}
