import { ErrorCodes } from '../../../00-shared-kernel/public';
import type { ErrorMessageParams } from '../../../00-shared-kernel/public';
import { SUPPORTED_LOCALES } from '../../../01-configuration/public';
import { interpolate } from '../../domain/services/interpolate';
import { localize, type LocalizedText } from '../../domain/value-objects/localized-text';

export interface ErrorMessageEntry {
  /** Stable, language-independent code, UPPER_SNAKE_CASE. */
  readonly code: string;
  /** Arabic AND English are both required. */
  readonly message: LocalizedText;
}

const CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/** Registry of localized error messages, keyed by stable error code. */
export class MessageCatalog {
  private readonly entries = new Map<string, LocalizedText>();

  /** Atomic: if any entry is invalid or duplicated, nothing is registered. */
  register(entries: readonly ErrorMessageEntry[]): void {
    const seen = new Set<string>();
    for (const { code, message } of entries) {
      if (!CODE_PATTERN.test(code)) throw new Error(`Invalid error code "${code}" (use UPPER_SNAKE_CASE)`);
      if (this.entries.has(code) || seen.has(code)) throw new Error(`Duplicate error code "${code}"`);
      for (const locale of SUPPORTED_LOCALES) {
        if (typeof message[locale] !== 'string' || message[locale].trim() === '') {
          throw new Error(`Error code "${code}" is missing the "${locale}" message`);
        }
      }
      seen.add(code);
    }
    for (const { code, message } of entries) this.entries.set(code, message);
  }

  has(code: string): boolean {
    return this.entries.has(code);
  }

  codes(): string[] {
    return [...this.entries.keys()];
  }

  /** Localized message for a code; unknown codes fall back to the generic internal-error message. */
  message(code: string, locale: string, params?: ErrorMessageParams): string {
    const text = this.entries.get(code) ?? this.entries.get(ErrorCodes.INTERNAL_ERROR);
    if (!text) return code;
    return interpolate(localize(text, locale), params);
  }
}
