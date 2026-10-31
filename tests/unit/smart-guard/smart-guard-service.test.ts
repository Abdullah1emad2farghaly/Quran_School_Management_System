import { describe, expect, it } from 'vitest';
import { SmartGuard } from '../../../src/modules/25-smart-guard/public';
import { END, INSIDE, OUTSIDE, SCHOOL_GPS, createGuardFakes, fakeSession } from '../../helpers/smart-guard-fakes';

const at = (iso: string) => new Date(iso);
const check = (t: ReturnType<typeof createGuardFakes>, over: Partial<{ teacherId: string; sessionId: string; gps: unknown }> = {}) =>
  t.guard.check({ teacherId: 'teacher-1', sessionId: 'session-1', gps: INSIDE, ...over });
const refused = async (promise: Promise<unknown>, code: string) => expect(promise).rejects.toMatchObject({ code });

describe('Smart Guard: the allowed case', () => {
  it('allows the session\'s Teacher, inside the window, inside 50 m, with accuracy <= 20 m, and returns only identifiers', async () => {
    const t = createGuardFakes();
    expect(await check(t)).toEqual({ sessionId: 'session-1', schoolId: 'school-1', groupId: 'group-1', teacherId: 'teacher-1' });
    expect(t.logger.entries).toHaveLength(0); // nothing is logged for an allowed action
  });
});

describe('ownership', () => {
  it('only the Teacher assigned to the session', async () => {
    await refused(check(createGuardFakes(), { teacherId: 'teacher-2' }), 'SMART_GUARD_NOT_SESSION_TEACHER');
  });
  it('an unknown session is Module 24\'s NOT_FOUND and is not a Smart Guard rejection', async () => {
    const t = createGuardFakes();
    await refused(check(t, { sessionId: 'nope' }), 'CLASS_SESSION_NOT_FOUND');
    expect(t.logger.entries).toHaveLength(0);
  });
});

describe('correct time: session start - 15 minutes through session end, both ends inclusive, by the scheduled times', () => {
  it('opens exactly 15 minutes before the start', async () => {
    const t = createGuardFakes();
    t.clock.set(at('2026-11-02T15:44:59.999Z'));
    await refused(check(t), 'SMART_GUARD_OUTSIDE_SESSION_WINDOW');
    t.clock.set(at('2026-11-02T15:45:00.000Z'));
    expect((await check(t)).sessionId).toBe('session-1');
  });
  it('the end is INCLUSIVE and one millisecond later is refused', async () => {
    const t = createGuardFakes();
    t.clock.set(END);
    expect((await check(t)).sessionId).toBe('session-1');
    t.clock.set(at('2026-11-02T17:00:00.001Z'));
    await refused(check(t), 'SMART_GUARD_OUTSIDE_SESSION_WINDOW');
  });
  it('is judged by the scheduled time, not the status: a session the job already moved to COMPLETED at the end is still inside; one still OPEN after its start too', async () => {
    const done = createGuardFakes({ session: fakeSession({ status: 'COMPLETED' }) });
    done.clock.set(END);
    expect((await check(done)).sessionId).toBe('session-1');
    const open = createGuardFakes({ session: fakeSession({ status: 'OPEN' }) });
    open.clock.set(at('2026-11-02T16:10:00Z')); // the job has not started it yet
    expect((await check(open)).sessionId).toBe('session-1');
  });
  it('the refusal tells the client when the window opens and closes', async () => {
    const t = createGuardFakes();
    t.clock.set(at('2026-11-03T10:00:00Z'));
    await expect(check(t)).rejects.toMatchObject({ details: { opensAt: '2026-11-02T15:45:00.000Z', closesAt: '2026-11-02T17:00:00.000Z' } });
  });
});

describe('GPS: missing and invalid readings are refused (no fallback of any kind)', () => {
  it('unavailable, denied or missing: nothing sent, or a field missing', async () => {
    for (const gps of [undefined, null, {}, { latitude: 30 }, { latitude: 30, longitude: 31 }, { latitude: null, longitude: 31, accuracyMeters: 5 }]) {
      await refused(check(createGuardFakes(), { gps }), 'SMART_GUARD_GPS_REQUIRED');
    }
  });
  it('invalid: not a fix', async () => {
    const bad: unknown[] = [
      'text', 5, [], true,
      { latitude: '30', longitude: 31, accuracyMeters: 5 },
      { latitude: NaN, longitude: 31, accuracyMeters: 5 },
      { latitude: Infinity, longitude: 31, accuracyMeters: 5 },
      { latitude: 91, longitude: 31, accuracyMeters: 5 },
      { latitude: -91, longitude: 31, accuracyMeters: 5 },
      { latitude: 30, longitude: 181, accuracyMeters: 5 },
      { latitude: 30, longitude: -181, accuracyMeters: 5 },
      { latitude: 30, longitude: 31, accuracyMeters: 0 },
      { latitude: 30, longitude: 31, accuracyMeters: -3 },
    ];
    for (const gps of bad) await refused(check(createGuardFakes(), { gps }), 'SMART_GUARD_GPS_INVALID');
  });
  it('a manual location, IP address or postal address is not a GPS reading', async () => {
    for (const gps of [{ ip: '10.0.0.1' }, { address: 'Cairo' }, { manual: true, latitude: 30.0444, longitude: 31.2357 }, { postalCode: '11511', accuracyMeters: 5 }]) {
      const err = await check(createGuardFakes(), { gps }).catch((e) => e);
      expect(['SMART_GUARD_GPS_REQUIRED', 'SMART_GUARD_GPS_INVALID']).toContain(err.code);
    }
  });
});

