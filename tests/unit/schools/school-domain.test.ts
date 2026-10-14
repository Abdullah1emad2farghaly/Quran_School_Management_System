import { describe, expect, it } from 'vitest';
import { AppError, FixedClock } from '../../../src/modules/00-shared-kernel/public';
import { School } from '../../../src/modules/16-schools/domain/entities/school';
import { SchoolManagerAssignment } from '../../../src/modules/16-schools/domain/entities/school-manager-assignment';
import {
  GPS_MAX_ACCURACY_METERS,
  SCHOOL_GEOFENCE_RADIUS_METERS,
  canTransitionSchoolStatus,
  distanceMeters,
  formatSchoolCode,
  isSchoolCode,
  isWithinSchoolGeofence,
  normalizeSchoolName,
  parseGpsFix,
  SCHOOL_STATUSES,
  SchoolEventTypes,
} from '../../../src/modules/16-schools/public';

const clock = new FixedClock(new Date('2026-10-12T10:00:00Z'));
const codeOf = (work: () => unknown) => {
  try {
    work();
  } catch (e) {
    return e instanceof AppError ? e.code : 'NOT_APP_ERROR';
  }
  return 'NO_ERROR';
};
const gps = { latitude: 30.0444, longitude: 31.2357, accuracyMeters: 10 };
const base = { name: 'مدرسة النور', code: 'SC-000001', organizationId: 'o1', countryId: 'c1', governorateId: 'g1', gps, createdBy: 'u1', clock };
const main = () => School.createMain(base);
const sub = () => School.requestSub({ ...base, parentSchoolId: 'p1' });
const events = (s: School) => s.pullDomainEvents().map((e) => e.eventType);

describe('school code', () => {
  it('formats SC-000001 and validates the pattern', () => {
    expect(formatSchoolCode(1)).toBe('SC-000001');
    expect(formatSchoolCode(123456)).toBe('SC-123456');
    for (const bad of [0, -1, 1.5, 1_000_000]) expect(() => formatSchoolCode(bad)).toThrow();
    expect(isSchoolCode('SC-000001')).toBe(true);
    for (const bad of ['SC-1', 'sc-000001', 'ORG-000001', 'SC-0000001', 7, null]) expect(isSchoolCode(bad)).toBe(false);
  });
});

describe('school name', () => {
  it('normalizes to NFC, collapses whitespace and trims', () => {
    expect(normalizeSchoolName('  مدرسة   النور \t')).toBe('مدرسة النور');
    expect(normalizeSchoolName('Cafe\u0301')).toBe('Caf\u00e9');
  });
  it('rejects blank, non-text, control characters and over 200 characters (200 is accepted)', () => {
    expect(normalizeSchoolName('م'.repeat(200))).toHaveLength(200);
    for (const bad of ['', '   ', 5, null, undefined, 'a\u0000b', 'م'.repeat(201)]) expect(codeOf(() => normalizeSchoolName(bad))).toBe('INVALID_SCHOOL_NAME');
  });
});

