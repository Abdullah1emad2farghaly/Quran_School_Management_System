import { describe, expect, it } from 'vitest';
import type { RequestHandler } from 'express';
import {
  FixedWindowCounter,
  createOrganizationHandlers,
  createOrganizationRouter,
  createSchoolHandlers,
  createSchoolRouter,
  generateApplicantPassword,
} from '../../../src/modules/16-schools/public';
import type { OrganizationHandlerService, SchoolHandlerService } from '../../../src/modules/16-schools/public';

const date = new Date('2026-10-13T10:00:00.000Z');
const school = {
  id: 's1', code: 'SC-000001', name: 'n', type: 'SUB', status: 'PENDING', organizationId: 'o', countryId: 'c', parentSchoolId: 'p', governorateId: 'g', centerId: null, villageId: null,
  latitude: 30, longitude: 31, gpsAccuracyMeters: 5, createdBy: 'u', applicantName: 'a', decidedBy: null, decidedAt: null, rejectionReason: null, createdAt: date, updatedAt: date,
};
const manager = { id: 'm1', schoolId: 's1', userId: 'u', source: 'SUB_SCHOOL_APPROVAL', assignedAt: date, assignedBy: 'admin', revokedAt: null, revokedBy: null, isActive: true };

function fakeService() {
  const calls: { method: string; args: unknown[] }[] = [];
  const record = (method: string, result: unknown) => async (...args: unknown[]) => {
    calls.push({ method, args });
    return result;
  };
  const service = {
    createMainSchool: record('createMainSchool', school),
    submitSubSchool: record('submitSubSchool', { school, applicant: { userId: 'u', accountCreated: true, password: 'LEAK' } }),
    listSchools: record('listSchools', { items: [school], page: 1, pageSize: 20, total: 1, totalPages: 1 }),
    getSchoolForActor: record('getSchoolForActor', school),
    approveSubSchool: record('approveSubSchool', { school, manager }),
    rejectSubSchool: record('rejectSubSchool', school),
    deactivateSchool: record('deactivateSchool', school),
    reactivateSchool: record('reactivateSchool', school),
    correctPendingGps: record('correctPendingGps', school),
    assignSchoolManager: record('assignSchoolManager', manager),
    revokeSchoolManager: record('revokeSchoolManager', manager),
  };
  return { service: service as unknown as SchoolHandlerService, calls };
}

describe('password generator for new applicant accounts', () => {
  it('produces 12-character alphanumeric passwords from a CSPRNG (no repeats in 500 samples)', () => {
    const samples = Array.from({ length: 500 }, () => generateApplicantPassword());
    for (const p of samples) expect(p).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(new Set(samples).size).toBe(500);
  });
});

describe('FixedWindowCounter (public submission abuse limit)', () => {
  it('allows the limit, then refuses with the seconds left, per key, and starts a new window', () => {
    let now = 0;
    const counter = new FixedWindowCounter({ maxRequests: 2, windowMs: 60_000, now: () => now });
    expect(counter.hit('a').allowed).toBe(true);
    expect(counter.hit('a').allowed).toBe(true);
    now = 10_000;
    expect(counter.hit('a')).toEqual({ allowed: false, retryAfterSeconds: 50 });
    expect(counter.hit('b').allowed).toBe(true); // another client is unaffected
    now = 60_000;
    expect(counter.hit('a').allowed).toBe(true); // a new window
  });

  it('rejects invalid options', () => {
    expect(() => new FixedWindowCounter({ maxRequests: 0, windowMs: 1000 })).toThrow();
    expect(() => new FixedWindowCounter({ maxRequests: 1, windowMs: 0 })).toThrow();
  });
});

