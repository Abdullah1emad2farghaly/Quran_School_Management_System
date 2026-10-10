import type { Locale } from '../../domain/value-objects/locale';
import type { LogLevel } from '../../domain/value-objects/log-level';

export type NodeEnvironment = 'development' | 'test' | 'production';
export type OtpSenderKind = 'disabled' | 'dev-file';

/** Typed, validated, immutable application configuration. */
export interface AppConfig {
  readonly nodeEnv: NodeEnvironment;
  readonly port: number;
  readonly corsOrigins: readonly string[];
  /** Business/display timezone (IANA name). Database timestamps stay UTC. */
  readonly timezone: string;
  readonly defaultLocale: Locale;
  /** Minimum level written to logs. Defaults to "silent" in test, "info" otherwise. */
  readonly logLevel: LogLevel;
  readonly database: {
    readonly host: string;
    readonly port: number;
    readonly name: string;
    readonly user: string;
    readonly password: string;
  };
  readonly jwt: {
    readonly accessSecret: string;
    readonly refreshSecret: string;
  };
  readonly http: {
    /**
     * Proxies whose X-Forwarded-* headers are trusted (IP, CIDR, or loopback/linklocal/uniquelocal).
     * Empty (the default) means forwarding headers are NEVER trusted.
     */
    readonly trustedProxies: readonly string[];
  };
  readonly otp: {
    /** Dedicated secret for OTP / reset-token hashing (never reuse the JWT secrets). */
    readonly hmacSecret: string;
    /** How OTPs are delivered. `disabled` = no delivery; `dev-file` = development only. Real providers come later. */
    readonly sender: OtpSenderKind;
  };
  readonly redis: {
    readonly host: string;
    readonly port: number;
  };
  readonly files: {
    readonly storagePath: string;
    readonly maxFileSize: number;
  };
}
