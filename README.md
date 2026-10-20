# Quran School Management System

Multi-school / multi-branch Quran school management backend. Authoritative spec: `docs/MASTER-SPECIFICATION.md`.

## Stack
Node.js 20+, Express, TypeScript (strict), Sequelize + MySQL, express-validator, jsonwebtoken, bcryptjs, Vitest. BullMQ + Redis arrive with the outbox module.

## Setup
```bash
npm install
cp .env.example .env   # fill in values
npm run dev            # http://localhost:3000/api/v1/health
```

## Scripts
`npm run dev` · `build` · `start` · `typecheck` · `test` · `test:unit` · `test:integration` · `db:migrate` · `db:seed`

## Database
Create a MySQL database matching `DATABASE_NAME`, then `npm run db:migrate`. Schema changes go through migrations in `database/migrations` only.

## API
Base path `/api/v1`. Localization: `ar` (default), `en`. See `docs/ARCHITECTURE.md`.

API documentation (Swagger UI): `http://localhost:3000/api-docs` (raw OpenAPI: `/api-docs.json`; enabled outside production, in production only with `API_DOCS_ENABLED=true`). Every endpoint must be documented and verified (`npm run api:verify`); see `docs/API-DOCUMENTATION.md`.

## Status
See `docs/IMPLEMENTATION-STATUS.md`. Currently: Foundation phase complete (Modules 00–07); Modules 08 (Identity Core), 09 (Roles & Permissions), 10 (Sessions & JWT) 11 (OTP & Password Recovery) and 12 (Authorization Engine) implemented; 13 (Main Organization) implemented; 14 (Geography) implemented; 15 (Unified Address: Parent Address validation) implemented; 16 (Schools and organization registration) completed and closed with its REST API (deferred items in docs/SCHOOLS.md); organizations are many, each with a country and its own address, and every school shares its organization's country; 17 (Parents), 18 (Teachers) and 19 (Students) implemented (docs/PARENTS.md, docs/TEACHERS.md, docs/STUDENTS.md); next is Module 20. After `npm run db:migrate`, `npm run seed:geography` loads Egypt and its 27 governorates (not a complete dataset). Fresh install: `npm run db:migrate`, `npm run seed:geography`, then `npm run bootstrap:main-admin` (creates the Main Organization, then the first Main Admin) and `npm run bootstrap:organization` to assign the Main Organization's country (Egypt, asks for confirmation; `-- --yes` for an approved scripted run). Existing installation: `npm run db:migrate`, `npm run seed:geography`, `npm run bootstrap:organization`. Authorization decisions: `docs/AUTHORIZATION-MATRIX.md`; first Main Admin: `npm run bootstrap:main-admin` (see `docs/AUTHORIZATION.md`).
