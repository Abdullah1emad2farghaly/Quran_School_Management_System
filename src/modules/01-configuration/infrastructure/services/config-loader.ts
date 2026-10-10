import { isIP } from 'node:net';
import { ConfigurationError } from '../../domain/errors/configuration-error';
import { isLocale, type Locale } from '../../domain/value-objects/locale';
import { LOG_LEVELS, isLogLevel, type LogLevel } from '../../domain/value-objects/log-level';
import type { AppConfig, NodeEnvironment, OtpSenderKind } from '../../application/dto/app-config';

export type EnvSource = Readonly<Record<string, string | undefined>>;

const NODE_ENVIRONMENTS: readonly NodeEnvironment[] = ['development', 'test', 'production'];
const MIN_PRODUCTION_SECRET_LENGTH = 32;
const OTP_SENDERS: readonly OtpSenderKind[] = ['disabled', 'dev-file'];
const PROXY_KEYWORDS = ['loopback', 'linklocal', 'uniquelocal'];
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * A trusted proxy is an explicit IP, a CIDR range, or one of Express' named ranges. "true", hop counts, "*" and
 * "match everything" ranges (/0) are rejected: they would let any client forge X-Forwarded-For.
 */
function isValidTrustedProxy(entry: string): boolean {
  if (PROXY_KEYWORDS.includes(entry)) return true;
  const parts = entry.split('/');
  if (parts.length > 2) return false;
  const version = isIP(parts[0] ?? '');
  if (version === 0) return false;
  if (parts.length === 1) return true;
  const prefix = parts[1] ?? '';
  if (!/^\d+$/.test(prefix)) return false;
  const bits = Number(prefix);
  return bits >= 1 && bits <= (version === 4 ? 32 : 128);
}

function isValidOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === origin;
  } catch {
    return false;
  }
}

/**
 * Builds and validates configuration from an environment-like source.
 * Pure: it never reads process.env or files itself, so it is fully testable.
 * Collects ALL problems and throws one ConfigurationError.
 */