describe('distance: <= 50 m from the school\'s official GPS', () => {
  it('about 44.5 m is inside, about 51.2 m is outside (with the limit in details and params)', async () => {
    expect((await check(createGuardFakes(), { gps: INSIDE })).sessionId).toBe('session-1');
    const err = await check(createGuardFakes(), { gps: OUTSIDE }).catch((e) => e);
    expect(err).toMatchObject({ code: 'SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE', kind: 'BUSINESS_RULE', details: { maxMeters: 50 }, params: { maxMeters: 50 } });
    expect(JSON.stringify(err.details)).not.toContain('30.04'); // no coordinate goes back to the client
  });
  it('the school\'s own centre is inside', async () => {
    expect((await check(createGuardFakes(), { gps: { ...SCHOOL_GPS, accuracyMeters: 5 } })).sessionId).toBe('session-1');
  });
});

describe('GPS accuracy: <= 20 m', () => {
  it('20 m is accepted, 20.01 m is refused (with the limit in params)', async () => {
    expect((await check(createGuardFakes(), { gps: { ...INSIDE, accuracyMeters: 20 } })).sessionId).toBe('session-1');
    const err = await check(createGuardFakes(), { gps: { ...INSIDE, accuracyMeters: 20.01 } }).catch((e) => e);
    expect(err).toMatchObject({ code: 'SMART_GUARD_GPS_ACCURACY_TOO_LOW', params: { maxMeters: 20 } });
  });
});

describe('business rules', () => {
  it('a cancelled session is refused', async () => {
    await refused(check(createGuardFakes({ session: fakeSession({ status: 'CANCELLED' }) })), 'SMART_GUARD_SESSION_CANCELLED');
  });
  it('a school that is not ACTIVE (or does not exist) is refused', async () => {
    for (const status of ['PENDING', 'REJECTED', 'INACTIVE']) await refused(check(createGuardFakes({ school: { status } })), 'SMART_GUARD_SCHOOL_NOT_ACTIVE');
    await refused(check(createGuardFakes({ school: null })), 'SMART_GUARD_SCHOOL_NOT_ACTIVE');
  });
});

describe('the order of §50: ownership -> time -> GPS reading -> distance -> accuracy -> business rules', () => {
  it('reports the FIRST failure', async () => {
    const wrongTeacherLateNoGps = createGuardFakes();
    wrongTeacherLateNoGps.clock.set(at('2026-11-03T00:00:00Z'));
    await refused(check(wrongTeacherLateNoGps, { teacherId: 'teacher-2', gps: undefined }), 'SMART_GUARD_NOT_SESSION_TEACHER');
    const lateNoGps = createGuardFakes();
    lateNoGps.clock.set(at('2026-11-03T00:00:00Z'));
    await refused(check(lateNoGps, { gps: undefined }), 'SMART_GUARD_OUTSIDE_SESSION_WINDOW');
    await refused(check(createGuardFakes(), { gps: undefined }), 'SMART_GUARD_GPS_REQUIRED');
    await refused(check(createGuardFakes(), { gps: { ...OUTSIDE, accuracyMeters: 50 } }), 'SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE'); // far AND inaccurate: distance first
    await refused(check(createGuardFakes({ session: fakeSession({ status: 'CANCELLED' }) }), { gps: OUTSIDE }), 'SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE'); // business rules last
    await refused(check(createGuardFakes({ session: fakeSession({ status: 'CANCELLED' }), school: { status: 'PENDING' } })), 'SMART_GUARD_SESSION_CANCELLED');
  });
});

describe('logging and statelessness', () => {
  it('a rejection logs only its code and the session id: never a coordinate, an accuracy or a distance', async () => {
    const t = createGuardFakes();
    await check(t, { gps: OUTSIDE }).catch(() => undefined);
    await check(t, { gps: { ...INSIDE, accuracyMeters: 99 } }).catch(() => undefined);
    await check(t, { gps: undefined }).catch(() => undefined);
    expect(t.logger.entries.map((e) => e.fields)).toEqual([
      { code: 'SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE', sessionId: 'session-1' },
      { code: 'SMART_GUARD_GPS_ACCURACY_TOO_LOW', sessionId: 'session-1' },
      { code: 'SMART_GUARD_GPS_REQUIRED', sessionId: 'session-1' },
    ]);
    const text = JSON.stringify(t.logger.entries);
    for (const secret of ['30.04', '31.23', '99', 'latitude', 'longitude', 'accuracy']) expect(text).not.toContain(secret);
  });
  it('works without a logger', async () => {
    const t = createGuardFakes();
    const guard = new SmartGuard({ sessions: { getSession: async () => fakeSession() as never }, schools: { findById: async () => ({ ...SCHOOL_GPS, status: 'ACTIVE' }) as never }, clock: t.clock });
    expect((await guard.check({ teacherId: 'teacher-1', sessionId: 'session-1', gps: INSIDE })).teacherId).toBe('teacher-1');
  });
});
