# Module 21 (Quran Structure): final report, 0.29.0

## 1. Final status: IN_PROGRESS
Not COMPLETED. Every approved requirement is implemented and has been verified as far as the build environment allows, but the completion criteria require the project checks to have been run and passed, and these could not be run: the environment has **no MariaDB/MySQL server, no installed dependencies (`node_modules`), no network and no configured database**. This is an environment limitation, not a test failure: nothing that ran failed.

## 2. Requirements verified
| Requirement | Result |
|---|---|
| Juz exactly as the official KFGQPC Excel (`jozz`), no recalculation, inference, replacement or normalization | **Done.** The converter reads the workbook inside the approved package and compares all 11 columns of the 6236 rows with the CSV/JSON (reports any discrepancy, never corrects); juz starts and the juz of every ayah are the Excel values. Independent Python check: the first ayah of each Excel `jozz` equals the 30 imported starts |
| All 240 quarter records from the supplied Tanzil `quran-data.xml`, followed in every disagreement | **Done.** 240 records imported exactly as the file states; compared with the file itself (not with a constant) by the unit test, by `verify:quran` and by an independent Python parse |
| Quarter 106 at Al-Hijr 15:50 | **Confirmed** (section 4) |
| No combination of quarter positions, no KFGQPC fallback, no invented positions | Printed marker symbols stay a separate evidence resource (`/quarter-marks`); the quarter positions are only the Tanzil records. A guard test forbids naming any other Quran data source; Tanzil only in its reader, the converter and its CLI |
| Original source files unchanged | Verified by SHA-256 before and after (section 9) |
| Validation of the quarter records: present, ordered, valid references, duplicates, missing indexes | Reader and validator reject duplicates, gaps, out-of-order, invalid ayahs, not-starting-at-1:1; unit tests for each |
| Other approved data (surahs, ayahs, pages, lines, text) preserved | Unchanged sources and interpretation |
| Database integrity (keys, uniques, CHECKs, one ACTIVE import, atomic import) | Verified on a SQLite emulation whose schema is built from the three migration files (section 3); **not on MariaDB** |
| API under `/api/v1/quran`, validation, errors, pagination, authorization, OpenAPI | OpenAPI document builds (11 operations, examples and error codes validated by the project's builder); every endpoint's data validated against the schemas for the whole real dataset; the real HTTP routes were **not** run (no express) |
| No endpoint claims an active dataset after a failed import | An import is one transaction with a row-count check; a failed first import leaves every table empty, a failed replacement keeps the previous dataset whole; every read answers `QURAN_DATASET_NOT_IMPORTED` until an import succeeds |
| Module 22 not started | Not started |

## 3. Data verification (real files; `npm run verify:quran -- <zip> <xml> --sqlite`: 130 checks, 0 failed)
- **Archive** SHA-256 `227e6b1564d980f2bd09c2c35ebfb0330ac268c79a7c247cd1ab665bc635f245` = the published value. **Quarter file** SHA-256 `8867c1d88191472adec9db694b3cd9f135b1a2ef580574d32cf888dcb22c5c7a` (pinned).
- **Import checksum** (SHA-256 of the exact bytes of the converted dataset file, 2,545,041 bytes): `58d0069640dc853dc2a4d20806de61c0a4eee8a59479d6f1ae7ebf4a08b267d3`; the conversion is byte-identical across runs; the archive and quarter-file hashes are recorded separately in the import record.
- **Counts** (persisted in the SQLite emulation after the real import use case): 114 surahs, 6236 ayahs, 604 pages, 9046 lines (8820 text, 114 banners, 112 basmalas; pages 1 and 2 have 8 lines, all others 15), 30 juz, **240 quarters**, 199 printed marker symbols, 1 ACTIVE import, `quran_hizb` 0 (reserved).
- **Text**: all 6236 persisted and served texts are byte-identical to the official JSON. **Pages and lines**: persisted page and line range of all 6236 ayahs equal the CSV (and the CSV equals the DOCX layout for every ayah). **Juz**: the persisted and served juz of all 6236 ayahs equal the Excel workbook, and the 30 starts equal the first ayah of each Excel value. **Quarters**: all 240 persisted rows equal the XML records in order; hizb = ceil(quarter / 4); every ayah's quarter is the quarter that starts at or before it.
- **Surah and ayah references**: every quarter and juz reference is a real ayah of the Hafs count; ayah counts per surah sum to 6236 and `first_global_ayah` values are consecutive.

## 4. Quarter 106 confirmation
**Imported position: Al-Hijr (surah 15), ayah 50 (15:50).** Evidence: the Tanzil XML states `<quarter index="106" sura="15" aya="50">`; the converted dataset, the persisted `quran_quarters` row (SQLite emulation) and `GET /quarters/106` (service level) all give 15:50; ayah 15:49 belongs to quarter 105 and 15:50 to quarter 106. The official text also prints a marker symbol on 15:49: it is kept as a separate fact about the text (`startsRubMarker`, `/quarter-marks`) and does not replace or move the quarter record.

## 5. Files changed
**Pre-existing files modified (all additive; nothing else in the project was touched):** `src/app/routes/index.ts` (mount `/quran`), `src/app/openapi/api-documents.ts` (register the contract), `src/app/bootstrap/register-error-messages.ts` (register messages), `package.json` (scripts `convert:quran`, `import:quran`, `verify:quran`), `tests/api-docs/error-kinds.test.ts` and `request-validation.test.ts` (register Module 21), `README.md`, `docs/{AUTHORIZATION-MATRIX,DATABASE,IMPLEMENTATION-STATUS,PROJECT-CHANGELOG}.md`.
**Module 21 (new, this and earlier rounds):** `src/modules/21-quran-structure/**` (domain model and validator with the quarter rules; application service, ports, DTOs, import use case; in-memory and Sequelize repositories; ZIP, XLSX, DOCX, Tanzil readers and the converter; routes and OpenAPI), `src/config/quran.ts`, `src/app/cli/{convert-kfgqpc-hafs,import-quran-structure}*.ts`, migrations `20261022100000-…`, `20261023100000-…`, `20261024100000-quran-structure-quarters.js`, tests under `tests/unit/quran`, `tests/integration/quran.test.ts`, `tests/api-docs/conformance/quran.test.ts`, `tests/db/quran.test.ts`, `tests/helpers/quran-*.ts`, `docs/QURAN-STRUCTURE.md`, `docs/verification/module21/**`.
**Why in this round:** to implement the final source decisions (juz from the Excel, 240 Tanzil quarters, attributions, quarter of each ayah, `/quarters`), the migration that carries them, the converter's new inputs and pinning, and the tests and verification for them. A stale column list in the DB test (`has_text`, removed by an earlier migration) was also fixed.

## 6. Database changes
Migration `20261024100000-quran-structure-quarters.js` (additive; refuses to run if a reshaped table holds data; MariaDB 10.4 syntax): `quran_ayahs.quarter_number` (+ CHECK 1..240) and `quran_dataset_imports.quarter_count`. The existing `quran_quarters` table (quarter 1..240, hizb = CEIL(q/4), unique start) now holds the 240 records. No table is dropped; the earlier migrations are untouched. The migrations have **not been executed on MariaDB**; their statements were executed against SQLite through a recording interface that builds the emulation schema (it does not prove MariaDB acceptance).

## 7. Tests and checks executed (actual results)
| Check | Result |
|---|---|
| Module 21 unit tests (8 files; stand-in runner because vitest is not installed) | **93 passed, 0 failed**; **101 passed, 0 failed** with the real files supplied (`QSMS_KFGQPC_PACKAGE`, `QSMS_TANZIL_XML`). Output: `unit-tests-output.txt` |
| `verify:quran -- <zip> <xml>` (in-memory) and with `--sqlite` | in-memory part passed; full run **130 passed, 0 failed**. Output: `e2e-output.txt` |
| Convert CLI logic on the real files; import CLI logic with `--dry-run` on the result | converted (all cross-checks passed); dry run VALID; database not touched |
| OpenAPI document build with the project's builder | built, 11 operations |
| Partial TypeScript check (Module 21 sources, CLIs, tests, verification script; dependency-typed code excluded) | no errors |
| Independent Python check of Excel juz and Tanzil quarters against the converted dataset | both equal |

**Not run (environment limitation, not failures):** `npm run typecheck`, `npm run build`, `npm test` (unit tests of other modules, integration and the real HTTP routes of Module 21, e2e), `npm run api:verify` (ajv conformance, route inventory, security drift), `npm run db:migrate`, `npm run test:db`, regression tests of Modules 00-20 (none of their files changed), the real import into a database. There is no `lint` script in `package.json`.

## 8. Known issues and limitations
1. The five juz that start away from their first quarter (juz 4: Excel 3:92 / quarter 25 at 3:93; juz 11: 9:94 / 9:93; juz 20: 27:60 / 27:56; juz 21: 29:45 / 29:46; juz 23: 36:21 / 36:28) are a consequence of the two approved sources and are not reconciled: both are stored and served as stated. The Excel file used is the one inside the approved package (no separate Excel was supplied).
2. 41 of the 42 quarter starts without a printed marker are at the first ayah of a surah; irrelevant to the data (quarters come from the quarter file) but documented.
3. The SQLite emulation is not MariaDB. The ajv conformance, the real HTTP routes, the migrations on MariaDB and the project typecheck/build are unverified.
4. Redistribution and production terms of the sources are unconfirmed (Tanzil's file states `cc-by`, attribution required, recorded with the import); not a blocker for development.

## 9. Source integrity
SHA-256 of `kfgqpc_hafs_v30.zip` (which contains the original CSV, JSON, DOCX and the Excel) and of `quran-data.xml` were recorded before this round's work, re-checked after the whole verification run (inside the script) and again afterwards: **unchanged and equal to the pinned values**. All code reads the files only; the Excel is read from inside the archive and never written.

## 10. Next action
Module 21 is **functionally complete and verified within the environment's limits, but not ready to be marked COMPLETED**. To finish: on a machine with the dependencies and a **development** MariaDB, run `npm install`, `npm run typecheck`, `npm run build`, `npm test`, `npm run api:verify`, `npm run db:migrate`, `npm run test:db`, then `npm run convert:quran -- kfgqpc_hafs_v30.zip quran-data.xml dataset.json`, `npm run import:quran -- dataset.json --dry-run`, `npm run import:quran -- dataset.json`, and `npm run verify:quran -- kfgqpc_hafs_v30.zip quran-data.xml`; send me the results (or any failure) and I will fix and finalize. Module 22 is not started and waits for your explicit approval.
