# Module 36 — Excel Import

Status: **IMPLEMENTED, NOT verified on the owner's machine** (see `docs/MODULE-36-NOTES.md` for what was and was not run).
Source of truth: Master Specification §73-§79, plus the decisions the project owner approved on **2026-11-10** (recorded below).

## What it does
A School Manager imports students, parents, teachers, groups and group schedules from one `.xlsx` file:

1. **Download a template** (Arabic or English): `GET /excel-imports/template?language=ar|en`.
2. **Upload** the filled file: `POST /excel-imports/previews` (multipart field `file`). The file is validated by content (Module 07), parsed, and **analyzed only**: nothing is written. The answer is the **preview**: a summary (new / existing users, students, parents, teachers, groups), every finding (error, conflict, warning) in Arabic and English, and the analyzed rows with their parsed schedule. The preview is kept on the server for **24 hours**, private to its creator.
3. **Confirm** by preview id: `POST /excel-imports/previews/:id/confirm` (no second upload). **All-or-nothing.** Or **cancel**: `POST /excel-imports/previews/:id/cancel`. Read it any time: `GET /excel-imports/previews/:id?page=&pageSize=`.

## Columns (§75)
| # | Column (Arabic / English) | Required | Rule |
|---|---|---|---|
| 1 | اسم الطالب الكامل / Student Full Name | yes | At least 3 parts; parts 2 and 3 are the parent's first and second names (Module 19). |
| 2 | الرقم القومي للطالب / Student National ID | yes | 14 digits, globally unique (Arabic digits accepted). |
| 3 | اسم ولي الأمر الكامل / Parent Full Name | yes | Exactly 3 parts (Module 17). |
| 4 | هاتف ولي الأمر / Parent Phone | yes | Identity key of the parent account (Module 08 phone rules). |
| 5 | عنوان ولي الأمر / Parent Address | yes | `Governorate / Center or City / Village`, validated by Module 15 for the school's organization. |
| 6 | اسم الحلقة / Group Name | yes | Unique per school (Module 20 rules). |
| 7 | اسم المعلم / Teacher Name | yes | Exactly 3 parts (Module 18). |
| 8 | هاتف المعلم / Teacher Phone | yes | Identity key of the teacher account. |
| 9 | نمط التعلم / Learning Mode | yes | `GROUP`/`INDIVIDUAL` or `جماعي`/`فردي`. |
| 10 | اتجاه التقدم / Progression Direction | yes | `FORWARD`/`BACKWARD` or `للأمام`/`للخلف`. |
| 11 | سورة البداية / Starting Surah | yes | Surah number 1-114. |
| 12 | جدول الحلقة / Group Schedule | no | See below. Empty = the group is imported without a schedule. |

Headers of **either language are recognized in either template** (with or without the `*`, spacing, diacritics). A column that is not part of the template is ignored with a warning. Up to **10,000 data rows** and **10 MB** (Module 07 limits). The header row is searched in the first 10 non-empty rows. The templates contain no example row (a template left as is imports nothing); examples are on the instructions sheet.

## Group Schedule cell (approved format)
`SAT 16:00-17:00; MON 16:00-17:00` or `السبت 16:00-17:00؛ الاثنين 16:00-17:00`.
- Slots are separated by `;`, `؛` or a line break (a comma is not a separator). Weekday names: Arabic or English, full or three-letter, any case. Times: 24-hour, `HH:MM` or `H:MM`, Arabic-Indic digits accepted, dash `-`, `–` or `—`.
- Normalized to Module 23's weekday/time representation and shown in both languages in the preview.
- **A group has at most one slot per weekday, even when the two ranges do not overlap** (error `EXCEL_IMPORT_SCHEDULE_DUPLICATE_DAY`). End must be after start. Teacher conflicts use the existing rules (a teacher cannot have overlapping slots in any school): between groups of the file and against the teacher's existing slots. No new scheduling rule was created; Module 23 re-checks every slot at commit.

