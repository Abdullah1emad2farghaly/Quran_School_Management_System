import { SystemClock, type Clock } from '../../../00-shared-kernel/public';
import type { LogLevel } from '../../../01-configuration/public';
import { redact, sanitizeString } from '../../domain/services/redact';
import type { LogFields, Logger } from '../../application/ports/logger';
import { requestContext } from './request-context';

export type EmittedLevel = Exclude<LogLevel, 'silent'>;

export interface LogSink {
  write(level: EmittedLevel, line: string): void;
}

/** error/warn go to stderr, the rest to stdout. One JSON object per line. */
export const consoleSink: LogSink = {
  write(level, line) {
    (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(`${line}\n`);
  },
};

const SEVERITY: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const RESERVED = new Set(['level', 'time', 'msg']);

export interface CreateLoggerOptions {
  readonly level: LogLevel;
  readonly sink?: LogSink;
  readonly clock?: Clock;
  readonly bindings?: LogFields;
}

/**
 * Structured JSON logger with no external dependencies.
 * Every entry: { level, time, msg, requestId?, actorUserId?, ...bindings, ...fields }.
 * Fields are redacted; reserved keys (level/time/msg) cannot be overridden.
 */
export function createLogger(options: CreateLoggerOptions): Logger {
  const sink = options.sink ?? consoleSink;
  const clock = options.clock ?? new SystemClock();
  const bindings = options.bindings ?? {};

  const emit = (level: EmittedLevel, message: string, fields?: LogFields): void => {
    if (SEVERITY[level] < SEVERITY[options.level]) return;

    const context = requestContext.get();
    const entry: Record<string, unknown> = {
      level,
      time: clock.now().toISOString(),
      msg: sanitizeString(message),
    };
    if (context?.requestId) entry.requestId = context.requestId;
    if (context?.actorUserId) entry.actorUserId = context.actorUserId;

    const extra = redact({ ...bindings, ...fields }) as Record<string, unknown>;
    for (const [key, value] of Object.entries(extra)) {
      if (!RESERVED.has(key)) entry[key] = value;
    }

    let line: string;
    try {
      line = JSON.stringify(entry);
    } catch {
      line = JSON.stringify({ level, time: entry.time, msg: entry.msg, logError: 'unserializable fields' });
    }
    sink.write(level, line);
  };

  return {
    error: (m, f) => emit('error', m, f),
    warn: (m, f) => emit('warn', m, f),
    info: (m, f) => emit('info', m, f),
    debug: (m, f) => emit('debug', m, f),
    child: (extra) => createLogger({ ...options, bindings: { ...bindings, ...extra } }),
  };
}
