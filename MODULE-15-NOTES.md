# Module 15 — Unified Address (Parent Address): delivery notes
1. npm run db:migrate        (adds organizations.country_id with a foreign key to countries.id; no data change)
2. npm run typecheck && npm test
3. npm run test:db           (new: tests/db/organization-country.test.ts; updated: organizations.test.ts, geography.test.ts; always rolled back, safe on any database)
4. npm run seed:geography    (only if not done yet: Egypt = CNT-000001)
5. npm run bootstrap:organization             (assigns Egypt to the Main Organization after a confirmation; re-runnable)
   npm run bootstrap:organization -- --yes     (skips ONLY the confirmation; every safety check still runs)
Until step 5 is done, every Parent Address validation fails with ORGANIZATION_COUNTRY_NOT_SET (by design).
Details: docs/UNIFIED-ADDRESS.md, docs/ORGANIZATION.md. Not yet verified on your machine: migration, test:db, typecheck and the full test suite.
