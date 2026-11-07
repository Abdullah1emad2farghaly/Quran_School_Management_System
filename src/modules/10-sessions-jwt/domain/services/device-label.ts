/**
 * "My devices": a SAFE description of the device, derived from the User-Agent header at login. Only a coarse browser and operating
 * system name is kept (for example "Chrome on Android"); the raw header, the IP address and any version number are never stored.
 */
export const MAX_DEVICE_LABEL_LENGTH = 100;
export const UNKNOWN_DEVICE_LABEL = 'Unknown device';

// Order matters: Edge, Opera and Samsung Internet also say "Chrome"; Chrome also says "Safari".
const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:Edg|EdgA|EdgiOS|Edge)\//i, 'Edge'],
  [/\b(?:OPR|Opera)\//i, 'Opera'],
  [/\bSamsungBrowser\//i, 'Samsung Internet'],
  [/\b(?:Firefox|FxiOS)\//i, 'Firefox'],
  [/\b(?:Chrome|CriOS|Chromium)\//i, 'Chrome'],
  [/\bSafari\//i, 'Safari'],
];

// Order matters: Android user agents also say "Linux"; iPhone/iPad user agents also say "Mac OS X".
const SYSTEMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bAndroid\b/i, 'Android'],
  [/\b(?:iPhone|iPad|iPod)\b/i, 'iOS'],
  [/\bWindows\b/i, 'Windows'],
  [/\b(?:Macintosh|Mac OS X)\b/i, 'macOS'],
  [/\bCrOS\b/i, 'ChromeOS'],
  [/\bLinux\b/i, 'Linux'],
];

/** Pure: no I/O. Always returns a short, printable label (never throws, never echoes the header). */
export function deviceLabelFromUserAgent(userAgent: unknown): string {
  if (typeof userAgent !== 'string' || userAgent.trim() === '') return UNKNOWN_DEVICE_LABEL;
  const ua = userAgent.slice(0, 512);
  const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(ua))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? UNKNOWN_DEVICE_LABEL;
}

/** Defensive normalization of a stored/supplied label: printable text only, trimmed, at most 100 characters; empty becomes null. */
export function normalizeDeviceLabel(label: unknown): string | null {
  if (typeof label !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = label.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_DEVICE_LABEL_LENGTH);
  return cleaned === '' ? null : cleaned;
}
