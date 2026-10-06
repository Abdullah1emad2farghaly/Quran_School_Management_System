// Public contract of Module 03 (Error & Localization).
export { type LocalizedText, localize } from '../domain/value-objects/localized-text';
export { interpolate } from '../domain/services/interpolate';
export {
  resolveLocale,
  parseAcceptLanguage,
  type ResolveLocaleInput,
} from '../domain/services/locale-resolver';
export { MessageCatalog, type ErrorMessageEntry } from '../application/services/message-catalog';
export { FOUNDATION_ERROR_MESSAGES } from '../application/services/foundation-error-messages';
export { defaultMessageCatalog, registerErrorMessages } from '../infrastructure/services/default-catalog';
export {
  HTTP_STATUS_BY_KIND,
  normalizeError,
  toErrorResponse,
  type ErrorResponseBody,
  type ErrorResponseContext,
} from '../presentation/http/error-response';
