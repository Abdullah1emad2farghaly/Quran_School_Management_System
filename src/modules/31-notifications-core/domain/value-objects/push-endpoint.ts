import { PUSH_LIMITS } from './notification-rules';

/**
 * The server will POST to the endpoint a browser hands over, so an endpoint must not be able to point the server at an internal address (SSRF guard):
 * https only, default port, a real DNS name (no IP literal, no single-label host, no localhost/.local/.internal), no credentials, bounded length. Real push
 * services (FCM, Mozilla, Windows, Apple) all satisfy this. Pure function.
 */
export function isSafePushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > PUSH_LIMITS.endpointMax || /\s/.test(endpoint)) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || (url.port !== '' && url.port !== '443')) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.includes(':') || host.startsWith('[')) return false; // IPv6 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return false; // IPv4 literal in any common spelling
  if (!host.includes('.')) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.home.arpa')) return false;
  return /^[a-z0-9.-]+$/.test(host);
}

/** A VAPID/WebPush key as sent by the browser: base64url text of a sensible length. */
export function isPushKey(value: unknown): value is string {
  return typeof value === 'string' && value.length >= PUSH_LIMITS.keyMin && value.length <= PUSH_LIMITS.keyMax && /^[A-Za-z0-9_-]+$/.test(value);
}
