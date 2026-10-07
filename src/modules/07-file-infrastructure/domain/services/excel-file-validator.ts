import { createHash } from 'node:crypto';
import { FileErrorCodes, fileError } from '../errors/file-errors';
import { EXCEL_EXTENSION, EXCEL_MIME_TYPE, MAX_EXCEL_FILE_BYTES } from '../value-objects/stored-file';
import { extensionOf, sanitizeFileName } from './file-name';
import { ZipFormatError, inspectZip } from './zip-inspector';

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const MAX_ENTRIES = 5000;
const MAX_DECLARED_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;

export interface ValidatedExcelFile {
  readonly originalName: string;
  readonly extension: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

function isUnsafeEntry(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.startsWith('/') ||
    lower.includes('..') ||
    lower.includes('\\') ||
    lower.includes('vbaproject') || // VBA macros
    lower.startsWith('xl/embeddings/') || // embedded objects/executables
    lower.startsWith('xl/activex/') ||
    lower.endsWith('.exe') ||
    lower.endsWith('.dll')
  );
}

/**
 * Validates an uploaded Excel file by CONTENT, never by the client's content-type:
 * .xlsx only, ≤ 10 MB (or the configured lower limit), valid ZIP/OOXML structure,
 * no macros, embedded objects, encryption, path tricks, or oversized archives.
 * Row count (≤ 10,000) is enforced by the import module while parsing.
 */
export function validateExcelFile(
  input: { originalName: string; data: Buffer },
  maxBytes: number = MAX_EXCEL_FILE_BYTES,
): ValidatedExcelFile {
  const limit = Math.min(maxBytes, MAX_EXCEL_FILE_BYTES);
  const { data } = input;

  if (data.length === 0) throw fileError(FileErrorCodes.FILE_EMPTY);
  if (data.length > limit) {
    throw fileError(FileErrorCodes.FILE_TOO_LARGE, { maxMb: Math.round((limit / (1024 * 1024)) * 10) / 10 });
  }

  const originalName = sanitizeFileName(input.originalName, `file.${EXCEL_EXTENSION}`);
  if (extensionOf(originalName) !== EXCEL_EXTENSION) throw fileError(FileErrorCodes.FILE_TYPE_NOT_ALLOWED);
  if (!data.subarray(0, 4).equals(ZIP_MAGIC)) throw fileError(FileErrorCodes.FILE_CORRUPT);

  let info;
  try {
    info = inspectZip(data);
  } catch (error) {
    if (error instanceof ZipFormatError) throw fileError(FileErrorCodes.FILE_CORRUPT);
    throw error;
  }

  const names = new Set(info.entryNames);
  if (!names.has('[Content_Types].xml') || !names.has('xl/workbook.xml')) {
    throw fileError(FileErrorCodes.FILE_CORRUPT);
  }
  if (
    info.hasEncryptedEntries ||
    info.entryCount > MAX_ENTRIES ||
    info.totalUncompressedBytes > MAX_DECLARED_UNCOMPRESSED_BYTES ||
    info.entryNames.some(isUnsafeEntry)
  ) {
    throw fileError(FileErrorCodes.FILE_UNSAFE_CONTENT);
  }

  return {
    originalName,
    extension: EXCEL_EXTENSION,
    mimeType: EXCEL_MIME_TYPE,
    sizeBytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}
