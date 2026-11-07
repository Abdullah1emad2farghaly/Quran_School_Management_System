import { buildPageResult, newUuid, type Clock, type PageResult, type TransactionContext, type UnitOfWork } from '../../../00-shared-kernel/public';
import { isLocale, type Locale } from '../../../01-configuration/public';
import { interpolate, localize } from '../../../03-error-localization/public';
import type { ListQuery } from '../../../04-validation-api/public';
import { NotificationDefinitionError } from '../../domain/errors/notification-errors';
import { DEFAULT_NOTIFICATION_LOCALE, NOTIFICATION_LIMITS } from '../../domain/value-objects/notification-rules';
import type { NotificationDto, NotifyInput, NotifyResult } from '../dto/notification-dto';
import type { AccountLanguageResolver } from '../ports/account-language-resolver';
import type { NewPushDelivery, NotificationRecord, NotificationRepository } from '../ports/notification-repository';
import type { NotificationTemplate, NotificationTemplateRegistry } from './template-registry';

export interface NotificationServiceDeps {
  readonly repository: NotificationRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly templates: NotificationTemplateRegistry;
  readonly language: AccountLanguageResolver;
  /** False when no VAPID keys are configured: notifications are still created, no push delivery is queued. */
  readonly pushEnabled: boolean;
}

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
    return tx ? this.createAll(prepared, tx) : this.deps.unitOfWork.run((t) => this.createAll(prepared, t));
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

  private async createAll(p: Prepared, tx: TransactionContext): Promise<NotifyResult> {
    const { repository, clock, language, pushEnabled } = this.deps;
    const created: string[] = [];
    const duplicates: string[] = [];
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
    }
    return { created, duplicates };
  }
}
