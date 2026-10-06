/**
 * Log sanitization. Nothing sensitive may reach the logs: passwords, plaintext
 * OTPs, tokens, secrets, authorization data. Keys are matched by name; strings
 * are scanned for JWTs, Bearer tokens and credentials embedded in URLs.
 */
export const REDACTED = '[REDACTED]';

const SENSITIVE_KEY = /(password|passwd|passphrase|secret|token|authorization|cookie|apikey|credential|jwt|privatekey)/;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const URL_CREDENTIALS = /(:\/\/[^:/\s@]+:)[^@\s/]+@/g;

export interface RedactOptions {
  readonly maxDepth?: number;
  readonly maxStringLength?: number;
  readonly maxArrayLength?: number;
}

const DEFAULTS = { maxDepth: 6, maxStringLength: 2000, maxArrayLength: 50 } as const;

export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_KEY.test(normalized) || normalized.startsWith('otp') || normalized.endsWith('otp');
}

export function sanitizeString(value: string, maxLength: number = DEFAULTS.maxStringLength): string {
  let out = value
    .replace(JWT_PATTERN, '[REDACTED_JWT]')
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
    .replace(URL_CREDENTIALS, '$1[REDACTED]@');
  if (out.length > maxLength) out = `${out.slice(0, maxLength)}…[truncated]`;
  return out;
}

type Resolved = Required<RedactOptions>;

function serializeError(err: Error, opts: Resolved, depth: number, seen: Set<object>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: err.name,
    message: sanitizeString(err.message, opts.maxStringLength),
  };
  const withExtras = err as Error & { code?: unknown; kind?: unknown; cause?: unknown };
  if (typeof withExtras.code === 'string') out.code = withExtras.code;
  if (typeof withExtras.kind === 'string') out.kind = withExtras.kind;
  if (err.stack) out.stack = sanitizeString(err.stack, opts.maxStringLength);
  if (withExtras.cause !== undefined && depth < opts.maxDepth) {
    out.cause = redactInner(withExtras.cause, opts, depth + 1, seen);
  }
  return out;
}

function redactInner(value: unknown, opts: Resolved, depth: number, seen: Set<object>): unknown {
  if (value === null || value === undefined) return value;
  switch (typeof value) {
    case 'string':
      return sanitizeString(value, opts.maxStringLength);
    case 'number':
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'symbol':
      return value.toString();
    case 'function':
      return '[Function]';
  }
  const obj = value as object;
  if (obj instanceof Date) return Number.isNaN(obj.getTime()) ? 'Invalid Date' : obj.toISOString();
  if (ArrayBuffer.isView(obj) || obj instanceof ArrayBuffer) return '[Binary]';
  if (seen.has(obj)) return '[Circular]';
  if (depth > opts.maxDepth) return '[MaxDepth]';

  seen.add(obj);
  try {
    if (obj instanceof Error) return serializeError(obj, opts, depth, seen);
    if (obj instanceof Map) return '[Map]';
    if (obj instanceof Set) return '[Set]';
    if (Array.isArray(obj)) {
      const items = obj.slice(0, opts.maxArrayLength).map((v) => redactInner(v, opts, depth + 1, seen));
      if (obj.length > opts.maxArrayLength) items.push(`…(+${obj.length - opts.maxArrayLength} more)`);
      return items;
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redactInner((obj as Record<string, unknown>)[key], opts, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(obj);
  }
}

/** Returns a JSON-safe, sanitized copy of any value. Never mutates the input. */
export function redact(value: unknown, options: RedactOptions = {}): unknown {
  return redactInner(value, { ...DEFAULTS, ...options }, 0, new Set());
}
