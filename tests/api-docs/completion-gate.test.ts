import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_MODULE_DOCS } from '../../src/app/openapi/api-documents';

const root = join(__dirname, '..', '..');
const modulesDir = join(root, 'src', 'modules');

/** Every module folder that declares an Express Router in its presentation layer, i.e. exposes HTTP endpoints. */
function modulesWithRouters(): string[] {
  const ids: string[] = [];
  for (const dir of readdirSync(modulesDir)) {
    const http = join(modulesDir, dir, 'presentation', 'http');
    if (!existsSync(http) || !statSync(http).isDirectory()) continue;
    const exposesRoutes = readdirSync(http)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.openapi.ts'))
      .some((f) => /\bRouter\(\)/.test(readFileSync(join(http, f), 'utf8')));
    if (exposesRoutes) ids.push(dir.slice(0, 2));
  }
  return ids;
}

/**
 * THE MODULE COMPLETION GATE for API documentation (docs/API-DOCUMENTATION.md). A module cannot be COMPLETED while it serves
 * endpoints that are not documented and verified:
 *  1. every module that declares a Router has an OpenAPI contract registered in src/app/openapi/api-documents.ts;
 *  2. every registered contract has a response-conformance test that calls `assertAllExercised(<moduleId>)`, which fails unless
 *     EVERY documented operation of the module produced its documented success response against the real handlers;
 * (the route inventory test, the security-drift test, the request-validation test and the error-kind test then verify the contract
 * itself against the real router, the real authentication, the real validators and the real error kinds).
 */
describe('API documentation completion gate', () => {
  const documentedModules = new Set(API_MODULE_DOCS.map((d) => d.moduleId));

  it('every module that serves endpoints registers an OpenAPI contract', () => {
    const undocumented = modulesWithRouters().filter((id) => !documentedModules.has(id));
    expect(undocumented, `modules with a Router but NO OpenAPI contract in api-documents.ts: ${undocumented.join(', ')}`).toEqual([]);
  });

  it('finds the modules that serve endpoints (the scan itself is not empty)', () => {
    expect(modulesWithRouters()).toEqual(expect.arrayContaining(['10', '11', '16']));
  });

  it('every registered contract has a conformance test that exercises all of its operations', () => {
    const dir = join(root, 'tests', 'api-docs', 'conformance');
    const sources = readdirSync(dir).filter((f) => f.endsWith('.test.ts')).map((f) => readFileSync(join(dir, f), 'utf8'));
    const missing = [...documentedModules].filter((id) => !sources.some((s) => s.includes(`assertAllExercised('${id}')`)));
    expect(missing, `contracts without a conformance test calling assertAllExercised: ${missing.join(', ')}`).toEqual([]);
  });

  it('a contract is registered once per mount path (no duplicated contracts)', () => {
    const mounts = API_MODULE_DOCS.map((d) => d.mountPath);
    expect(new Set(mounts).size).toBe(mounts.length);
  });
});
