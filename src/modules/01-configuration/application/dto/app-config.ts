import type { Locale } from '../../domain/value-objects/locale';
import type { LogLevel } from '../../domain/value-objects/log-level';

export type NodeEnvironment = 'development' | 'test' | 'production';

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
  readonly redis: {
    readonly host: string;
    readonly port: number;
  };
  readonly files: {
    readonly storagePath: string;
    readonly maxFileSize: number;
  };
}