describe('school handlers', () => {
  const body = {
    applicant: { name: 'أحمد', phone: '01012345678' },
    parentSchoolId: 'p',
    school: { name: 'فرع', governorateId: 'g', centerId: 'c', gps: { latitude: 30, longitude: 31, accuracyMeters: 5 } },
  };

  it('maps the submission form to the service and never reads identity, role or status from the body', async () => {
    const { service, calls } = fakeService();
    const h = createSchoolHandlers(() => service);
    await h.submitSubSchool({ ...body, authenticatedUserId: 'EVIL', actorId: 'EVIL', createdBy: 'EVIL', status: 'ACTIVE', roles: ['MAIN_ADMIN'] });
    expect(calls[0]).toEqual({
      method: 'submitSubSchool',
      args: [{ applicant: body.applicant, parentSchoolId: 'p', name: 'فرع', countryId: undefined, governorateId: 'g', centerId: 'c', villageId: null, gps: body.school.gps }],
    });
    await h.submitSubSchool(body, 'session-user');
    expect(calls[1]!.args[0]).toMatchObject({ authenticatedUserId: 'session-user', name: 'فرع' });
    // a Main School is created by an authenticated administrator: the actor comes from the session argument, the organization from the body
    await h.createMainSchool('admin', { organizationId: 'org-1', actorId: 'EVIL', school: { ...body.school, countryId: 'c1' } });
    expect(calls[2]!.args[0]).toMatchObject({ actorId: 'admin', organizationId: 'org-1', countryId: 'c1', name: 'فرع' });
  });

  it('answers a submission with the school and the applicant id only (no password or account detail)', async () => {
    const { service } = fakeService();
    const result = await createSchoolHandlers(() => service).submitSubSchool(body);
    expect(result.applicant).toEqual({ userId: 'u', accountCreated: true });
    expect(JSON.stringify(result)).not.toContain('LEAK');
    expect(result.school).toMatchObject({ id: 's1', code: 'SC-000001', gps: { latitude: 30, longitude: 31, accuracyMeters: 5 }, createdAt: '2026-10-13T10:00:00.000Z', decidedAt: null });
  });

  it('takes the actor from the verified session argument for every administrative action', async () => {
    const { service, calls } = fakeService();
    const h = createSchoolHandlers(() => service);
    await h.approve('admin', 's1');
    await h.reject('admin', 's1', { reason: 'سبب', actorId: 'EVIL' });
    await h.deactivate('admin', 's1');
    await h.reactivate('admin', 's1');
    await h.correctGps('admin', 's1', { gps: body.school.gps });
    await h.assignManager('admin', 's1', { userId: 'u2' });
    await h.revokeManager('admin', 's1');
    expect(calls.map((c) => c.method)).toEqual(['approveSubSchool', 'rejectSubSchool', 'deactivateSchool', 'reactivateSchool', 'correctPendingGps', 'assignSchoolManager', 'revokeSchoolManager']);
    expect(calls[0]!.args).toEqual(['s1', 'admin']);
    expect(calls[1]!.args).toEqual(['s1', 'admin', 'سبب']);
    expect(calls[5]!.args).toEqual([{ schoolId: 's1', userId: 'u2', actorId: 'admin' }]);
    expect(calls[6]!.args).toEqual([{ schoolId: 's1', actorId: 'admin' }]);
    const approved = await h.approve('admin', 's1');
    expect(approved.manager).toMatchObject({ isActive: true, assignedAt: '2026-10-13T10:00:00.000Z' });
  });

  it('lists with the caller as the actor and serializes the page', async () => {
    const { service, calls } = fakeService();
    const page = await createSchoolHandlers(() => service).listSchools('u', { statuses: ['PENDING'], type: 'SUB', sort: { key: 'code', direction: 'asc' }, page: { page: 2, pageSize: 5 } });
    expect(calls[0]!.args[0]).toEqual({ actorId: 'u', statuses: ['PENDING'], type: 'SUB', sort: 'code', direction: 'asc', page: { page: 2, pageSize: 5 } });
    expect(page).toMatchObject({ total: 1, items: [{ id: 's1', createdAt: '2026-10-13T10:00:00.000Z' }] });
  });
});

/** Works with real Express (`router.stack[].route`) and with the offline harness stub. */
function routesOf(router: unknown) {
  type Layer = { route?: { path: string; methods: Record<string, boolean>; stack?: { handle: unknown }[]; handlers?: unknown[] } };
  return (router as { stack: Layer[] }).stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      key: `${Object.keys(layer.route!.methods).find((m) => layer.route!.methods[m])!.toUpperCase()} ${layer.route!.path}`,
      handlers: layer.route!.stack ? layer.route!.stack.map((l) => l.handle) : (layer.route!.handlers as unknown[]),
    }));
}

