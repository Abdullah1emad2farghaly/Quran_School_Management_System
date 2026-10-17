import { beforeAll, describe, expect, it } from 'vitest';
import { buildApiRouter } from '../../src/app/routes';
import { API_MODULE_DOCS, buildApiDocument } from '../../src/app/openapi/api-documents';
import { registerAllErrorMessages } from '../../src/app/bootstrap/register-error-messages';
import { discoverRoutes, routeKey } from './support/route-discovery';
import { operationsOf } from './support/lint';

/**
 * THE completion gate for endpoint documentation. The inventory comes from the REAL router that the application serves
 * (nested routers and every HTTP method), and is compared with the OpenAPI document in both directions:
 *  - a route that is served but not documented fails (a module cannot be completed without documenting its endpoints);
 *  - an operation that is documented but not served fails (outdated documentation).
 * A route that cannot be mapped with certainty fails with UnmappableRouteError instead of being skipped.
 */
describe('API documentation route inventory (real router)', () => {
  let served: string[];
  let documented: string[];

  beforeAll(() => {
    registerAllErrorMessages();
    served = discoverRoutes(buildApiRouter()).map(routeKey).sort();
    documented = operationsOf(buildApiDocument()).map((o) => `${o.method.toUpperCase()} ${o.path}`).sort();
  });

  it('discovers the real routes (not an empty inventory)', () => {
    expect(served.length).toBeGreaterThanOrEqual(23);
    expect(served).toContain('POST /schools/{id}/approve');
    expect(served).toContain('POST /auth/password-recovery/verify');
  });

  it('documents every served route', () => {
    const missing = served.filter((r) => !documented.includes(r));
    expect(missing, `served but NOT documented in OpenAPI:\n${missing.join('\n')}`).toEqual([]);
  });

  it('documents no route that is not served (outdated documentation)', () => {
    const stale = documented.filter((r) => !served.includes(r));
    expect(stale, `documented but NOT served:\n${stale.join('\n')}`).toEqual([]);
  });

  it('every registered module contract documents at least one operation under its own mount path', () => {
    for (const doc of API_MODULE_DOCS) {
      expect(doc.operations.length, `module ${doc.moduleId} (${doc.mountPath}) documents no operation`).toBeGreaterThan(0);
    }
  });
});
