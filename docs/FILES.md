# File Infrastructure

Owned by Module 07 (`src/modules/07-file-infrastructure`). V1 supports **Excel `.xlsx` only**, max **10 MB** and **10,000 rows** (`MAX_EXCEL_FILE_BYTES`, `MAX_EXCEL_ROWS`). No generic PDF/certificate management.

## Private by default
- Files live under `FILE_STORAGE_PATH` (not web-served). There is **no public URL** and no "public" column.
- This module stores and reads files; it does **not** decide who may access them. Callers must authorize first. Module 39 validates authentication, permission, scope, ownership and visibility.
- `ownerUserId` comes from the authenticated session, never from client input.

## Upload validation (by content, not by client headers)
`validateExcelFile` checks, in order: not empty → size (smaller of `MAX_FILE_SIZE` and 10 MB) → extension `.xlsx` → ZIP signature → valid ZIP directory → contains `[Content_Types].xml` and `xl/workbook.xml` → no unsafe content:
macros (`vbaProject`), embedded objects (`xl/embeddings/`, `xl/activeX/`), `.exe`/`.dll` entries, encrypted entries, path tricks (`..`, absolute paths, backslashes), more than 5,000 entries, or more than 200 MB declared uncompressed. The client's `Content-Type` is ignored.
The row limit is enforced by the import module (36) while parsing; the parser must also enforce size limits while reading (declared sizes can lie).

Errors (stable codes, Arabic + English messages): `FILE_EMPTY`, `FILE_TOO_LARGE` (413), `FILE_TYPE_NOT_ALLOWED`, `FILE_CORRUPT`, `FILE_UNSAFE_CONTENT`, `FILE_NOT_FOUND` (404), `FILE_INTEGRITY_FAILED`.

## Storage
- Server-generated keys `YYYY/MM/<uuid>.xlsx`; the client's file name is sanitized and kept for display only, never used in a path.
- `LocalFileStorage`: keys are validated, the resolved path must stay inside the root, writes go to a temp file then an atomic rename, files are created with mode 600.
- Metadata (`stored_files`): name, key, extension, MIME, size, SHA-256, purpose, owner, `deleted_at`. Delete removes the bytes and keeps the row.
- Reads verify the SHA-256; a mismatch or missing bytes returns `FILE_INTEGRITY_FAILED` and is logged.

## Usage
```ts
const files = getFileService();                                   // src/config/files.ts
const saved = await files.saveExcel({ originalName, data, purpose: 'excel_import', ownerUserId }, tx);
const { file, data } = await files.readContent(saved.id);         // after the caller has authorized access
```
Passing `tx` makes the metadata atomic with the caller's transaction. The bytes are written outside any transaction; if it rolls back, an unreferenced file remains (harmless; a cleanup sweep can remove it).

## HTTP upload
Multipart parsing is not part of this module (it needs an upload library, e.g. multer with memory storage, limited to the configured size). It is added with the Excel import module (36), where the upload endpoint lives.

## Testing other modules
`InMemoryFileStorage` + `InMemoryStoredFileRepository`; `tests/helpers/zip-builder.ts` builds minimal valid/invalid `.xlsx` archives.
