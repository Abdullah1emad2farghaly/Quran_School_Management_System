# Configuration

Owned by Module 01 (`src/modules/01-configuration`). `.env` / `process.env` is read in exactly one place, `src/config/env.ts`; everything else receives a typed, validated, immutable `AppConfig`.

On any invalid value the server refuses to start and prints **all** problems at once (variable names only, never values).

| Variable | Default | Rules |
|---|---|---|
| NODE_ENV | development | development, test, production |
| PORT | 3000 | 1–65535 |
| CORS_ORIGINS | (empty = browsers denied) | comma-separated `scheme://host[:port]`; no path, no `*` |
| APP_TIMEZONE | Africa/Cairo | valid IANA timezone |
| DEFAULT_LOCALE | ar | ar, en |
| LOG_LEVEL | info (silent when NODE_ENV=test) | silent, error, warn, info, debug |
| DATABASE_HOST / PORT | 127.0.0.1 / 3306 | port 1–65535 |
| DATABASE_NAME / USER / PASSWORD | empty | **required in production** |
| JWT_ACCESS_SECRET / JWT_REFRESH_SECRET | empty | **required in production**, ≥ 32 chars, must differ |
| OTP_HMAC_SECRET | empty | **required in production**, ≥ 32 chars, must differ from both JWT secrets (dedicated key for OTP / reset-token hashing) |
| OTP_SENDER | disabled | `disabled` or `dev-file` (development only; rejected in production) |
| TRUSTED_PROXIES | empty (none trusted) | comma-separated IPs, CIDR ranges or `loopback`/`linklocal`/`uniquelocal`; `true`, hop counts, `*` and `/0` ranges are rejected |
| REDIS_HOST / PORT | 127.0.0.1 / 6379 | port 1–65535 |
| FILE_STORAGE_PATH | ./storage | |
| MAX_FILE_SIZE | 10485760 | positive integer (bytes) |

Use `redactConfig(config)` whenever configuration must be logged.

Note: `database/config.cjs` (sequelize-cli) reads the same `DATABASE_*` variables directly because the CLI runs outside the app.
