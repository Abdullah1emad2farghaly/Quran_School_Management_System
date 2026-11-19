import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { registerAllErrorMessages } from '../../src/app/bootstrap/register-error-messages';
import { errorHandler, notFoundHandler } from '../../src/app/middleware/error-handler.middleware';
import { requestContextMiddleware } from '../../src/app/middleware/request-context.middleware';
import { AuditQueryService, AuditRecorder, InMemoryAuditRepository, createAuditRouter } from '../../src/modules/35-history-audit/public';

const ORG1 = '11111111-1111-4111-8111-111111111111';
const S1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** The audit router over in-memory services. Authentication and the permission guard are test stand-ins (the real engine is covered by its own tests): the "token" is `<userId>:<role>`. */
async function build() {
  registerAllErrorMessages();
  const repository = new InMemoryAuditRepository();
  const scopes = { organizationIdsOf: async (u: string) => (u === 'orgmgr' ? [ORG1] : []), schoolIdsOf: async () => [] as string[], organizationOfSchool: async () => ORG1 };
  const recorder = new AuditRecorder({ repository, scopes, clock: { now: () => new Date('2026-11-16T10:00:00Z') } });
  await recorder.record({ eventId: '5f1d8a40-0000-4000-8000-000000000001', eventType: 'SubscriptionPaid', occurredAt: new Date('2026-11-16T09:30:00Z'), aggregateType: 'Subscription', aggregateId: 'sub-1', payload: { schoolId: S1, status: 'PAID' }, metadata: { requestId: 'r-1', actorUserId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', ipAddress: '203.0.113.7', userAgent: 'UA/1' } });
  await recorder.record({ eventId: '5f1d8a40-0000-4000-8000-000000000002', eventType: 'UserCreated', occurredAt: new Date('2026-11-16T09:31:00Z'), aggregateType: 'User', aggregateId: 'u-1', payload: {} });
  const authenticate: RequestHandler = (req, res, next) => {
    const header = req.header('authorization');
    if (!header) { res.status(401).json({ success: false }); return; }
    const [userId, activeRole] = header.replace('Bearer ', '').split(':');
    (req as unknown as { auth: unknown }).auth = { userId, activeRole: activeRole === 'none' ? null : activeRole };
    next();
  };
  const allowAuditRoles: RequestHandler = (req, res, next) => {
    const role = (req as unknown as { auth: { activeRole: string | null } }).auth.activeRole;
    if (role && ['MAIN_ADMIN', 'ORGANIZATION_MANAGER', 'SCHOOL_MANAGER'].includes(role)) next();
    else res.status(403).json({ success: false, error: { code: 'ACCESS_DENIED' } });
  };
  const app = express();
  app.use(requestContextMiddleware);
  app.use('/api/v1/audit-logs', createAuditRouter({ getService: () => new AuditQueryService({ repository, scopes }), requireAuthentication: authenticate, requirePermission: (() => allowAuditRoles) as never }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return { app, repository };
}
const as = (userId: string, role: string) => ({ Authorization: `Bearer ${userId}:${role}` });

describe('GET /audit-logs', () => {
  it('needs authentication', async () => {
    const { app } = await build();
    await request(app).get('/api/v1/audit-logs').expect(401);
  });
  it('lists the records the caller may see, newest first, with the spec fields and no-store', async () => {
    const { app } = await build();
    const res = await request(app).get('/api/v1/audit-logs').set(as('admin', 'MAIN_ADMIN')).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data.map((r: { entityType: string }) => r.entityType)).toEqual(['User', 'Subscription']);
    const paid = res.body.data[1];
    expect(paid).toMatchObject({ action: 'PAYMENT', module: 'subscriptions', ipAddress: '203.0.113.7', userAgent: 'UA/1', schoolId: S1, organizationId: ORG1, timestamp: '2026-11-16T09:30:00.000Z', before: null });
    expect(paid).not.toHaveProperty('eventId');
  });
  it('an Organization Manager only sees their organization; a Teacher is refused', async () => {
    const { app } = await build();
    const res = await request(app).get('/api/v1/audit-logs').set(as('orgmgr', 'ORGANIZATION_MANAGER')).expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].organizationId).toBe(ORG1);
    await request(app).get('/api/v1/audit-logs').set(as('t1', 'TEACHER')).expect(403);
  });
  it('filters narrow, and a bad filter is a 400', async () => {
    const { app } = await build();
    const ok = await request(app).get('/api/v1/audit-logs?filter[action]=PAYMENT&filter[from]=2026-11-16&filter[to]=2026-11-16').set(as('admin', 'MAIN_ADMIN')).expect(200);
    expect(ok.body.data).toHaveLength(1);
    await request(app).get('/api/v1/audit-logs?filter[action]=NOPE').set(as('admin', 'MAIN_ADMIN')).expect(400);
    await request(app).get('/api/v1/audit-logs?filter[schoolId]=not-a-uuid').set(as('admin', 'MAIN_ADMIN')).expect(400);
  });
});

describe('GET /audit-logs/:id and the write verbs', () => {
  it('reads one record; a record outside the scope and an unknown one answer the same 404; a malformed id is a 400', async () => {
    const { app, repository } = await build();
    const [paid, created] = [...repository.records.values()];
    await request(app).get(`/api/v1/audit-logs/${paid!.id}`).set(as('orgmgr', 'ORGANIZATION_MANAGER')).expect(200);
    const hidden = await request(app).get(`/api/v1/audit-logs/${created!.id}`).set(as('orgmgr', 'ORGANIZATION_MANAGER')).expect(404);
    const unknown = await request(app).get('/api/v1/audit-logs/00000000-0000-4000-8000-000000000000').set(as('orgmgr', 'ORGANIZATION_MANAGER')).expect(404);
    expect(hidden.body.error.code).toBe('AUDIT_RECORD_NOT_FOUND');
    expect(unknown.body.error.code).toBe('AUDIT_RECORD_NOT_FOUND');
    await request(app).get('/api/v1/audit-logs/not-a-uuid').set(as('admin', 'MAIN_ADMIN')).expect(400);
  });
  it('has no way to create, change or delete a record over HTTP', async () => {
    const { app, repository } = await build();
    const id = [...repository.records.keys()][0]!;
    for (const [method, url] of [['post', '/api/v1/audit-logs'], ['put', `/api/v1/audit-logs/${id}`], ['patch', `/api/v1/audit-logs/${id}`], ['delete', `/api/v1/audit-logs/${id}`]] as const) {
      await request(app)[method](url).set(as('admin', 'MAIN_ADMIN')).send({}).expect(404);
    }
    expect(repository.records.size).toBe(2);
  });
});
