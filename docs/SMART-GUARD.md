# Smart Guard (Module 25)

Master Specification §50 (Smart Guard) and §101 (ownership), plus the approved Module 25 decisions of the project owner.

## What it is
Reusable infrastructure that a **protected Teacher action** (attendance, memorization, revision, evaluation: Modules 26–30) calls before it does its work. It is **stateless** (no table, no migration, no event), has **no HTTP endpoint** and **no permission of its own**, and owns no attendance, memorization, revision or evaluation logic (§101).

```ts
const allowance = await smartGuard.check({ teacherId, sessionId, gps }); // throws a SMART_GUARD_* AppError when refused
```
`getSmartGuard()` in `src/config/smart-guard.ts` builds it. `teacherId` is the caller's Teacher record, resolved by the protected module from the verified token (never from the request). `gps` is the reading from the request: `{ latitude, longitude, accuracyMeters }` (the same shape Module 16 uses for the school's GPS). An allowed check returns `{ sessionId, schoolId, groupId, teacherId }`: no coordinates.

## The protected module's part
The protected module does its own authentication, permission (Authorization Engine), scope and ownership checks FIRST, then calls Smart Guard, then runs its own business rules. Smart Guard checks ownership of the session again (defence in depth) because it is the first rule of §50.

## Order of validation (§50) and the codes
The first failure is reported; there is no fallback of any kind (no IP, manual location or postal address).

| # | Check | Rule | Code (HTTP kind) |
|---|---|---|---|
| 1 | Ownership | the caller is the session's Teacher | `SMART_GUARD_NOT_SESSION_TEACHER` (403) |
| 2 | Correct time | scheduled start − 15 min ≤ now ≤ scheduled end (**both inclusive**, by the scheduled times, not the session status) | `SMART_GUARD_OUTSIDE_SESSION_WINDOW` (business rule; `details.opensAt/closesAt`) |
| 3 | GPS reading | nothing sent / a field missing | `SMART_GUARD_GPS_REQUIRED` (400) |
| 3 | GPS reading | not a valid fix (not numbers, latitude ∉ [−90, 90], longitude ∉ [−180, 180], accuracy ≤ 0) | `SMART_GUARD_GPS_INVALID` (400) |
| 4 | Distance | ≤ 50 m from the school's official GPS (Module 16 `isWithinSchoolGeofence`) | `SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE` (business rule; `{maxMeters}`) |
| 5 | GPS accuracy | ≤ 20 m (Module 16 `GPS_MAX_ACCURACY_METERS`) | `SMART_GUARD_GPS_ACCURACY_TOO_LOW` (business rule; `{maxMeters}`) |
| 6 | Business rules | the session is not cancelled; the school is ACTIVE | `SMART_GUARD_SESSION_CANCELLED`, `SMART_GUARD_SCHOOL_NOT_ACTIVE` (business rule) |

An unknown session is Module 24's `CLASS_SESSION_NOT_FOUND` (404), not a Smart Guard rejection. Messages are Arabic and English.

## Approved decisions
1. **Session cancellation is NOT protected** by Smart Guard (no GPS): a Teacher may cancel without being at school. Module 24 keeps its own authorization and rules.
2. **The end of the window is inclusive** and is judged by the scheduled time, not the status, to tolerate small background-job delays.
3. **No GPS freshness rule in V1.** This does **not** prevent GPS spoofing: Smart Guard checks what the phone reports against the specified accuracy and geofence limits; it cannot prove the phone reports the truth.
4. **Rejected attempts are not stored.** Only the rejection code and the session id are logged (never a coordinate, accuracy or distance); no logger is required.
5. **Module 23 stays a documented dependency** (§81) **without a code import**: Module 24 already provides all the session-time information. The actual code dependencies are Module 16 (the school's official GPS and status, the GPS constants and distance function) and Module 24 (`getSession`). Module 12 (§81) is also not imported: permission and scope are checked by the protected module before it calls Smart Guard. A boundary test states the exact set: Modules 00, 03, 05, 16, 24.
6. **Architecture:** a reusable service, no HTTP endpoints; it reuses Module 16's GPS utilities and constants (no second haversine).

## Technical choices (not business rules)
- `SMART_GUARD_SCHOOL_NOT_ACTIVE` was added to the proposed code list for the "school is ACTIVE" business rule.
- Missing GPS and invalid GPS are separate codes; "unavailable" and "denied" look like "missing" to the backend.
- The distance is not returned to the client, only the limit.

## Tests
`tests/unit/smart-guard/`: service (18: window edges to the millisecond, GPS shapes, distance, accuracy 20 / 20.01, business rules, the order of the checks, logging never contains a location), boundaries and messages (8), integration over the real Modules 16/20/23/24 (4). `tests/api-docs/error-kinds.test.ts` checks the error kinds. **Status: COMPLETED (approved by the project owner).** **Verification (USER-REPORTED local test results, not executed by me):** the project owner reports that all Module 25 tests pass on their machine. **What I executed myself:** the 18 service and 8 boundary tests only, in a restricted sandbox with a minimal vitest-compatible runner and stubbed libraries (18 + 8 = 26 passed, 0 failed); a partial `tsc` showed no error other than missing-library ones. The integration test and the rest were **not** run: please run `npm run typecheck`, `npm run test:unit`, `npm run api:verify`, `npm test` and `npm run build`.

## What the next modules must do
Attendance (26), Memorization (27), Revision (28), Evaluations (29) and the Module 30 teacher actions call `getSmartGuard().check(...)` from their protected routes after their own checks, and map a `SMART_GUARD_*` error to the standard error response (already localized). They decide which of their actions are protected.
