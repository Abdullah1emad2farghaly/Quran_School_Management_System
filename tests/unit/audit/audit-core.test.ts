import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '../../../src/modules/00-shared-kernel/public';
import {
  AUDITED_EVENTS,
  AUDIT_ACTIONS,
  AuditQueryService,
  AuditRecorder,
  InMemoryAuditRepository,
  buildAuditRecord,
  createRecordAuditOnDomainEventHandler,
} from '../../../src/modules/35-history-audit/public';

const ORG1 = '11111111-1111-4111-8111-111111111111';
const ORG2 = '22222222-2222-4222-8222-222222222222';
const S1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const S2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const U = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function ev(eventType: string, payload: unknown, extra: { aggregateType?: string; aggregateId?: string; metadata?: DomainEvent['metadata'] } = {}): DomainEvent {
  return { eventId: randomUUID(), eventType, occurredAt: new Date('2026-11-16T09:30:00Z'), aggregateType: extra.aggregateType ?? 'Subscription', aggregateId: extra.aggregateId ?? 'agg-1', payload, ...(extra.metadata ? { metadata: extra.metadata } : {}) };
}

function eventNamesInModules(): Set<string> {
  const names = new Set<string>();
  const walk = (dir: string): void => {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/domain\/events\/.*\.ts$/.test(p.split(path.sep).join('/'))) for (const m of readFileSync(p, 'utf8').matchAll(/'([A-Z][A-Za-z]+)'/g)) names.add(m[1]!);
    }
  };
  walk(path.resolve(__dirname, '../../../src/modules'));
  return names;
}

describe('audit catalog', () => {
  it('lists only events that exist, with valid actions', () => {
    const known = eventNamesInModules();
    expect(Object.keys(AUDITED_EVENTS).filter((k) => !known.has(k))).toEqual([]);
    for (const e of Object.values(AUDITED_EVENTS)) expect(AUDIT_ACTIONS).toContain(e.action);
  });
  it('excludes evaluation score updates (approved amendment) and session telemetry', () => {
    expect(AUDITED_EVENTS.EvaluationScoresUpdated).toBeUndefined();
    expect(AUDITED_EVENTS.AuthSessionStarted).toBeUndefined();
    expect(AUDITED_EVENTS.AuthSessionRevoked).toBeUndefined();
  });
});

describe('buildAuditRecord', () => {
  const metadata = { requestId: 'req-1', actorUserId: U, ipAddress: '203.0.113.7', userAgent: 'UA/1' };
  it('splits before/after, takes actor, address and agent from the metadata, and never copies sensitive keys', () => {
    const r = buildAuditRecord(
      ev('AttendanceCorrected', { recordId: 'r1', schoolId: S1, status: 'ABSENT', previousStatus: 'PRESENT', reason: 'late', actorUserId: U, phoneNumber: '0100', nested: { token: 'x', keep: 1 } }, { aggregateType: 'AttendanceRecord', aggregateId: 'r1', metadata }),
      new Date('2026-11-16T10:00:00Z'),
    )!;
    expect(r).toMatchObject({ action: 'CORRECTION', module: 'attendance', actorUserId: U, ipAddress: '203.0.113.7', userAgent: 'UA/1', requestId: 'req-1', schoolId: S1, entityType: 'AttendanceRecord', entityId: 'r1' });
    expect(r.before).toEqual({ status: 'PRESENT' });
    expect(r.after).toMatchObject({ status: 'ABSENT', reason: 'late', nested: { keep: 1 } });
    expect(r.after).not.toHaveProperty('actorUserId');
    expect(JSON.stringify(r)).not.toMatch(/0100|token/);
  });
  it('returns null for an event outside the catalog', () => {
    expect(buildAuditRecord(ev('AuthSessionStarted', {}), new Date())).toBeNull();
  });
  it('a system event has no actor or address, and a School aggregate is its own scope', () => {
    const r = buildAuditRecord(ev('SchoolApproved', {}, { aggregateType: 'School', aggregateId: S2 }), new Date())!;
    expect(r).toMatchObject({ actorUserId: null, ipAddress: null, userAgent: null, schoolId: S2 });
  });
  it('replaces an oversized snapshot by a marker but still records', () => {
    expect(buildAuditRecord(ev('ExamUpdated', { schoolId: S1, blob: 'x'.repeat(20000) }), new Date())!.after).toEqual({ truncated: true });
  });
});