export function loadConfig(source: EnvSource): AppConfig {
  const issues: string[] = [];

  /** Trimmed value; empty string counts as unset. */
  const read = (name: string): string | undefined => {
    const v = source[name]?.trim();
    return v ? v : undefined;
  };

  const readInt = (name: string, fallback: number, min: number, max: number): number => {
    const raw = read(name);
    if (raw === undefined) return fallback;
    if (!/^\d+$/.test(raw)) {
      issues.push(`${name}: must be an integer`);
      return fallback;
    }
    const n = Number(raw);
    if (n < min || n > max) {
      issues.push(`${name}: must be between ${min} and ${max}`);
      return fallback;
    }
    return n;
  };

  // NODE_ENV
  const rawNodeEnv = read('NODE_ENV') ?? 'development';
  let nodeEnv: NodeEnvironment = 'development';
  if ((NODE_ENVIRONMENTS as readonly string[]).includes(rawNodeEnv)) {
    nodeEnv = rawNodeEnv as NodeEnvironment;
  } else {
    issues.push(`NODE_ENV: must be one of ${NODE_ENVIRONMENTS.join(', ')}`);
  }
  const isProduction = nodeEnv === 'production';

  // Locale
  const rawLocale = read('DEFAULT_LOCALE') ?? 'ar';
  let defaultLocale: Locale = 'ar';
  if (isLocale(rawLocale)) defaultLocale = rawLocale;
  else issues.push('DEFAULT_LOCALE: must be a supported locale (ar, en)');

  // Log level
  const rawLogLevel = read('LOG_LEVEL') ?? (nodeEnv === 'test' ? 'silent' : 'info');
  let logLevel: LogLevel = 'info';
  if (isLogLevel(rawLogLevel)) logLevel = rawLogLevel;
  else issues.push(`LOG_LEVEL: must be one of ${LOG_LEVELS.join(', ')}`);

  // Timezone
  const timezone = read('APP_TIMEZONE') ?? 'Africa/Cairo';
  if (!isValidTimezone(timezone)) issues.push('APP_TIMEZONE: must be a valid IANA timezone');

  // CORS
  const corsOrigins = (source.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const origin of corsOrigins) {
    if (origin === '*') issues.push('CORS_ORIGINS: wildcard is not allowed; list explicit origins');
    else if (!isValidOrigin(origin)) {
      issues.push(`CORS_ORIGINS: invalid origin "${origin}" (use scheme://host[:port], no path or trailing slash)`);
    }
  }

  // Database
  const database = {
    host: read('DATABASE_HOST') ?? '127.0.0.1',
    port: readInt('DATABASE_PORT', 3306, 1, 65535),
    name: read('DATABASE_NAME') ?? '',
    user: read('DATABASE_USER') ?? '',
    password: source.DATABASE_PASSWORD ?? '',
  };

  // JWT
  const jwt = {
    accessSecret: read('JWT_ACCESS_SECRET') ?? '',
    refreshSecret: read('JWT_REFRESH_SECRET') ?? '',
  };

  // HTTP (reverse proxy)
  const trustedProxies = (source.TRUSTED_PROXIES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const entry of trustedProxies) {
    if (!isValidTrustedProxy(entry)) {
      issues.push(`TRUSTED_PROXIES: invalid entry "${entry}" (use an IP, a CIDR range, or loopback/linklocal/uniquelocal)`);
    }
  }
  const http = { trustedProxies };

  // OTP
  const rawOtpSender = read('OTP_SENDER') ?? 'disabled';
  let otpSender: OtpSenderKind = 'disabled';
  if ((OTP_SENDERS as readonly string[]).includes(rawOtpSender)) otpSender = rawOtpSender as OtpSenderKind;
  else issues.push(`OTP_SENDER: must be one of ${OTP_SENDERS.join(', ')}`);
  if (isProduction && otpSender === 'dev-file') issues.push('OTP_SENDER: "dev-file" is for development only and is not allowed in production');
  const otp = { hmacSecret: read('OTP_HMAC_SECRET') ?? '', sender: otpSender };

  // Redis
  const redis = { host: read('REDIS_HOST') ?? '127.0.0.1', port: readInt('REDIS_PORT', 6379, 1, 65535) };

  // Files
  const files = {
    storagePath: read('FILE_STORAGE_PATH') ?? './storage',
    maxFileSize: readInt('MAX_FILE_SIZE', DEFAULT_MAX_FILE_SIZE, 1, Number.MAX_SAFE_INTEGER),
  };

  const port = readInt('PORT', 3000, 1, 65535);

  if (isProduction) {
    for (const [name, value] of [
      ['DATABASE_NAME', database.name],
      ['DATABASE_USER', database.user],
      ['DATABASE_PASSWORD', database.password],
    ] as const) {
      if (!value) issues.push(`${name}: required in production`);
    }
    for (const [name, value] of [
      ['JWT_ACCESS_SECRET', jwt.accessSecret],
      ['JWT_REFRESH_SECRET', jwt.refreshSecret],
    ] as const) {
      if (!value) issues.push(`${name}: required in production`);
      else if (value.length < MIN_PRODUCTION_SECRET_LENGTH) {
        issues.push(`${name}: must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production`);
      }
    }
    if (jwt.accessSecret && jwt.accessSecret === jwt.refreshSecret) {
      issues.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET: must be different');
    }
    if (!otp.hmacSecret) issues.push('OTP_HMAC_SECRET: required in production');
    else if (otp.hmacSecret.length < MIN_PRODUCTION_SECRET_LENGTH) {
      issues.push(`OTP_HMAC_SECRET: must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production`);
    }
    if (otp.hmacSecret && (otp.hmacSecret === jwt.accessSecret || otp.hmacSecret === jwt.refreshSecret)) {
      issues.push('OTP_HMAC_SECRET: must be different from the JWT secrets');
    }
  }

  if (issues.length > 0) throw new ConfigurationError(issues);

  return deepFreeze({
    nodeEnv,
    port,
    corsOrigins,
    timezone,
    defaultLocale,
    logLevel,
    database,
    jwt,
    http,
    otp,
    redis,
    files,
  });
}
