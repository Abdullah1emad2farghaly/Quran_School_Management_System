# Module 12 — Authorization Engine: delivery notes

Delta over Module 11. Extract at the project root (overwrites the listed files; nothing else changes).

## Setup
1. `npm run db:migrate`  (adds `authorization_bootstrap_lock`)
2. `npm run typecheck && npm test`
3. `npm run test:db`  (needs MariaDB; run `tests/db/authorization-bootstrap.test.ts` on a fresh dev database with NO active Main Admin)
4. First Main Admin, once, in an interactive terminal: `npm run bootstrap:main-admin`
   (hidden prompts; refuses if an active Main Admin exists; see docs/AUTHORIZATION.md)

## Not yet verified on your machine
- `npm run db:migrate` and `npm run test:db` (bootstrap concurrency/rollback against real MariaDB).
- Native `npm test` (the delivery was verified through a compatibility harness; see docs/AUTHORIZATION-MATRIX.md note 1).

## Remaining dependencies / open decisions
See docs/AUTHORIZATION.md ("Remaining dependencies") and docs/AUTHORIZATION-MATRIX.md section 4 (D-1 .. D-5).