describe('school route registration (the endpoint inventory and its protection)', () => {
  const auth: RequestHandler = () => undefined;
  const limit: RequestHandler = () => undefined;
  const routes = routesOf(createSchoolRouter({ getService: () => fakeService().service, requireAuthentication: auth, publicSubmissionLimit: limit }));
  const byKey = Object.fromEntries(routes.map((r) => [r.key, r.handlers]));

  it('registers exactly the documented endpoints', () => {
    expect(routes.map((r) => r.key).sort()).toEqual(
      [
        'DELETE /:id/manager',
        'GET /',
        'GET /:id',
        'PATCH /:id/gps',
        'POST /',
        'POST /:id/approve',
        'POST /:id/deactivate',
        'POST /:id/reactivate',
        'POST /:id/reject',
        'POST /sub-submissions',
        'PUT /:id/manager',
      ].sort(),
    );
  });

  it('puts authentication first on every non-public route (creating a Main School is NOT public)', () => {
    for (const [key, handlers] of Object.entries(byKey)) {
      if (key === 'POST /sub-submissions') continue;
      expect([key, handlers[0] === auth]).toEqual([key, true]);
    }
  });

  it('puts the abuse limit first on the public Sub-School submission, which allows (but does not require) a login', () => {
    expect(byKey['POST /sub-submissions']![0]).toBe(limit);
    expect(byKey['POST /sub-submissions']![1]).not.toBe(auth); // a wrapper that authenticates only when an Authorization header is present
    expect(typeof byKey['POST /sub-submissions']![1]).toBe('function');
  });

  it('exposes no other state-changing route', () => {
    expect(routes.filter((r) => /^(POST|PUT|PATCH|DELETE)/.test(r.key)).length).toBe(9);
  });
});

describe('organization handlers and route registration', () => {
  const org = { id: 'o1', code: 'ORG-000002', name: 'n', status: 'ACTIVE', countryId: 'c', governorateId: 'g', centerId: null, villageId: null, createdAt: date, updatedAt: date };
  const fake = () => {
    const calls: { method: string; args: unknown[] }[] = [];
    const rec = (method: string, result: unknown) => async (...args: unknown[]) => (calls.push({ method, args }), result);
    const service = {
      registerOrganization: rec('registerOrganization', { organization: org, applicant: { userId: 'u', accountCreated: true, password: 'LEAK' } }),
      listOrganizationsForActor: rec('listOrganizationsForActor', { items: [org], page: 1, pageSize: 20, total: 1, totalPages: 1 }),
      getOrganizationForActor: rec('getOrganizationForActor', org),
    };
    return { service: service as unknown as OrganizationHandlerService, calls };
  };

  it('maps the registration form and takes the logged-in identity only from the session argument', async () => {
    const { service, calls } = fake();
    const h = createOrganizationHandlers(() => service);
    const result = await h.register({
      applicant: { name: 'أحمد', phone: '01012345678' },
      organization: { name: 'دار', countryId: 'c', governorateId: 'g', centerId: 'ct' },
      authenticatedUserId: 'EVIL',
      roles: ['MAIN_ADMIN'],
    });
    expect(calls[0]!.args[0]).toEqual({
      applicant: { name: 'أحمد', phone: '01012345678' },
      organization: { name: 'دار', countryId: 'c', governorateId: 'g', centerId: 'ct', villageId: null },
    });
    expect(result.applicant).toEqual({ userId: 'u', accountCreated: true });
    expect(JSON.stringify(result)).not.toContain('LEAK');
    expect(result.organization).toMatchObject({ id: 'o1', countryId: 'c', address: { governorateId: 'g', centerId: null, villageId: null }, createdAt: '2026-10-13T10:00:00.000Z' });
    await h.register({ applicant: {}, organization: {} }, 'session-user');
    expect(calls[1]!.args[0]).toMatchObject({ authenticatedUserId: 'session-user' });
  });

  it('reads with the session user as the actor', async () => {
    const { service, calls } = fake();
    const h = createOrganizationHandlers(() => service);
    expect((await h.list('u', { page: 1, pageSize: 20 })).items[0]).toMatchObject({ id: 'o1' });
    await h.get('u', 'o1');
    expect(calls.map((c) => c.method)).toEqual(['listOrganizationsForActor', 'getOrganizationForActor']);
    expect(calls[1]!.args).toEqual(['o1', 'u']);
  });

  it('registers exactly the documented organization endpoints, public only for the registration', () => {
    const auth: RequestHandler = () => undefined;
    const limit: RequestHandler = () => undefined;
    const routes = routesOf(createOrganizationRouter({ getService: () => fake().service, requireAuthentication: auth, publicSubmissionLimit: limit }));
    expect(routes.map((r) => r.key).sort()).toEqual(['GET /', 'GET /:id', 'POST /']);
    const byKey = Object.fromEntries(routes.map((r) => [r.key, r.handlers]));
    expect(byKey['POST /']![0]).toBe(limit);
    expect(byKey['POST /']![1]).not.toBe(auth);
    expect(byKey['GET /']![0]).toBe(auth);
    expect(byKey['GET /:id']![0]).toBe(auth);
  });
});