describe('GPS', () => {
  it('accepts valid fixes up to 20 m accuracy and rounds to the stored precision', () => {
    expect(parseGpsFix({ latitude: 30.04440001234, longitude: 31.2357, accuracyMeters: 20 })).toEqual({ latitude: 30.0444, longitude: 31.2357, accuracyMeters: 20 });
    expect(GPS_MAX_ACCURACY_METERS).toBe(20);
  });
  it('rejects accuracy over 20 m with its own code, and invalid or missing numbers', () => {
    expect(codeOf(() => parseGpsFix({ ...gps, accuracyMeters: 20.01 }))).toBe('GPS_ACCURACY_EXCEEDS_LIMIT');
    for (const bad of [
      { ...gps, accuracyMeters: 0 },
      { ...gps, accuracyMeters: -3 },
      { ...gps, latitude: 90.1 },
      { ...gps, longitude: -180.5 },
      { ...gps, latitude: Number.NaN },
      { ...gps, longitude: Infinity },
      { ...gps, latitude: '30.0' },
      { latitude: 1, longitude: 1 },
      null,
      undefined,
      'x',
    ]) {
      expect(codeOf(() => parseGpsFix(bad))).toBe('INVALID_GPS_COORDINATES');
    }
  });
  it('keeps the 50 m geofence: inside at 40 m, outside at 60 m', () => {
    expect(SCHOOL_GEOFENCE_RADIUS_METERS).toBe(50);
    const origin = { latitude: 30, longitude: 31 };
    const metersToDegrees = (m: number) => m / 111_195;
    expect(Math.round(distanceMeters(origin, { latitude: 30 + metersToDegrees(40), longitude: 31 }))).toBe(40);
    expect(isWithinSchoolGeofence(origin, { latitude: 30 + metersToDegrees(40), longitude: 31 })).toBe(true);
    expect(isWithinSchoolGeofence(origin, { latitude: 30 + metersToDegrees(60), longitude: 31 })).toBe(false);
  });
});

describe('status transitions', () => {
  it('allows only PENDING->ACTIVE|REJECTED, ACTIVE<->INACTIVE; REJECTED is terminal', () => {
    const allowed = new Set(['PENDING>ACTIVE', 'PENDING>REJECTED', 'ACTIVE>INACTIVE', 'INACTIVE>ACTIVE']);
    for (const from of SCHOOL_STATUSES) for (const to of SCHOOL_STATUSES) expect(canTransitionSchoolStatus(from, to)).toBe(allowed.has(`${from}>${to}`));
  });
});