## Analysis rules (nothing is merged, moved or changed)
| Situation | Result |
|---|---|
| Invalid cell (name, ID, phone, address, option, surah, schedule) | ERROR with the owning module's own code and Arabic/English message |
| Same National ID on two rows | CONFLICT on both rows |
| Same phone with two names (or a parent phone and a teacher phone with different names), or one parent phone with two addresses | CONFLICT |
| One group name with different teacher / settings / schedule on its rows | CONFLICT |
| Phone owned by an inactive account, another organization, or a person with a different name | CONFLICT (Modules 17/18 identity rules, read-only) |
| Existing student: other school, other parent, not ACTIVE, or **already in another group** | CONFLICT (never moved) |
| Existing student already in this group | WARNING, reused, no change |
| Existing student without a group, same parent | reused and assigned to the group |
| Existing active group with the same name | reused only if teacher, learning mode, progression, starting surah and (when the cell is filled) schedule all match; an empty schedule cell leaves it alone; otherwise CONFLICT |
| Teacher schedule overlap | CONFLICT |

ERROR and CONFLICT **block** the confirmation; WARNING never does. Every finding has `code`, `severity`, `rowNumber`, `column`, `params` and `message: { ar, en }`.

## Confirmation
Inside one transaction: lock the preview (`FOR UPDATE`), check it is PENDING, not expired and `canConfirm`; **run the analysis again** on the stored rows (the data may have changed in 24 hours; blocking findings now = `EXCEL_IMPORT_PREVIEW_STALE`, nothing written); then, row by row, reuse or register the teacher (Module 18 `registerTeacher`), the parent (Module 17 `registerParent`, raw address), create the group (Module 20 `createGroup`) with its slots (Module 23 `addSlot`), register the student (Module 19 `registerStudent`) and assign it (Module 20 `assignStudent`). Initial passwords and the first-login password change are exactly those of Modules 17/18. **Any failure rolls everything back** (`EXCEL_IMPORT_COMMIT_FAILED` names the row and the cause in the caller's language).

## Authorization (Module 12 engine only)
SCHOOL_MANAGER only, own school only. See `docs/AUTHORIZATION-MATRIX.md`. The school is **derived on the server** from the caller's own manager links; it is never read from the file. A manager of several schools selects one with `?schoolId=` (error `EXCEL_IMPORT_SCHOOL_SELECTION_REQUIRED` otherwise); the engine still verifies they actively manage it. Previews are readable, confirmable and cancellable only by their creator while still the school's manager; anyone else gets the same neutral answer as for a missing preview.

## Data and privacy
Table `excel_import_previews` (migration `20261110100000-create-excel-import-previews.js`). The parsed rows and analysis (names, phones, National IDs) are JSON text and are **set to NULL** when the preview is confirmed, cancelled or expired; the summary and result stay. Expired PENDING previews are purged (and their stored files deleted) opportunistically on every upload and by `ExcelImportService.purgeExpired()`. The uploaded file of a **confirmed** import is kept in Module 07 storage as the record of what was imported (Module 35 audit does not exist yet); cancelled and expired previews delete theirs. Large imports store about 1 KB per row: keep the database `max_allowed_packet` at 16 MB or more.

## Error codes
HTTP errors: `EXCEL_IMPORT_FILE_REQUIRED`, `..._TEMPLATE_LANGUAGE_INVALID`, `..._SCHOOL_SELECTION_REQUIRED`, `..._SCHOOL_NOT_ACTIVE`, `..._FILE_UNREADABLE`, `..._NO_ROWS`, `..._TOO_MANY_ROWS`, `..._HEADER_NOT_FOUND`, `..._MISSING_COLUMNS`, `..._DUPLICATE_COLUMNS`, `..._PREVIEW_NOT_FOUND`, `..._PREVIEW_EXPIRED`, `..._PREVIEW_NOT_PENDING`, `..._CONFIRMATION_BLOCKED`, `..._PREVIEW_STALE`, `..._COMMIT_FAILED`; plus Module 07's `FILE_*` codes for an invalid file. Finding codes: see `ImportIssueCodes` in `src/modules/36-excel-import/domain/errors/import-errors.ts`; all have Arabic and English messages (`import-error-messages.ts`).

## Architecture
`src/modules/36-excel-import/`: `domain` (columns, cell text, option values, schedule cell, error codes, types), `application` (ports, the analyzer, `ExcelImportService`, authorization, messages), `infrastructure` (ExcelJS reader/writer behind the `WorkbookReader`/`WorkbookWriter` ports, Sequelize and in-memory preview repositories, the importer's read-only `ImportDirectory` built from public contracts), `presentation/http` (router with multer, handlers, OpenAPI), `public`. Wiring: `src/config/excel-import.ts`; mount `/excel-imports`.
