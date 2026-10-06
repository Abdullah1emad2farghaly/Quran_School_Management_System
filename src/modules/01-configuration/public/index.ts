// Public contract of Module 01 (Configuration & Environment).
export type { AppConfig, NodeEnvironment } from '../application/dto/app-config';
export { loadConfig, type EnvSource } from '../infrastructure/services/config-loader';
export { redactConfig } from '../infrastructure/services/config-redaction';
export { ConfigurationError } from '../domain/errors/configuration-error';
export { SUPPORTED_LOCALES, FALLBACK_LOCALE, isLocale, type Locale } from '../domain/value-objects/locale';