describe('School aggregate', () => {
  it('a Main School starts ACTIVE and a Sub-School request starts PENDING, each emitting SchoolCreated (ids only)', () => {
    const m = main();
    const s = sub();
    expect([m.status, m.type, m.parentSchoolId]).toEqual(['ACTIVE', 'MAIN', null]);
    expect([s.status, s.type, s.parentSchoolId]).toEqual(['PENDING', 'SUB', 'p1']);
    const created = m.pullDomainEvents()[0]!;
    expect(created.eventType).toBe('SchoolCreated');
    expect(JSON.parse(JSON.stringify(created.payload))).toEqual({ schoolId: m.id, actorId: 'u1' });
  });

  it('approves a PENDING Sub-School once; a Main School cannot be approved or rejected', () => {
    const s = sub();
    s.approve('admin', clock);
    expect(s.status).toBe('ACTIVE');
    expect(s.snapshot).toMatchObject({ decidedBy: 'admin', rejectionReason: null });
    expect(codeOf(() => s.approve('admin', clock))).toBe('SCHOOL_INVALID_STATUS_TRANSITION');
    expect(codeOf(() => main().approve('admin', clock))).toBe('SCHOOL_INVALID_STATUS_TRANSITION');
    expect(codeOf(() => main().reject('admin', 'x', clock))).toBe('SCHOOL_INVALID_STATUS_TRANSITION');
  });

  it('rejects with a nonblank reason, keeps it, and REJECTED is terminal and no longer holds its name', () => {
    for (const bad of ['', '   ', undefined, null, 5, 'x'.repeat(501)]) expect(codeOf(() => sub().reject('admin', bad, clock))).toBe('INVALID_REJECTION_REASON');
    const s = sub();
    s.reject('admin', '  الموقع غير مناسب  ', clock);
    expect(s.status).toBe('REJECTED');
    expect(s.snapshot.rejectionReason).toBe('الموقع غير مناسب');
    expect(s.holdsName).toBe(false);
    for (const op of [() => s.approve('a', clock), () => s.reject('a', 'x', clock), () => s.reactivate('a', clock), () => s.deactivate('a', clock)]) {
      expect(codeOf(op)).toBe('SCHOOL_INVALID_STATUS_TRANSITION');
    }
  });

  it('supports ACTIVE -> INACTIVE -> ACTIVE only', () => {
    const m = main();
    expect(codeOf(() => m.reactivate('a', clock))).toBe('SCHOOL_INVALID_STATUS_TRANSITION');
    m.deactivate('a', clock);
    expect(m.status).toBe('INACTIVE');
    expect(codeOf(() => m.deactivate('a', clock))).toBe('SCHOOL_INVALID_STATUS_TRANSITION');
    m.reactivate('a', clock);
    expect(m.status).toBe('ACTIVE');
    expect(codeOf(() => sub().deactivate('a', clock))).toBe('SCHOOL_INVALID_STATUS_TRANSITION'); // PENDING cannot be deactivated
  });

  it('GPS can be corrected only while PENDING, returning the previous fix; it is immutable after approval and for any other status', () => {
    const s = sub();
    const fix = { latitude: 30.05, longitude: 31.24, accuracyMeters: 8 };
    expect(s.correctGps(fix, 'admin', clock)).toEqual(gps);
    expect(s.snapshot.gps).toEqual(fix);
    s.approve('admin', clock);
    expect(codeOf(() => s.correctGps(gps, 'admin', clock))).toBe('SCHOOL_GPS_LOCKED');
    expect(s.snapshot.gps).toEqual(fix);
    const m = main();
    expect(codeOf(() => m.correctGps(gps, 'admin', clock))).toBe('SCHOOL_GPS_LOCKED');
    m.deactivate('a', clock);
    expect(codeOf(() => m.correctGps(gps, 'admin', clock))).toBe('SCHOOL_GPS_LOCKED');
    const rejected = sub();
    rejected.reject('admin', 'no', clock);
    expect(codeOf(() => rejected.correctGps(gps, 'admin', clock))).toBe('SCHOOL_GPS_LOCKED');
  });

  it('emits the approved events with identifiers only', () => {
    const s = sub();
    s.pullDomainEvents();
    s.approve('admin', clock);
    const [approved] = s.pullDomainEvents();
    expect(approved!.eventType).toBe(SchoolEventTypes.SCHOOL_APPROVED);
    expect(JSON.parse(JSON.stringify(approved!.payload))).toEqual({ schoolId: s.id, actorId: 'admin' });
    const r = sub();
    r.pullDomainEvents();
    r.reject('admin', 'سبب سري', clock);
    const [rejected] = r.pullDomainEvents();
    expect(rejected!.eventType).toBe('SchoolRejected');
    expect(JSON.stringify(rejected!.payload)).not.toContain('سبب');
    expect(events(main())).toEqual(['SchoolCreated']);
  });

  it('rehydrate rejects records that break the invariants', () => {
    const ok = main().snapshot;
    expect(() => School.rehydrate({ ...ok, code: 'bad' })).toThrow();
    expect(() => School.rehydrate({ ...ok, type: 'SUB', parentSchoolId: null })).toThrow();
    expect(() => School.rehydrate({ ...ok, status: 'PENDING' })).toThrow(); // a Main School is never PENDING
    expect(School.rehydrate(ok).code).toBe('SC-000001');
  });
});

describe('SchoolManagerAssignment', () => {
  it('assigns with history fields and revokes once; events carry identifiers only', () => {
    const a = SchoolManagerAssignment.assign({ schoolId: 's1', userId: 'u1', source: 'SUB_SCHOOL_APPROVAL', assignedBy: 'admin', clock });
    expect(a.isActive).toBe(true);
    expect(a.pullDomainEvents()[0]!.eventType).toBe('SchoolManagerAssigned');
    a.revoke('admin', clock);
    expect(a.isActive).toBe(false);
    expect(a.snapshot).toMatchObject({ revokedBy: 'admin', assignedBy: 'admin', schoolId: 's1', userId: 'u1' });
    expect(a.pullDomainEvents()[0]!.eventType).toBe('SchoolManagerRevoked');
    expect(() => a.revoke('admin', clock)).toThrow();
  });
});
