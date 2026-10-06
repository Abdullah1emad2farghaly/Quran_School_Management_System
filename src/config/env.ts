import dotenv from 'dotenv';
import { loadConfig, type AppConfig } from '../modules/01-configuration/public';

export { SUPPORTED_LOCALES, FALLBACK_LOCALE, type Locale } from '../modules/01-configuration/public';

// Composition root: the only place that reads .env / process.env.
dotenv.config();

export type Env = AppConfig;
export const env: AppConfig = loadConfig(process.env);
