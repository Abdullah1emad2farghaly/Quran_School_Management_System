import type { AppConfig } from '../../application/dto/app-config';

const REDACTED = '[REDACTED]';
const UNSET = '[UNSET]';

const mask = (value: string): string => (value ? REDACTED : UNSET);

/** Safe-to-log view of the configuration: secrets and passwords are masked. */
export function redactConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    database: { ...config.database, password: mask(config.database.password) },
    jwt: {
      accessSecret: mask(config.jwt.accessSecret),
      refreshSecret: mask(config.jwt.refreshSecret),
    },
    otp: { ...config.otp, hmacSecret: mask(config.otp.hmacSecret) },
  };
}
