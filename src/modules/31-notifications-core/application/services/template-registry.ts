import { localize, type LocalizedText } from '../../../03-error-localization/public';
import type { Locale } from '../../../01-configuration/public';
import { NotificationDefinitionError } from '../../domain/errors/notification-errors';
import { NOTIFICATION_LIMITS } from '../../domain/value-objects/notification-rules';

/**
 * A notification template. EVERY template has an Arabic AND an English title and body (approved decision Q2); `{name}` placeholders are filled from the
 * parameters at creation time. `type` is the stable, language-independent kind stored with the notification (for example `EXAM_RESULT_RECORDED`).
 */
export interface NotificationTemplate {
  readonly key: string;
  readonly type: string;
  readonly title: LocalizedText;
  readonly body: LocalizedText;
}

const LOCALES: readonly Locale[] = ['ar', 'en'];

export class NotificationTemplateRegistry {
  private readonly templates = new Map<string, NotificationTemplate>();

  /** Registers a template. Rejects an invalid key or type, a duplicate key, and a missing/blank Arabic or English text (a programming error, found at startup). */
  register(template: NotificationTemplate): void {
    if (!NOTIFICATION_LIMITS.templateKeyPattern.test(template.key)) throw new NotificationDefinitionError(`Invalid notification template key "${template.key}"`);
    if (!NOTIFICATION_LIMITS.typePattern.test(template.type)) throw new NotificationDefinitionError(`Invalid notification type "${template.type}" (template ${template.key})`);
    if (this.templates.has(template.key)) throw new NotificationDefinitionError(`Notification template "${template.key}" is already registered`);
    for (const part of ['title', 'body'] as const) {
      for (const locale of LOCALES) {
        const text = template[part]?.[locale];
        if (typeof text !== 'string' || text.trim() === '') throw new NotificationDefinitionError(`Template ${template.key}: the ${locale} ${part} is required`);
      }
    }
    this.templates.set(template.key, template);
  }

  registerAll(templates: readonly NotificationTemplate[]): void {
    for (const t of templates) this.register(t);
  }

  get(key: string): NotificationTemplate | undefined {
    return this.templates.get(key);
  }

  has(key: string): boolean {
    return this.templates.has(key);
  }

  keys(): string[] {
    return [...this.templates.keys()];
  }

  /** The template text in a locale (falls back like the rest of the system). */
  text(template: NotificationTemplate, part: 'title' | 'body', locale: Locale): string {
    return localize(template[part], locale);
  }
}