describe('recorder, handler and scoped reads', () => {
  function setup() {
    const repository = new InMemoryAuditRepository();
    const lookups: string[] = [];
    const recorder = new AuditRecorder({
      repository,
      scopes: { organizationOfSchool: async (s) => { lookups.push(s); return s === S1 ? ORG1 : s === S2 ? ORG2 : null; } },
      clock: { now: () => new Date('2026-11-16T10:00:00Z') },
    });
    const directory = { organizationIdsOf: async (u: string) => (u === 'orgmgr' ? [ORG1] : []), schoolIdsOf: async (u: string) => (u === 'schoolmgr' ? [S2] : []) };
    return { repository, recorder, lookups, query: new AuditQueryService({ repository, scopes: directory }) };
  }
  const listQuery = { page: { page: 1, pageSize: 50 }, sort: [{ key: 'timestamp', direction: 'desc' as const }], filters: {} };

  it('is idempotent on the event id and completes the organization from the school', async () => {
    const h = setup();
    const e = ev('SubscriptionPaid', { schoolId: S1, subscriptionId: 's' });
    expect(await h.recorder.record(e)).toBe(true);
    expect(await h.recorder.record(e)).toBe(false);
    expect(h.repository.records.size).toBe(1);
    expect([...h.repository.records.values()][0]!.organizationId).toBe(ORG1);
  });
  it('ignores events outside the catalog and needs no lookup when the organization is known', async () => {
    const h = setup();
    expect(await h.recorder.record(ev('SomethingElse', {}))).toBe(false);
    await h.recorder.record(ev('OrganizationCreated', { organizationId: ORG2 }, { aggregateType: 'Organization', aggregateId: ORG2 }));
    expect(h.lookups).toEqual([]);
  });
  it('the handler subscribes to the catalog only', async () => {
    const h = setup();
    const handler = createRecordAuditOnDomainEventHandler(h.recorder);
    expect(handler.eventTypes).toContain('SubscriptionPaid');
    expect(handler.eventTypes).not.toContain('EvaluationScoresUpdated');
    await handler.handle(ev('SubscriptionWaived', { schoolId: S1 }));
    expect(h.repository.records.size).toBe(1);
  });

  async function seeded() {
    const h = setup();
    await h.recorder.record(ev('SubscriptionPaid', { schoolId: S1 }));
    await h.recorder.record(ev('SubscriptionWaived', { schoolId: S2 }));
    await h.recorder.record(ev('UserCreated', { userId: U }, { aggregateType: 'User', aggregateId: U }));
    return h;
  }
  it('Main Admin reads all; an Organization Manager only their organization; a School Manager only their school', async () => {
    const h = await seeded();
    expect((await h.query.list({ userId: 'admin', activeRole: 'MAIN_ADMIN' }, listQuery, {})).items).toHaveLength(3);
    const org = (await h.query.list({ userId: 'orgmgr', activeRole: 'ORGANIZATION_MANAGER' }, listQuery, {})).items;
    expect(org).toHaveLength(1);
    expect(org[0]!.organizationId).toBe(ORG1);
    const sch = (await h.query.list({ userId: 'schoolmgr', activeRole: 'SCHOOL_MANAGER' }, listQuery, {})).items;
    expect(sch).toHaveLength(1);
    expect(sch[0]!.schoolId).toBe(S2);
  });
  it('every other role, a stranger and no active role see nothing', async () => {
    const h = await seeded();
    for (const role of ['TEACHER', 'STUDENT', 'PARENT', 'SUBSCRIPTION_COLLECTOR', 'GOVERNORATE_MANAGER', null]) expect((await h.query.list({ userId: 'x', activeRole: role }, listQuery, {})).items).toHaveLength(0);
    expect((await h.query.list({ userId: 'stranger', activeRole: 'ORGANIZATION_MANAGER' }, listQuery, {})).items).toHaveLength(0);
  });
  it('a filter narrows but never widens the scope', async () => {
    const h = await seeded();
    expect((await h.query.list({ userId: 'orgmgr', activeRole: 'ORGANIZATION_MANAGER' }, listQuery, { organizationId: ORG2 })).items).toHaveLength(0);
  });
  it('get: unscoped, foreign and unknown records answer the same 404; Main Admin reads an unscoped one', async () => {
    const h = await seeded();
    const all = [...h.repository.records.values()];
    const unscoped = all.find((r) => r.organizationId === null && r.schoolId === null)!;
    const foreign = all.find((r) => r.organizationId === ORG2)!;
    const org = { userId: 'orgmgr', activeRole: 'ORGANIZATION_MANAGER' };
    for (const id of [unscoped.id, foreign.id, randomUUID()]) await expect(h.query.get(org, id)).rejects.toMatchObject({ code: 'AUDIT_RECORD_NOT_FOUND' });
    expect((await h.query.get({ userId: 'admin', activeRole: 'MAIN_ADMIN' }, unscoped.id)).id).toBe(unscoped.id);
  });
});
