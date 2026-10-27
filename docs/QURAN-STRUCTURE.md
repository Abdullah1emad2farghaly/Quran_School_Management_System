# Quran Structure (Module 21)

**Status: COMPLETED (0.29.1).** Approved and verified on the developer machine: `db:migrate` (all migrations), `test:db`, `npm test`, `api:verify`, `typecheck`, `build`, the real-dataset import and `npm run verify:quran`.

Immutable reference data of the one approved V1 edition: **Madinah Mushaf, Hafs narration from Asim, the standard 604-page edition**. Other modules (Module 22 Range Engine, schedules, sessions, memorization) depend on it; Module 20's `startingSurah` is a surah number of this structure.

## Approved sources (final decisions)

| Data | Source | Used how |
|---|---|---|
| Quran text (6236 ayahs), surah names, official page and line layout (pages, lines, banners, basmala lines), page/line of every ayah | official King Fahd Glorious Quran Printing Complex package `kfgqpc_hafs_v30.zip` (SHA-256 `227e6b1564d980f2bd09c2c35ebfb0330ac268c79a7c247cd1ab665bc635f245`, the value published by the Complex): CSV, JSON, DOCX | verbatim; CSV == JSON == Excel; CSV page/line == DOCX layout for every ayah |
| **Juz** (30 starts and the juz of every ayah) | the **official KFGQPC Excel** (`kfgqpc_hafs_v30.xlsx` of the same package), column `jozz` | **exactly as the Excel states**: never recalculated, inferred, replaced or normalized; the converter compares the whole workbook (11 columns, 6236 rows) with the CSV/JSON and **reports** any discrepancy instead of correcting it |
| **Quarters** (all 240 rub' al-hizb records) | the supplied **Tanzil `quran-data.xml`** (SHA-256 `8867c1d88191472adec9db694b3cd9f135b1a2ef580574d32cf888dcb22c5c7a`; the file states version 1.0, license `cc-by`, copyright `(C) 2008-2009 Tanzil.info`) | **exactly as the file states them**, followed in every disagreement with the package; **quarter 106 is at Al-Hijr 15:50**; the package is never a fallback; no position is invented |

Both files are pinned by SHA-256 in the converter: a different file is refused until it is added deliberately. Nothing from any other source is read, and a test guards that no other Quran data source is named in the code (Tanzil only in the quarter reader, the converter and its CLI). The original files are only read; the converter test and the verification script compare their SHA-256 before and after.

**The Excel file** is the workbook inside the approved package (no other Excel file was supplied). If a different KFGQPC Excel was meant, it must be provided and pinned.

**Usage terms (unverified, kept separate from implementation).** The developer page makes the data available for application and software development; no fee was found in the pages reviewed. Redistribution and production-deployment terms are being clarified and are not asserted either way; the dataset records `license: "UNVERIFIED: ..."` for the package and the file's own stated license (`cc-by`, attribution required) for the quarter file.

## What is stored

| Structure | V1 |
|---|---|
| Surahs | 114 (Arabic names, ayah counts equal to the Hafs count, total 6236) |
| Ayahs | 6236, official text verbatim; first/last page and line; **juz (Excel)**; **quarter and hizb (quarter file)**; `startsRubMarker` |
| Pages and lines | 604 pages, 9046 lines (602 pages of 15 lines, pages 1 and 2 of 8): 114 banner lines, 112 basmala lines (none for surahs 1 and 9), 8820 text lines |
| Juz | 30 starts (Excel) |
| Quarters | **240** records with their hizb (4 quarters per hizb) |
| Printed quarter markers | 199 marker symbols (U+06DE) printed in the official text: evidence about the text, a separate resource (`/quarter-marks`); NOT the quarter positions |
| Hizb as its own record | `quran_hizb` stays empty and reserved for exact hizb boundaries of a future version (not a V1 requirement) |

## The sources are not reconciled (known cross-source relationships)

By decision the juz come from the Excel and the quarters from the quarter file; they are **not** harmonized, and where they differ both are stored as their source states them:

- **Five juz start one or more ayahs away from their first quarter**: juz 4 (Excel 3:92, quarter 25 at 3:93), juz 11 (9:94, quarter 81 at 9:93), juz 20 (27:60, quarter 153 at 27:56), juz 21 (29:45, quarter 161 at 29:46), juz 23 (36:21, quarter 177 at 36:28). The `quran_quarters.juz_number` column is only the arithmetic position of the quarter (8 per juz) required by that table's CHECK; it is not exposed and is not the juz of the juz table.
- **Quarter 106**: the quarter file says 15:50, the printed marker symbol in the official text is on 15:49. The quarter record is 15:50 (quarter source), the marker resource keeps the printed fact. 198 of the 199 printed markers coincide with a quarter start; 42 quarter starts have no printed marker (41 at the first ayah of a surah).
- Each juz start is also classified, **informationally**, against the printed markers (`verification`: `MARKER_CONFIRMED` 16, `SURAH_START_NO_MARKER` 9, `MARKER_CONFLICT` 5). It never changes a juz value.

| Juz | Start (official Excel) | Page / line | Relation to the printed markers (informational) |
|---|---|---|---|
| 1 | 1:1 | 1 / 2 | SURAH_START_NO_MARKER | first ayah of a surah (no marker is printed there) |
| 2 | 2:142 | 22 / 1 | MARKER_CONFIRMED | start ayah carries the printed marker |
| 3 | 2:253 | 42 / 1 | MARKER_CONFIRMED | start ayah carries the printed marker |
| 4 | 3:92 | 62 / 1 | MARKER_CONFLICT | start ayah carries no printed marker; nearest printed markers 3:75 / 3:93 |
| 5 | 4:24 | 82 / 1 | MARKER_CONFIRMED | start ayah carries the printed marker |
| 6 | 4:148 | 102 / 1 | MARKER_CONFIRMED | start ayah carries the printed marker |
| 7 | 5:82 | 121 / 9 | MARKER_CONFIRMED | start ayah carries the printed marker |
| 8 | 6:111 | 142 / 1 | MARKER_CONFIRMED | start ayah carries the printed marker |
| 9 | 7:88 | 162 / 1 | MARKER_CONFIRMED | start ayah carries the printed marker |
| 10 | 8:41 | 182 / 1 | MARKER_CONFIRMED | start ayah carries the printed marker |
| 11 | 9:94 | 202 / 1 | MARKER_CONFLICT | start ayah carries no printed marker; nearest printed markers 9:93 / 9:111 |
| 12 | 11:6 | 222 / 1 | MARKER_CONFIRMED | start ayah carries the printed marker |
| 13 | 12:53 | 242 / 1 | MARKER_CONFIRMED | start ayah carries the printed marker |
| 14 | 15:1 | 262 / 3 | SURAH_START_NO_MARKER | first ayah of a surah (no marker is printed there) |
| 15 | 17:1 | 282 / 3 | SURAH_START_NO_MARKER | first ayah of a surah (no marker is printed there) |
| 16 | 18:75 | 302 / 1 | MARKER_CONFIRMED | start ayah carries the printed marker |
| 17 | 21:1 | 322 / 3 | SURAH_START_NO_MARKER | first ayah of a surah (no marker is printed there) |
| 18 | 23:1 | 342 / 3 | SURAH_START_NO_MARKER | first ayah of a surah (no marker is printed there) |
| 19 | 25:21 | 362 / 1 | MARKER_CONFIRMED | start ayah carries the printed marker |
| 20 | 27:60 | 382 / 6 | MARKER_CONFLICT | start ayah carries no printed marker; nearest printed markers 27:56 / 27:82 |
| 21 | 29:45 | 401 / 13 | MARKER_CONFLICT | start ayah carries no printed marker; nearest printed markers 29:26 / 29:46 |
| 22 | 33:31 | 422 / 1 | MARKER_CONFIRMED | start ayah carries the printed marker |
| 23 | 36:21 | 441 / 9 | MARKER_CONFLICT | start ayah carries no printed marker; nearest printed markers 35:41 / 36:28 |
| 24 | 39:32 | 462 / 1 | MARKER_CONFIRMED | start ayah carries the printed marker |
| 25 | 41:47 | 482 / 1 | MARKER_CONFIRMED | start ayah carries the printed marker |
| 26 | 46:1 | 502 / 9 | SURAH_START_NO_MARKER | first ayah of a surah (no marker is printed there) |
| 27 | 51:31 | 522 / 1 | MARKER_CONFIRMED | start ayah carries the printed marker |
| 28 | 58:1 | 542 / 3 | SURAH_START_NO_MARKER | first ayah of a surah (no marker is printed there) |
| 29 | 67:1 | 562 / 3 | SURAH_START_NO_MARKER | first ayah of a surah (no marker is printed there) |
| 30 | 78:1 | 582 / 3 | SURAH_START_NO_MARKER | first ayah of a surah (no marker is printed there) |

## Schema

Migrations (additive, in order; earlier ones untouched): `20261022100000-create-quran-structure`, `20261023100000-quran-structure-official-package-model`, `20261024100000-quran-structure-quarters` (the quarter of every ayah and the quarter count of an import; the second and third refuse to run if a reshaped table holds data), `20261026100000-quran-lines-kind-check-not-null` (`ck_quran_lines_kind` now states `surah_number IS NOT NULL` for banner and basmala lines: a CHECK accepts UNKNOWN, so a NULL surah used to pass; found by `tests/db/quran.test.ts` on MariaDB; drops and re-adds the constraint only, no data touched). Target: MariaDB 10.4. Tables: `quran_dataset_imports` (unique `active`: one ACTIVE import), `quran_surahs`, `quran_ayahs`, `quran_pages`, `quran_lines`, `quran_juz`, `quran_quarters` (quarter 1..240, hizb = ceil(q/4), unique start), `quran_quarter_marks`, and the reserved empty `quran_hizb`. No foreign key leaves the module.

## Interfaces

**REST** (`/api/v1/quran`, read-only, authentication required, permission `quran.structure.read` for every assignable role; no write endpoint): `GET /dataset` (metadata, checksum, attributions, counts, coverage), `/surahs`, `/surahs/{surah}`, `/surahs/{surah}/ayahs` (paginated), `/surahs/{surah}/ayahs/{ayah}`, `/ayahs/{position}`, `/pages/{page}` (with its lines), `/juz`, `/quarters`, `/quarters/{quarter}`, `/quarter-marks`. Out-of-range numbers answer `VALIDATION_FAILED` (400); valid numbers with no record `QURAN_*_NOT_FOUND` (404); every read answers `QURAN_DATASET_NOT_IMPORTED` (404) until a dataset has been imported (an import is atomic, so a failed import never leaves an active dataset). OpenAPI: `quranApiDoc`, 11 operations.

**`QuranStructureLookup`**: `getDatasetInfo`, `listSurahs`, `getSurah`, `getAyah`, `getAyahByGlobalPosition`, `listAyahsOfSurah`, `getPage`, `getLineByGlobalIndex`, `listJuzs`, `listQuarters`, `getQuarter`, `listQuarterMarks`. Every method but `getDatasetInfo` throws `QURAN_DATASET_NOT_IMPORTED` while nothing is imported. **Module 20**: `startingSurah` stays a surah number 1..114 (test); Module 20 is unchanged.

## Dataset file (`qsms-quran-structure`, format version 3)

`format`, `formatVersion: 3`, `edition`, `source` (provider, name, version, url, license status, `files` with the SHA-256 of every source file, `attributions`), `surahs`, `ayahs` (text required), `lines`, `juz` (30), `quarters` (240), `quarterMarks`. The validator rejects the whole file listing every problem when the format or edition is wrong; surahs or ayah counts differ from the Hafs count; a text is missing, untrimmed or lacks its end-of-ayah mark and own number; `quarterMarks` is not exactly the set of ayahs whose text starts with the marker; juz are not 30 in order from 1:1; **quarters are not exactly 240, misnumbered, duplicated, out of order, not real ayahs, or not starting at 1:1**; the layout breaks page/line numbering, ayah continuity or the banner rules; or a page anchor of the edition is contradicted.

## Checksums

- **Archive**: SHA-256 of the unmodified `kfgqpc_hafs_v30.zip` (pinned). **Quarter file**: SHA-256 of `quran-data.xml` (pinned). Both, with the JSON, CSV, Excel and DOCX hashes, are recorded in `source.files` of the dataset and of the import record.
- **Import checksum**: SHA-256 of the **exact bytes of the normalized dataset file** that `npm run import:quran` reads (computed from the file, never typed or defaulted). For the real sources it is `58d0069640dc853dc2a4d20806de61c0a4eee8a59479d6f1ae7ebf4a08b267d3` (2545041 bytes), reproducible with `npm run convert:quran`. It identifies the dataset artifact: the same bytes are `UNCHANGED`; a different file needs `--replace`.

## Procedure (deterministic, repeatable, no database until the last step)

```
npm run convert:quran -- path/to/kfgqpc_hafs_v30.zip path/to/quran-data.xml dataset.json   # approved sources -> normalized dataset
npm run import:quran  -- dataset.json --dry-run                                            # validates; the database is NOT touched
npm run db:migrate                                                                         # schema
npm run import:quran  -- dataset.json                                                      # import (idempotent: the same file changes nothing)
npm run verify:quran  -- path/to/kfgqpc_hafs_v30.zip path/to/quran-data.xml [--sqlite]     # full verification against the sources
```

The converter refuses a package or quarter file that is not the pinned one, verifies ZIP integrity, requires JSON == CSV == Excel (all columns, every row; discrepancies are reported, never corrected), the DOCX word stream == the official text, the CSV page/line range == the DOCX position for every ayah, one banner per surah equal to its official name, 112 basmala lines, 604 pages, a well-formed quarter file (indexes 1..N in order, real ayahs, strictly increasing), and aborts listing every problem otherwise. The same inputs always yield byte-identical output. `--replace` is only for replacing a *different* dataset and is never needed for a first import.

## Tests

`tests/unit/quran/*` (edition, validator incl. quarter records, service, importer, import and convert CLIs, converter with synthetic sources and **with the real files** when `QSMS_KFGQPC_PACKAGE` and `QSMS_TANZIL_XML` are set, ZIP/XLSX/DOCX/CSV/Tanzil readers, boundaries incl. the sources guard), `tests/integration/quran.test.ts`, `tests/api-docs/conformance/quran.test.ts`, `tests/db/quran.test.ts` (rolled back, never touches existing data). Default tests use a **synthetic** dataset and package that the real edition profile rejects.

## Verification status

See `docs/verification/module21/Module21-Final-Verification-Report.md` for the original verification. Final state (0.29.1): the project checks above pass on the developer machine against MariaDB 10.4, the real KFGQPC package and Tanzil file were imported, and `npm run verify:quran` passes with the real files; the original files were verified unchanged. Four issues found by those runs were fixed in 0.29.1 without touching the approved data: (1) the OpenAPI helper `nullableRef` (Module 04, used only here) now writes a nullable reference as `oneOf: [ref, {type: object, nullable: true, enum: [null]}]`, so banner and basmala lines (`firstAyah`/`lastAyah` null) validate under Ajv; (2) migration `20261026100000-quran-lines-kind-check-not-null` makes the database reject a banner/basmala line without a surah (a CHECK accepts UNKNOWN, so the NULL slipped through); (3) `tests/db/quran.test.ts` no longer collides with an already imported real dataset (it empties the tables only inside its own always-rolled-back transaction); (4) the verification script's schema checker now understands `oneOf` (`docs/verification/module21/openapi-subset-checker.ts`, covered by `tests/api-docs/quran-page-line-schema.test.ts`). There is no `lint` script.

## Open items

1. ~~Run the checks and the first real import~~ done (0.29.1).
2. Written clarification of redistribution and production terms of the sources (does not block development).