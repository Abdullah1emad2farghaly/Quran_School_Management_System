import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import { COLLECTOR_NAME, createSubscriptionsHarness } from '../../helpers/subscriptions-harness';

const codeOf = (p: Promise<unknown>) => p.then(() => 'NO_ERROR', (e: unknown) => (e instanceof AppError ? e.code : `NOT_APP_ERROR:${String(e)}`));
const PHONE = '01001234569';
const E164 = '+201001234569';

async function setup() {
  const t = await createSubscriptionsHarness();
  const school = await t.newSchool();
  const manager = await t.newSchoolManager(school.id);
  const register = (over: Record<string, unknown> = {}, schoolId = school.id, actor = manager.id) => t.collectors.registerCollector({ schoolId, name: COLLECTOR_NAME, phone: PHONE, ...over } as never, actor);
  return { t, school, manager, register };
}

describe('registering a NEW Subscription Collector', () => {
  it('creates the account (name on it, initial password = last four phone digits, first-login change pending), the role and the school link', async () => {
    const { t, school, manager, register } = await setup();
    const result = await register();
    expect(result.accountCreated).toBe(true);
    expect(result.collector).toMatchObject({ name: COLLECTOR_NAME, phone: E164, schoolIds: [school.id], organizationId: t.org.id });
    expect(result.link).toMatchObject({ schoolId: school.id, linkedBy: manager.id, isActive: true });

    const user = (await t.h.identity.findByPhone(PHONE))!;
    expect(user.fullName).toBe(COLLECTOR_NAME);
    expect(user.mustChangePassword).toBe(true);
    expect(await t.h.identity.verifyPassword(user.id, '4569')).toBe(true); // last four digits of +201001234569
    expect(await t.h.roles.listActiveRoles(user.id)).toEqual(['SUBSCRIPTION_COLLECTOR']);
  });

  it('never returns or publishes the password, and stores only a hash', async () => {
    const { t, register } = await setup();
    const result = await register();
    expect(JSON.stringify(result)).not.toMatch(/password|hash/i);
    expect(t.h.store.messages.map((m) => m.payload).join('')).not.toMatch(/password|hash|4569/i);
    const user = (await t.h.identity.findByPhone(PHONE))!;
    expect(t.h.users.rows.get(user.id)!.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('publishes CollectorSchoolLinked with identifiers only', async () => {
    const { t, register } = await setup();
    await register();
    const events = t.events('CollectorSchoolLinked');
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).not.toMatch(/محمود|0100|\+20/);
  });

  it('validates the three-part name, the phone and the ACTIVE school, and creates nothing on failure', async () => {
    const { t, register } = await setup();
    expect(await codeOf(register({ name: 'محمود سعيد' }))).toBe('INVALID_COLLECTOR_NAME');
    expect(await codeOf(register({ name: 'محمود سعيد علي حسن' }))).toBe('INVALID_COLLECTOR_NAME');
    expect(await codeOf(register({ phone: 'abc' }))).toBe('INVALID_PHONE_NUMBER');
    expect(await codeOf(register({}, '00000000-0000-4000-8000-000000000000'))).toBe('COLLECTOR_SCHOOL_NOT_ACTIVE');
    expect(await t.h.identity.findByPhone(PHONE)).toBeUndefined();
    expect(t.collectorLinks.rows.size).toBe(0);
  });
});

describe('assigning an EXISTING account (no duplicate account)', () => {
  it('reuses an account whose phone and three-part name match in ANOTHER school, changes nothing about it, and adds no second account', async () => {
    const { t, school, register } = await setup();
    await register();
    const before = (await t.h.identity.findByPhone(PHONE))!;
    const school2 = await t.newSchool('مدرسة ثانية');
    const manager2 = await t.newSchoolManager(school2.id);
    const again = await register({}, school2.id, manager2.id);
    expect(again.accountCreated).toBe(false);
    expect(again.collector.userId).toBe(before.id);
    expect([...again.collector.schoolIds].sort()).toEqual([school.id, school2.id].sort());
    const after = (await t.h.identity.findByPhone(PHONE))!;
    expect(after.mustChangePassword).toBe(before.mustChangePassword);
    expect(t.h.users.rows.get(after.id)!.passwordHash).toBe(t.h.users.rows.get(before.id)!.passwordHash);
  });

  it('assigns an existing eligible account (a clean account with a matching name) WITHOUT changing its password or its first-login flag', async () => {
    const { t, register } = await setup();
    const clean = await t.h.createUser({ role: 'SCHOOL_MANAGER', password: 'clean-pass1', fullName: 'منى حسن علي' });
    const result = await register({ phone: clean.phone, name: 'منى حسن علي' });
    expect(result.accountCreated).toBe(false);
    expect(result.collector.userId).toBe(clean.id);
    expect((await t.h.identity.findById(clean.id))!.mustChangePassword).toBe(false);
    expect(await t.h.identity.verifyPassword(clean.id, 'clean-pass1')).toBe(true);
    expect((await t.h.roles.listActiveRoles(clean.id)).sort()).toEqual(['SCHOOL_MANAGER', 'SUBSCRIPTION_COLLECTOR']);
  });

  it('turns an existing Teacher account of the same organization into a Collector too, without duplicating the account', async () => {
    const { t, school, manager, register } = await setup();
    const teacher = await t.teachers.registerTeacher({ schoolId: school.id, name: COLLECTOR_NAME, phone: PHONE }, manager.id);
    const result = await register();
    expect(result.accountCreated).toBe(false);
    expect(result.collector.userId).toBe(teacher.teacher.userId);
    expect((await t.h.roles.listActiveRoles(teacher.teacher.userId)).sort()).toEqual(['SUBSCRIPTION_COLLECTOR', 'TEACHER']);
  });

  it('an existing phone with a different or missing name is an identity CONFLICT (never merged, nothing added)', async () => {
    const { t, register } = await setup();
    const nameless = await t.h.createUser({ role: 'ORGANIZATION_MANAGER', password: 'org-pass1' });
    expect(await codeOf(register({ phone: nameless.phone }))).toBe('COLLECTOR_IDENTITY_CONFLICT');
    const other = await t.newNamedUser('ORGANIZATION_MANAGER', 'محمود خالد سعيد', 'org-pass2');
    expect(await codeOf(register({ phone: other.phone }))).toBe('COLLECTOR_IDENTITY_CONFLICT');
    expect(t.collectorLinks.rows.size).toBe(0);
    expect(await t.h.roles.listActiveRoles(other.id)).toEqual(['ORGANIZATION_MANAGER']);
  });

  it('never reuses an account across organizations (a Collector, a Parent) and refuses an inactive account', async () => {
    const { t, register } = await setup();
    await register();
    const org2 = await t.otherOrg();
    const school2 = await t.newSchool('مدرسة المؤسسة الثانية', org2.id);
    const manager2 = await t.newSchoolManager(school2.id, org2.id);
    expect(await codeOf(register({}, school2.id, manager2.id))).toBe('COLLECTOR_ORGANIZATION_CONFLICT');

    // a Parent of the first organization cannot become a Collector in the second one
    const school1 = await t.newSchool('مدرسة أ');
    const manager1 = await t.newSchoolManager(school1.id);
    const parent = await t.parents.registerParent({ schoolId: school1.id, name: 'سارة محمد علي', phone: '01007778889', address: { kind: 'raw', text: 'المنيا' } }, manager1.id);
    expect(await codeOf(t.collectors.registerCollector({ schoolId: school2.id, name: 'سارة محمد علي', phone: '01007778889' }, manager2.id))).toBe('COLLECTOR_ORGANIZATION_CONFLICT');
    expect(await t.h.roles.listActiveRoles(parent.parent.userId)).toEqual(['PARENT']);

    // an inactive account is never reused
    const user = (await t.h.identity.findByPhone(PHONE))!;
    await t.h.identity.deactivateUser(user.id);
    const second = await t.newSchool('مدرسة الهدى');
    const m = await t.newSchoolManager(second.id);
    expect(await codeOf(register({}, second.id, m.id))).toBe('COLLECTOR_ACCOUNT_INACTIVE');
  });

  it('refuses a second ACTIVE link to the same school', async () => {
    const { register } = await setup();
    await register();
    expect(await codeOf(register())).toBe('COLLECTOR_ALREADY_LINKED_TO_SCHOOL');
  });
});

describe('Collector-to-School links: history and access', () => {
  it('a Collector can serve several schools of the same organization', async () => {
    const { t, school, manager, register } = await setup();
    const school2 = await t.newSchool('مدرسة ثانية');
    const manager2 = await t.newSchoolManager(school2.id);
    const first = await register();
    await register({}, school2.id, manager2.id);
    expect((await t.collectors.listActiveSchoolIds(first.collector.userId)).sort()).toEqual([school.id, school2.id].sort());
    expect(await t.collectors.isCollectorOfSchool(first.collector.userId, school.id)).toBe(true);
    expect(await t.collectors.isCollectorOfSchool(first.collector.userId, school2.id)).toBe(true);
    expect(manager.id).toBeDefined();
  });

  it('ending a link ends access to THAT school only, keeps the history, the account and the other links', async () => {
    const { t, school, manager, register } = await setup();
    const school2 = await t.newSchool('مدرسة ثانية');
    const manager2 = await t.newSchoolManager(school2.id);
    const { collector } = await register();
    await register({}, school2.id, manager2.id);

    const ended = await t.collectors.removeSchoolLink(collector.userId, school.id, manager.id);
    expect(ended).toMatchObject({ isActive: false, unlinkedBy: manager.id });
    expect(await t.collectors.isCollectorOfSchool(collector.userId, school.id)).toBe(false);
    expect(await t.collectors.isCollectorOfSchool(collector.userId, school2.id)).toBe(true);
    const history = await t.collectors.listSchoolLinkHistory(collector.userId);
    expect(history).toHaveLength(2);
    expect(history.find((l) => l.schoolId === school.id)).toMatchObject({ isActive: false });
    expect(await t.h.roles.hasRole(collector.userId, 'SUBSCRIPTION_COLLECTOR')).toBe(true);
    expect(t.events('CollectorSchoolLinkRemoved')).toHaveLength(1);
    expect(await codeOf(t.collectors.removeSchoolLink(collector.userId, school.id, manager.id))).toBe('COLLECTOR_SCHOOL_LINK_NOT_FOUND');
  });

  it('a re-assignment after unassignment creates a NEW link and keeps the old one in the history', async () => {
    const { t, school, manager, register } = await setup();
    const { collector } = await register();
    await t.collectors.removeSchoolLink(collector.userId, school.id, manager.id);
    const again = await register();
    expect(again.accountCreated).toBe(false);
    expect(await t.collectors.isCollectorOfSchool(collector.userId, school.id)).toBe(true);
    expect(await t.collectors.listSchoolLinkHistory(collector.userId)).toHaveLength(2);
  });

  it('lists only the CURRENT collectors of a school (paginated) and the recipients of notifications', async () => {
    const { t, school, manager, register } = await setup();
    const a = await register();
    const b = await register({ name: 'سامي علي حسن', phone: '01001234570' });
    await t.collectors.removeSchoolLink(a.collector.userId, school.id, manager.id);
    const page = await t.collectors.listCollectorsOfSchool(school.id, { page: 1, pageSize: 10 });
    expect(page.items.map((c) => c.userId)).toEqual([b.collector.userId]);
    expect(await t.collectors.listActiveCollectorUserIds(school.id)).toEqual([b.collector.userId]);
  });

  it('reads the caller\'s own profile, and a stranger has none', async () => {
    const { t, register } = await setup();
    const { collector } = await register();
    expect(await t.collectors.getOwnProfile(collector.userId)).toMatchObject({ phone: E164 });
    expect(await codeOf(t.collectors.getOwnProfile('00000000-0000-4000-8000-000000000000'))).toBe('COLLECTOR_SCHOOL_LINK_NOT_FOUND');
  });
});
