import express, { type RequestHandler } from 'express';
import request from 'supertest';
import type { OpenAPIV3 } from 'openapi-types';
import { beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../../src/modules/00-shared-kernel/public';
import { errorHandler, notFoundHandler } from '../../src/app/middleware/error-handler.middleware';
import { requestContextMiddleware } from '../../src/app/middleware/request-context.middleware';
import { registerAllErrorMessages } from '../../src/app/bootstrap/register-error-messages';
import { buildApiDocument } from '../../src/app/openapi/api-documents';
import { createAuthRouter } from '../../src/modules/10-sessions-jwt/public';
import { createRecoveryRouter } from '../../src/modules/11-otp-password-recovery/public';
import { createOrganizationRouter, createSchoolRouter } from '../../src/modules/16-schools/public';
import { createParentRouter } from '../../src/modules/17-parents/public';
import { dereference } from './support/schema-validation';
import { operationsOf, type OperationRef } from './support/lint';

/**
 * The documented REQUEST contract is checked against the REAL validators: the real routers run with a stub service that records
 * whether a request got past validation. Authentication is stubbed because it is verified separately (security-drift.test.ts).
 *  - every documented request example, path parameter example and query example must pass validation;
 *  - every documented `required` property, `maxLength` and `uuid` format must really be enforced (400 VALIDATION_FAILED).
 * Other constraints (value ranges, business rules) are described in the text and answered by the service, not probed here.
 */
let reached = false;
const stubService = new Proxy({}, {
  get: () => async () => {
    reached = true;
    throw new AppError('SCHOOL_NOT_FOUND', 'NOT_FOUND');
  },
});
const stubAuth: RequestHandler = (req, _res, next) => {
  req.auth = { userId: '3f6b1d52-8a4e-4c1b-9d77-2b6f0c9a1e10', sessionId: 'sess-1', mustChangePassword: false };
  next();
};
const pass: RequestHandler = (_req, _res, next) => next();

function buildApp() {
  const app = express();
  app.use(requestContextMiddleware);
  app.use(express.json({ limit: '1mb' }));
  const getService = (() => stubService) as never;
  app.use('/auth/password-recovery', createRecoveryRouter({ getService } as never));
  app.use('/auth', createAuthRouter({ getService, requireAuthentication: stubAuth } as never));
  app.use('/organizations', createOrganizationRouter({ getService, requireAuthentication: stubAuth, requirePermission: () => pass, publicSubmissionLimit: pass } as never));
  app.use('/schools', createSchoolRouter({ getService, requireAuthentication: stubAuth, requirePermission: () => pass, publicSubmissionLimit: pass } as never));
  app.use('/parents', createParentRouter({ getService, requireAuthentication: stubAuth, requirePermission: () => pass } as never));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

type Json = Record<string, unknown>;
const clone = <T>(v: T): T => structuredClone(v);
const getAt = (obj: Json, path: string[]): unknown => path.reduce<unknown>((o, k) => (o as Json | undefined)?.[k], obj);
function setAt(obj: Json, path: string[], value: unknown): void {
  const parent = getAt(obj, path.slice(0, -1)) as Json;
  if (value === undefined) delete parent[path[path.length - 1] as string];
  else parent[path[path.length - 1] as string] = value;
}

interface Probe {
  readonly label: string;
  readonly path: string[];
  readonly value: unknown;
  /** true: the value is exactly at the documented limit and must still be ACCEPTED; false/absent: it must be rejected. */
  readonly accepted?: boolean;
}

/** The mutations that the documentation promises will be rejected by validation. */
function probesOf(schema: OpenAPIV3.SchemaObject, example: Json, prefix: string[] = []): Probe[] {
  const probes: Probe[] = [];
  const properties = (schema.properties ?? {}) as Record<string, OpenAPIV3.SchemaObject>;
  for (const [name, prop] of Object.entries(properties)) {
    const path = [...prefix, name];
    const present = getAt(example, path) !== undefined;
    if (schema.required?.includes(name)) probes.push({ label: `required ${path.join('.')}`, path, value: undefined });
    if (!present) continue;
    if (prop.type === 'object') probes.push(...probesOf(prop, example, path));
    if (prop.type === 'string' && typeof prop.maxLength === 'number') {
      probes.push({ label: `maxLength ${path.join('.')}`, path, value: 'a'.repeat(prop.maxLength + 1) });
      probes.push({ label: `value of exactly maxLength ${path.join('.')} (${prop.maxLength})`, path, value: 'a'.repeat(prop.maxLength), accepted: true });
    }
    if (prop.type === 'string' && prop.format === 'uuid') probes.push({ label: `uuid ${path.join('.')}`, path, value: 'not-a-uuid' });
  }
  return probes;
}

const send = (app: express.Express, o: OperationRef, path: string, body?: unknown) => {
  const agent = request(app) as unknown as Record<string, (p: string) => request.Test>;
  const t = agent[o.method]!(path);
  return body === undefined ? t : t.send(body as object);
};

describe('documented requests agree with the real validators', () => {
  const app = buildApp();
  let operations: OperationRef[];

  beforeAll(async () => {
    registerAllErrorMessages();
    operations = operationsOf(await dereference(buildApiDocument())).filter((o) => !o.path.startsWith('/health'));
  });

  const pathWith = (o: OperationRef, override?: { name: string; value: string }): string =>
    o.path.replace(/\{([^}]+)\}/g, (_m, name: string) => {
      if (override?.name === name) return override.value;
      const param = ((o.operation.parameters ?? []) as OpenAPIV3.ParameterObject[]).find((p) => p.in === 'path' && p.name === name);
      return String(param?.example);
    });

  it('accepts every documented request example, path example and query example', async () => {
    expect(operations.length).toBeGreaterThanOrEqual(21);
    for (const o of operations) {
      const params = (o.operation.parameters ?? []) as OpenAPIV3.ParameterObject[];
      const query = params.filter((p) => p.in === 'query' && p.example !== undefined).map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(String(p.example))}`).join('&');
      const url = `${pathWith(o)}${query ? `?${query}` : ''}`;
      const examples = Object.entries(((o.operation.requestBody as OpenAPIV3.RequestBodyObject | undefined)?.content?.['application/json']?.examples ?? {}) as Record<string, OpenAPIV3.ExampleObject>);
      const bodies: Array<[string, unknown]> = examples.length > 0 ? examples.map(([name, e]) => [name, e.value]) : [['(no body)', undefined]];
      for (const [name, body] of bodies) {
        reached = false;
        const res = await send(app, o, url, body);
        expect(reached, `${o.method.toUpperCase()} ${o.path} (${name}) was stopped by validation: ${res.status} ${JSON.stringify(res.body)}`).toBe(true);
      }
    }
  });

  it('enforces every documented required property, maxLength (rejected above it, accepted at it) and uuid format', async () => {
    let probed = 0;
    for (const o of operations) {
      const content = (o.operation.requestBody as OpenAPIV3.RequestBodyObject | undefined)?.content?.['application/json'];
      if (!content) continue;
      const schema = content.schema as OpenAPIV3.SchemaObject;
      for (const [name, e] of Object.entries((content.examples ?? {}) as Record<string, OpenAPIV3.ExampleObject>)) {
        for (const probe of probesOf(schema, e.value as Json)) {
          const body = clone(e.value as Json);
          setAt(body, probe.path, probe.value);
          reached = false;
          const res = await send(app, o, pathWith(o), body);
          if (probe.accepted) {
            expect(reached, `${o.method.toUpperCase()} ${o.path} (${name}): ${probe.label} must be accepted but validation answered ${res.status} ${JSON.stringify(res.body?.error?.details ?? '')}`).toBe(true);
          } else {
            expect(res.status, `${o.method.toUpperCase()} ${o.path} (${name}): ${probe.label} is documented but not enforced`).toBe(400);
            expect(res.body.error.code, `${o.method.toUpperCase()} ${o.path}: ${probe.label}`).toBe('VALIDATION_FAILED');
            expect(reached, `${o.method.toUpperCase()} ${o.path}: ${probe.label} reached the service`).toBe(false);
          }
          probed++;
        }
      }
    }
    expect(probed).toBeGreaterThan(60);
  });

  it('rejects a malformed uuid in every documented uuid path parameter', async () => {
    for (const o of operations) {
      for (const p of ((o.operation.parameters ?? []) as OpenAPIV3.ParameterObject[]).filter((x) => x.in === 'path')) {
        if ((p.schema as OpenAPIV3.SchemaObject).format !== 'uuid') continue;
        reached = false;
        const res = await send(app, o, pathWith(o, { name: p.name, value: 'not-a-uuid' }), o.method === 'get' || o.method === 'delete' ? undefined : {});
        expect(res.status, `${o.method.toUpperCase()} ${o.path}: path parameter ${p.name} is documented as uuid but a malformed value was accepted`).toBe(400);
        expect(reached).toBe(false);
      }
    }
  });
});
