import type { Locale } from '../../../01-configuration/public';

/**
 * The language an ACCOUNT chose, when one is configured. No account language setting exists yet (Module 31 does not add one, approved decision Q6), so the
 * default implementation answers `undefined` and every notification is rendered in Arabic. When a module later stores an account language it plugs in here.
 */
export interface AccountLanguageResolver {
  languageOf(userId: string): Promise<Locale | undefined>;
}

export const noAccountLanguage: AccountLanguageResolver = { languageOf: async () => undefined };
