# Module Map

41 modules, implemented in the order below (Master Specification §80–82). Competition is not included in V1.

| Phase | Modules |
|---|---|
| 1 Foundation | 00 Shared Kernel · 01 Configuration & Environment · 02 Database & Transaction Infrastructure · 03 Error & Localization · 04 Validation & API Standards · 05 Logging & Request Context · 06 Domain Events & Transactional Outbox · 07 File Infrastructure |
| 2 Security | 08 Identity Core · 09 Roles & Permissions · 10 Sessions & JWT · 11 OTP & Password Recovery · 12 Authorization Engine |
| 3 Organization | 13 Organization Core · 14 Geography · 15 Unified Address · 16 Schools |
| 4 People | 17 Parents · 18 Teachers · 19 Students |
| 5 Educational Structure | 20 Groups · 21 Quran Structure · 22 Quran Position & Range Engine · 23 Group Schedules · 24 Sessions |
| 6 Protected Educational Operations | 25 Smart Guard · 26 Attendance · 27 Memorization · 28 Revision · 29 Evaluations · 30 Exams |
| 7 Notifications / History | 31 Notifications Core · 32 Notification Rules · 35 History & Audit |
| 8 Financial | 33 Subscriptions · 34 Payments & Collection |
| 9 Import / Reporting / File Access | 36 Excel Import · 37 Reports Core · 38 Report Modules · 39 File / Excel Access Control |
| 10 Final Integration | 40 Integration & E2E |

Each module lives in `src/modules/NN-name/` with `domain/`, `application/`, `infrastructure/`, `presentation/`, `public/`. Modules may depend on each other only through `public/` contracts, DTOs, and events.
