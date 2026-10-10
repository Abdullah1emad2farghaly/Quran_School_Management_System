import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from '../../../05-logging-request-context/public';
import type { BackgroundRunner, OtpMessage, OtpSender } from '../../application/ports/recovery-ports';

/** The real SMS/WhatsApp provider is chosen later; until then production delivery is simply not configured. */
export class OtpDeliveryNotConfiguredError extends Error {
  constructor() {
    super('OTP delivery is not configured');
    this.name = 'OtpDeliveryNotConfiguredError';
  }
}

/** Default sender: delivers nothing. The caller still gets the normal answer (no account information leaks). */
export class DisabledOtpSender implements OtpSender {
  async send(_message: OtpMessage): Promise<void> {
    throw new OtpDeliveryNotConfiguredError();
  }
}

/** TEST ONLY: keeps messages in memory so automated tests can read the OTP. Nothing is logged or written. */
export class InMemoryOtpSender implements OtpSender {
  readonly messages: OtpMessage[] = [];
  /** Make the next `send` calls fail (to test that delivery failures stay invisible). */
  failing = false;

  async send(message: OtpMessage): Promise<void> {
    if (this.failing) throw new Error('simulated delivery failure');
    this.messages.push(message);
  }

  /** The most recent OTP sent to a phone (E.164). */
  lastFor(phone: string): OtpMessage | undefined {
    return [...this.messages].reverse().find((m) => m.phone === phone);
  }
}

/**
 * DEVELOPMENT ONLY, for manual testing: writes the latest OTP per phone to a local JSON file (default
 * `.dev-otp/otp-outbox.json`, owner-only permissions, ignored by Git) instead of sending it. It never uses the
 * logger. It refuses to be created in production (the configuration also rejects OTP_SENDER=dev-file there).
 */
export class DevFileOtpSender implements OtpSender {
  constructor(
    private readonly filePath: string,
    nodeEnv: string,
  ) {
    if (nodeEnv === 'production') throw new Error('DevFileOtpSender must never be used in production');
  }

  async send(message: OtpMessage): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    let current: Record<string, unknown> = {};
    try {
      current = JSON.parse(await readFile(this.filePath, 'utf8')) as Record<string, unknown>;
    } catch {
      /* first message, or an unreadable file: start again */
    }
    current[message.phone] = {
      otp: message.otp,
      sentAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + message.expiresInSeconds * 1000).toISOString(),
    };
    await writeFile(this.filePath, JSON.stringify(current, null, 2), { encoding: 'utf8', mode: 0o600 });
  }
}

/**
 * Production background runner: starts the task without waiting for it. A failure is logged with the error NAME only
 * (never the message, the phone or the OTP, because provider errors can echo the request).
 */
export function createLoggingBackgroundRunner(logger: Logger): BackgroundRunner {
  return (task) => {
    void task().catch((error: unknown) => {
      logger.warn('OTP delivery failed', { errorName: error instanceof Error ? error.name : 'UnknownError' });
    });
  };
}
