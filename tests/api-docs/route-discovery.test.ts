import { Router, type RequestHandler } from 'express';
import { describe, expect, it } from 'vitest';
import { discoverRoutes, routeKey, UnmappableRouteError } from './support/route-discovery';

const noop: RequestHandler = (_req, _res, next) => next();
const keys = (router: Router) => discoverRoutes(router).map(routeKey);

describe('route discovery', () => {
  it('finds routes of every supported HTTP method', () => {
    const r = Router();
    r.get('/a', noop);
    r.post('/a', noop);
    r.put('/a', noop);
    r.patch('/a', noop);
    r.delete('/a', noop);
    r.head('/a', noop);
    r.options('/a', noop);
    expect(keys(r)).toEqual(['DELETE /a', 'GET /a', 'HEAD /a', 'OPTIONS /a', 'PATCH /a', 'POST /a', 'PUT /a']);
  });

  it('descends into nested routers and joins their mount paths', () => {
    const inner = Router();
    inner.get('/', noop);
    inner.post('/:id/approve', noop);
    const middle = Router();
    middle.use('/schools', inner);
    const outer = Router();
    outer.use('/auth/password-recovery', Router().post('/request', noop));
    outer.use('/v', middle);
    expect(keys(outer)).toEqual(['POST /auth/password-recovery/request', 'GET /v/schools', 'POST /v/schools/{id}/approve']);
  });

  it('applies a mount path given by the caller and normalizes the root path', () => {
    const r = Router();
    r.get('/', noop);
    expect(discoverRoutes(r, '/api/v1').map(routeKey)).toEqual(['GET /api/v1']);
  });

  it('ignores global middleware and reports a route registered through several handlers once', () => {
    const r = Router();
    r.use(noop);
    r.get('/x', noop, noop);
    r.get('/x', noop);
    expect(keys(r)).toEqual(['GET /x']);
  });

  it('converts Express parameters to OpenAPI parameters', () => {
    const r = Router();
    r.get('/:schoolId/classes/:classId', noop);
    expect(keys(r)).toEqual(['GET /{schoolId}/classes/{classId}']);
  });

  it('fails clearly for a route registered with all()', () => {
    const r = Router();
    r.all('/anything', noop);
    expect(() => discoverRoutes(r)).toThrow(UnmappableRouteError);
    expect(() => discoverRoutes(r)).toThrow(/all\(\)/);
  });

  it('fails clearly for a regular-expression or array route path', () => {
    const regexp = Router();
    regexp.get(/^\/x\/\d+$/, noop);
    expect(() => discoverRoutes(regexp)).toThrow(UnmappableRouteError);
    const array = Router();
    array.get(['/a', '/b'], noop);
    expect(() => discoverRoutes(array)).toThrow(UnmappableRouteError);
  });

  it('fails clearly for a router mounted under a parameterized or non-plain path', () => {
    const parameterized = Router();
    parameterized.use('/schools/:schoolId', Router().get('/x', noop));
    expect(() => discoverRoutes(parameterized)).toThrow(/parameterized/);
    const pattern = Router();
    pattern.use('/s*', Router().get('/x', noop));
    expect(() => discoverRoutes(pattern)).toThrow(UnmappableRouteError);
  });

  it('fails clearly for middleware mounted at a path that is not a router', () => {
    const r = Router();
    r.use('/files', noop);
    expect(() => discoverRoutes(r)).toThrow(/not a Router/);
  });

  it('fails clearly for an HTTP method outside the supported set', () => {
    const r = Router();
    (r as unknown as { trace: (p: string, h: RequestHandler) => void }).trace?.('/t', noop);
    // Express exposes more verbs (copy, lock, ...): any of them must be refused rather than ignored.
    (r as unknown as { copy: (p: string, h: RequestHandler) => void }).copy('/c', noop);
    expect(() => discoverRoutes(r)).toThrow(/unsupported method/);
  });
});
