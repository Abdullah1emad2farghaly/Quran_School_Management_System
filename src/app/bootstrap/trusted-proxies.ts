import type { Express } from 'express';

/**
 * Express only believes X-Forwarded-For (and so `req.ip`) when the connection comes from a TRUSTED proxy.
 * With no configured proxies (the default) the headers are ignored and `req.ip` is the real socket address, so a
 * client cannot forge its IP (this matters for the OTP rate limits). Configure `TRUSTED_PROXIES` explicitly before
 * deploying behind a reverse proxy or load balancer; arbitrary "trust everything" settings are rejected by the config.
 */
export function applyTrustedProxies(app: Express, trustedProxies: readonly string[]): void {
  app.set('trust proxy', trustedProxies.length > 0 ? [...trustedProxies] : false);
}
