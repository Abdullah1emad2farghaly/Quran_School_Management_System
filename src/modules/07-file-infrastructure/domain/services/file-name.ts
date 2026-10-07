const MAX_NAME_LENGTH = 255;

/**
 * Makes a client-provided file name safe to STORE AND DISPLAY: drops any
 * directory part, control characters and reserved characters. The result is
 * never used to build filesystem paths.
 */
export function sanitizeFileName(raw: string, fallback = 'file'): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  let name = base.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[<>:"|?*]/g, '_');
  name = name.replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  if (name === '') return fallback;
  if (name.length > MAX_NAME_LENGTH) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot) : '';
    name = name.slice(0, MAX_NAME_LENGTH - ext.length) + ext;
  }
  return name;
}

/** Lower-case extension without the dot ("" if none). */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
}
