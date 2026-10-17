import { describe, expect, it } from 'vitest';
import { AppError, FixedClock } from '../../../src/modules/00-shared-kernel/public';
import { School } from '../../../src/modules/16-schools/domain/entities/school';
import { SchoolManagerAssignment } from '../../../src/modules/16-schools/domain/entities/school-manager-assignment';
import {
  SCHOOL_MANAGER_SOURCES,
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
const fresh = () => School.create(base);
/** An ACTIVE school: created PENDING, then approved (the only way to become ACTIVE). */
const approved = () => {
  const s = School.create(base);
  s.approve('org-manager', clock);
  return s;
};
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
  it('every new school starts PENDING (never ACTIVE), has no type or parent, and emits SchoolCreated (ids only)', () => {
    const s = fresh();
    expect(s.status).toBe('PENDING');
    expect(s.snapshot).not.toHaveProperty('type');
    expect(s.snapshot).not.toHaveProperty('parentSchoolId');
    expect(s.snapshot).toMatchObject({ centerName: null, villageName: null, applicantUserId: null });
    const created = s.pullDomainEvents()[0]!;
    expect(created.eventType).toBe('SchoolCreated');
    expect(JSON.parse(JSON.stringify(created.payload))).toEqual({ schoolId: s.id, actorId: 'u1' });
  });

  it('keeps free-text center and village and the applicant link', () => {
    const s = School.create({ ...base, centerName: 'سمالوط', villageName: 'قرية غير مسجلة', applicantUserId: 'u9' });
    expect(s.snapshot).toMatchObject({ centerName: 'سمالوط', villageName: 'قرية غير مسجلة', applicantUserId: 'u9' });
  });

  it('is approved once: PENDING -> ACTIVE; it cannot become ACTIVE any other way', () => {
    const s = fresh();
    s.approve('org-manager', clock);
    expect(s.status).toBe('ACTIVE');
    expect(s.snapshot).toMatchObject({ decidedBy: 'org-manager', rejectionReason: null });
    expect(codeOf(() => s.approve('org-manager', clock))).toBe('SCHOOL_INVALID_STATUS_TRANSITION');
    expect(codeOf(() => fresh().reactivate('a', clock))).toBe('SCHOOL_INVALID_STATUS_TRANSITION'); // PENDING cannot be "reactivated"
    expect(codeOf(() => fresh().deactivate('a', clock))).toBe('SCHOOL_INVALID_STATUS_TRANSITION');
  });

  it('rejects with a nonblank reason, keeps it, and REJECTED is terminal and no longer holds its name', () => {
    for (const bad of ['', '   ', undefined, null, 5, 'x'.repeat(501)]) expect(codeOf(() => fresh().reject('admin', bad, clock))).toBe('INVALID_REJECTION_REASON');
    const s = fresh();
    s.reject('admin', '  الموقع غير مناسب  ', clock);
    expect(s.status).toBe('REJECTED');
    expect(s.snapshot.rejectionReason).toBe('الموقع غير مناسب');
    expect(s.holdsName).toBe(false);
    for (const op of [() => s.approve('a', clock), () => s.reject('a', 'x', clock), () => s.reactivate('a', clock), () => s.deactivate('a', clock)]) {
      expect(codeOf(op)).toBe('SCHOOL_INVALID_STATUS_TRANSITION');
    }
  });

  it('supports ACTIVE -> INACTIVE -> ACTIVE only', () => {
    const m = approved();
    expect(codeOf(() => m.reactivate('a', clock))).toBe('SCHOOL_INVALID_STATUS_TRANSITION');
    m.deactivate('a', clock);
    expect(m.status).toBe('INACTIVE');
    expect(codeOf(() => m.deactivate('a', clock))).toBe('SCHOOL_INVALID_STATUS_TRANSITION');
    m.reactivate('a', clock);
    expect(m.status).toBe('ACTIVE');
  });

  it('GPS can be corrected only while PENDING, returning the previous fix; it is immutable after approval and for any other status', () => {
    const s = fresh();
    const fix = { latitude: 30.05, longitude: 31.24, accuracyMeters: 8 };
    expect(s.correctGps(fix, 'admin', clock)).toEqual(gps);
    expect(s.snapshot.gps).toEqual(fix);
    s.approve('admin', clock);
    expect(codeOf(() => s.correctGps(gps, 'admin', clock))).toBe('SCHOOL_GPS_LOCKED');
    expect(s.snapshot.gps).toEqual(fix);
    s.deactivate('a', clock);
    expect(codeOf(() => s.correctGps(gps, 'admin', clock))).toBe('SCHOOL_GPS_LOCKED');
    const rejected = fresh();
    rejected.reject('admin', 'no', clock);
    expect(codeOf(() => rejected.correctGps(gps, 'admin', clock))).toBe('SCHOOL_GPS_LOCKED');
  });

  it('emits the approved events with identifiers only', () => {
    const s = fresh();
    s.pullDomainEvents();
    s.approve('admin', clock);
    const [approved1] = s.pullDomainEvents();
    expect(approved1!.eventType).toBe(SchoolEventTypes.SCHOOL_APPROVED);
    expect(JSON.parse(JSON.stringify(approved1!.payload))).toEqual({ schoolId: s.id, actorId: 'admin' });
    const r = fresh();
    r.pullDomainEvents();
    r.reject('admin', 'سبب سري', clock);
    const [rejected] = r.pullDomainEvents();
    expect(rejected!.eventType).toBe('SchoolRejected');
    expect(JSON.stringify(rejected!.payload)).not.toContain('سبب');
    expect(events(fresh())).toEqual(['SchoolCreated']);
  });

  it('rehydrate rejects records that break the invariants and accepts every valid status', () => {
    const ok = fresh().snapshot;
    expect(() => School.rehydrate({ ...ok, code: 'bad' })).toThrow();
    expect(() => School.rehydrate({ ...ok, status: 'BOGUS' as never })).toThrow();
    for (const status of SCHOOL_STATUSES) expect(School.rehydrate({ ...ok, status }).status).toBe(status);
    expect(School.rehydrate(ok).code).toBe('SC-000001');
  });
});

describe('SchoolManagerAssignment', () => {
  it('assigns with history fields and revokes once; events carry identifiers only', () => {
    const a = SchoolManagerAssignment.assign({ schoolId: 's1', userId: 'u1', source: 'APPROVAL', assignedBy: 'admin', clock });
    expect(a.isActive).toBe(true);
    expect(a.pullDomainEvents()[0]!.eventType).toBe('SchoolManagerAssigned');
    a.revoke('admin', clock);
    expect(a.isActive).toBe(false);
    expect(a.snapshot).toMatchObject({ revokedBy: 'admin', assignedBy: 'admin', schoolId: 's1', userId: 'u1' });
    expect(a.pullDomainEvents()[0]!.eventType).toBe('SchoolManagerRevoked');
    expect(() => a.revoke('admin', clock)).toThrow();
  });
});

describe('removed classification', () => {
  it('the manager sources are neutral and no school type is exported', async () => {
    expect([...SCHOOL_MANAGER_SOURCES]).toEqual(['APPROVAL', 'ASSIGNMENT']);
    const api = await import('../../../src/modules/16-schools/public');
    expect(api).not.toHaveProperty('SCHOOL_TYPES');
  });
});
