/** V1 supports Excel .xlsx only (Master Specification §73). */
export const EXCEL_EXTENSION = 'xlsx';
export const EXCEL_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const MAX_EXCEL_FILE_BYTES = 10 * 1024 * 1024;
/** Enforced by the Excel import module (36) while parsing; exported here as the single source of the limit. */
export const MAX_EXCEL_ROWS = 10_000;

/** Metadata of a stored file. There is deliberately no "public" flag: files are private by default. */
export interface StoredFile {
  readonly id: string;
  /** Sanitized, for display only. Never used to build paths. */
  readonly originalName: string;
  /** Server-generated key inside the private storage root. */
  readonly storageKey: string;
  readonly extension: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  /** What the file is for, e.g. "excel_import". */
  readonly purpose: string;
  /** Uploader (from the authenticated session, never from client input). */
  readonly ownerUserId: string | null;
  readonly createdAt: Date;
}
