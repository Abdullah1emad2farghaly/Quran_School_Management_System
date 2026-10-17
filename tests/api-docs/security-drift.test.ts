import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app/bootstrap/create-app';
import { API_BASE_PATH } from '../../src/app/routes';
import { buildApiDocument } from '../../src/app/openapi/api-documents';
import { registerAllErrorMessages } from '../../src/app/bootstrap/register-error-messages';
import { operationsOf, type OperationRef } from './support/lint';

const UUID = '9a4e7c21-6d03-4b58-8e1f-0c2d5b7a3f64';
const concretePath = (path: string): string => `${API_BASE_PATH}${path.replace(/\{[^}]+\}/g, UUID)}`;

/**
 * The authentication claims of the documentation are checked against the REAL application (real middleware, no token):
 *  - an operation documented as requiring a Bearer token must answer 401 AUTHENTICATION_REQUIRED without one;
 *  - an operation documented as public/optional must NOT answer 401 AUTHENTICATION_REQUIRED without one;
 *  - the OpenAPI `security` declaration must agree with the `x-authorization` block.
 * Requests without a token never reach a service, so no database is needed.
 */
describe('documented authentication matches the real application', () => {
  let operations: OperationRef[];
  const app = createApp({ apiDocsEnabled: false });

  beforeAll(() => {
    registerAllErrorMessages();
    operations = operationsOf(buildApiDocument());
  });

  it('declares security consistently with the authorization block', () => {
    for (const o of operations) {
      const mode = o.operation['x-authorization']?.authentication;
      const security = o.operation.security ?? [];
      const label = `${o.method.toUpperCase()} ${o.path}`;
      if (mode === 'required') expect(security, label).toEqual([{ bearerAuth: [] }]);
      else if (mode === 'optional') expect(security, label).toEqual([{}, { bearerAuth: [] }]);
      else expect(security, label).toEqual([]);
    }
  });

  it('answers 401 AUTHENTICATION_REQUIRED without a token for every protected operation', async () => {
    const protectedOps = operations.filter((o) => o.operation['x-authorization']?.authentication === 'required');
    expect(protectedOps.length).toBeGreaterThan(0);
    for (const o of protectedOps) {
      const res = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[o.method]!(concretePath(o.path)).send({});
      expect(res.status, `${o.method.toUpperCase()} ${o.path} must require authentication`).toBe(401);
      expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    }
  });

  it('never demands a token from a public or optional-login operation', async () => {
    const openOps = operations.filter((o) => o.operation['x-authorization']?.authentication !== 'required' && o.path !== '/health/ready');
    expect(openOps.length).toBeGreaterThan(0);
    for (const o of openOps) {
      const res = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[o.method]!(concretePath(o.path)).send({});
      expect(res.body?.error?.code, `${o.method.toUpperCase()} ${o.path} is documented as not requiring a token`).not.toBe('AUTHENTICATION_REQUIRED');
      expect(res.status, `${o.method.toUpperCase()} ${o.path}`).not.toBe(401);
    }
  });
});
