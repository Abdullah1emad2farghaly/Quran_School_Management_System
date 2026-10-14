# Modules 13 / 15 / 16 — Organization address, country and school country inheritance: delivery notes
1. npm run db:migrate   (two new migrations: 20261014100000-organizations-multi-organization, 20261014110000-schools-country-invariant)
   - the second one STOPS without changing data if an existing school's country differs from its organization's country, or the organization has no country (run npm run bootstrap:organization first, then migrate again)
   - the first one links every current MAIN_ADMIN holder to the existing organization(s) (V1 had one), so today's access does not change
2. npm run typecheck && npm test
3. npm run test:db
New: POST /api/v1/organizations (public registration), GET /organizations, GET /organizations/:id; POST /api/v1/schools (Main School, authenticated administrator of the organization; replaces the public main-submissions); the other school endpoints are now organization-scoped.
Changed contracts: Parent Address validation takes organizationId (Module 15); OrganizationLookup has requireById, requireOrganizationCountryId, isOrganizationAdmin, listAdministeredOrganizationIds.
Permission matrix, D-1/D-2 permission entries remain deferred; organization scope is enforced by the application. Open decisions: docs/SCHOOLS.md.
Not yet verified on your machine: migrations, typecheck, npm test (unit + API), test:db.
