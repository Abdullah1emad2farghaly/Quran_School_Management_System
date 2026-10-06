import { FOUNDATION_ERROR_MESSAGES } from '../../application/services/foundation-error-messages';
import { MessageCatalog, type ErrorMessageEntry } from '../../application/services/message-catalog';

/** Process-wide catalog. Each module registers its own codes at startup. */
export const defaultMessageCatalog = new MessageCatalog();
defaultMessageCatalog.register(FOUNDATION_ERROR_MESSAGES);

export function registerErrorMessages(entries: readonly ErrorMessageEntry[]): void {
  defaultMessageCatalog.register(entries);
}
