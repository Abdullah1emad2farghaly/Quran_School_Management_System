# Module 14 — Geography: delivery notes
1. npm run db:migrate        (adds countries, governorates, centers, villages)
2. npm run typecheck && npm test
3. npm run test:db           (new: tests/db/geography.test.ts; always rolled back, safe on any database)
4. npm run seed:geography    (idempotent: Egypt + 27 governorates only; NOT a complete dataset)
Details: docs/GEOGRAPHY.md. Not yet verified on your machine: migration and test:db.
