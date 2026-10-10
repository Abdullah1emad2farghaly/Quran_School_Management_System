# Module 13 — Main Organization: delivery notes

Delta over Module 12 (new and changed files only). Extract at the project root; it overwrites the listed files.
New: src/modules/13-organization-core/, src/config/organization.ts, src/app/cli/bootstrap-organization*.ts, the organizations migration, tests, docs/ORGANIZATION.md, .env.example.
Changed: register-error-messages.ts, the Main Admin CLI files (bootstrap-main-admin*.ts, terminal-prompter.ts), package.json (script bootstrap:organization), and the docs (README, IMPLEMENTATION-STATUS, PROJECT-CHANGELOG, DATABASE, ARCHITECTURE, AUTHORIZATION).
Delete (empty placeholders, optional): src/modules/13-organization-core/{domain,application,infrastructure,presentation,public}/.gitkeep

1. npm run db:migrate   (adds organizations; the second migration fix-organizations-code-check corrects the code CHECK)
2. npm run typecheck && npm test
3. npm run test:db      (new: tests/db/organizations.test.ts; always rolled back, safe on any database)
4. Fresh install: npm run bootstrap:main-admin (creates the Main Organization, then the first Main Admin).
   Install that already has a Main Admin: npm run bootstrap:organization
