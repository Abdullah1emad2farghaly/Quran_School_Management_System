/**
 * Reads a ZIP file's central directory (no decompression) so an .xlsx can be
 * checked for structure and dangerous content before anything parses it.
 */
export class ZipFormatError extends Error {}

export interface ZipInfo {
  readonly entryNames: readonly string[];
  readonly entryCount: number;
  /** Sum of the sizes DECLARED in the directory (a parser must still enforce limits while reading). */
  readonly totalUncompressedBytes: number;
  readonly hasEncryptedEntries: boolean;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_MIN = 22;
const ZIP64_MARKER_32 = 0xffffffff;

export function inspectZip(buf: Buffer): ZipInfo {
  if (buf.length < EOCD_MIN) throw new ZipFormatError('too small to be a zip file');

  let eocd = -1;
  for (let i = buf.length - EOCD_MIN; i >= Math.max(0, buf.length - EOCD_MIN - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipFormatError('end of central directory not found');

  const entryCount = buf.readUInt16LE(eocd + 10);
  const dirSize = buf.readUInt32LE(eocd + 12);
  const dirOffset = buf.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || dirSize === ZIP64_MARKER_32 || dirOffset === ZIP64_MARKER_32) {
    throw new ZipFormatError('zip64 archives are not supported');
  }
  if (dirOffset + dirSize > eocd) throw new ZipFormatError('central directory out of bounds');

  const names: string[] = [];
  let total = 0;
  let encrypted = false;
  let pos = dirOffset;
  for (let i = 0; i < entryCount; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CENTRAL_SIGNATURE) {
      throw new ZipFormatError('invalid central directory entry');
    }
    const flags = buf.readUInt16LE(pos + 8);
    const uncompressed = buf.readUInt32LE(pos + 24);
    const nameLength = buf.readUInt16LE(pos + 28);
    const extraLength = buf.readUInt16LE(pos + 30);
    const commentLength = buf.readUInt16LE(pos + 32);
    const nameEnd = pos + 46 + nameLength;
    if (nameEnd > buf.length) throw new ZipFormatError('entry name out of bounds');
    if (uncompressed === ZIP64_MARKER_32) throw new ZipFormatError('zip64 entry sizes are not supported');

    names.push(buf.toString('utf8', pos + 46, nameEnd));
    total += uncompressed;
    if ((flags & 0x1) !== 0) encrypted = true;
    pos = nameEnd + extraLength + commentLength;
  }
  return { entryNames: names, entryCount, totalUncompressedBytes: total, hasEncryptedEntries: encrypted };
}
