import { describe, expect, it } from 'vitest';
import { AppError, FixedClock } from '../../../src/modules/00-shared-kernel/public';
import {
  STUDENT_LIFECYCLE,
  Student,
  normalizeNationalId,
  normalizeStudentName,
  studentNameMatchesParent,
} from '../../../src/modules/19-students/public';

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
    return 'NO_ERROR';
  } catch (e) {
    return e instanceof AppError ? e.code : `NOT_APP_ERROR:${String(e)}`;
  }
};
const clock = new FixedClock(new Date('2026-10-20T09:00:00.000Z'));
const base = { schoolId: 's1', organizationId: 'o1', parentId: 'p1', fullName: 'عمر أحمد محمد', nationalId: '30001010123456', joinDate: '2026-10-20', createdBy: 'u1', clock };

describe('Student name (at least three parts; parts 2 and 3 are the Parent\'s first and second names)', () => {
  it('normalizes whitespace and accepts three or more parts', () => {
    expect(normalizeStudentName('  عمر   أحمد\tمحمد ')).toBe('عمر أحمد محمد');
    expect(normalizeStudentName('عمر أحمد محمد علي حسن')).toBe('عمر أحمد محمد علي حسن');
  });
  it('rejects fewer than three parts, blank, non-text, control characters and more than 200 characters', () => {
    for (const bad of ['عمر أحمد', 'عمر', '   ', '', null, undefined, 12, 'عمر أحمد محمد\u0000', `${'ا'.repeat(100)} ${'ب'.repeat(100)} ${'ج'.repeat(10)}`]) {
      expect(codeOf(() => normalizeStudentName(bad)), String(bad)).toBe('INVALID_STUDENT_NAME');
    }
  });
  it('matches the Parent: second part = Parent first name, third part = Parent second name; Latin case ignored, Arabic never folded', () => {
    expect(studentNameMatchesParent('عمر أحمد محمد', 'أحمد محمد علي')).toBe(true);
    expect(studentNameMatchesParent('عمر أحمد محمد علي', 'أحمد محمد علي')).toBe(true); // a fourth part is allowed
    expect(studentNameMatchesParent('Omar Ahmed Mohamed', 'ahmed MOHAMED Ali')).toBe(true);
    expect(studentNameMatchesParent('عمر أحمد خالد', 'أحمد محمد علي')).toBe(false); // wrong third
    expect(studentNameMatchesParent('عمر محمد أحمد', 'أحمد محمد علي')).toBe(false); // order matters
    expect(studentNameMatchesParent('عمر احمد محمد', 'أحمد محمد علي')).toBe(false); // أ vs ا: no letter folding
    expect(studentNameMatchesParent('عمر أحمد', 'أحمد محمد علي')).toBe(false);
  });
});

describe('National ID (exactly 14 digits)', () => {
  it('accepts 14 digits, trims, and converts Arabic-Indic digits', () => {
    expect(normalizeNationalId('30001010123456')).toBe('30001010123456');
    expect(normalizeNationalId(' 30001010123456 ')).toBe('30001010123456');
    expect(normalizeNationalId('٣٠٠٠١٠١٠١٢٣٤٥٦')).toBe('30001010123456');
    expect(normalizeNationalId('۳۰۰۰۱۰۱۰۱۲۳۴۵۶')).toBe('30001010123456');
  });
  it('rejects everything else', () => {
    for (const bad of ['3000101012345', '300010101234567', '3000101012345a', '3000 1010 1234 56', '30001010-123456', '', '  ', null, undefined, 30001010123456]) {
      expect(codeOf(() => normalizeNationalId(bad)), String(bad)).toBe('INVALID_STUDENT_NATIONAL_ID');
    }
  });
});

describe('lifecycle rules', () => {
  it('documents exactly: ACTIVE<->INACTIVE, ACTIVE|INACTIVE->ARCHIVED, ARCHIVED final', () => {
    expect(STUDENT_LIFECYCLE).toEqual({
      DEACTIVATE: { from: ['ACTIVE'], to: 'INACTIVE' },
      REACTIVATE: { from: ['INACTIVE'], to: 'ACTIVE' },
      ARCHIVE: { from: ['ACTIVE', 'INACTIVE'], to: 'ARCHIVED' },
    });
  });
});

describe('Student entity', () => {
  it('registers ACTIVE with one history row and one event whose payload has identifiers only', () => {
    const s = Student.register(base);
    expect(s.snapshot).toMatchObject({ status: 'ACTIVE', version: 1, parentId: 'p1', schoolId: 's1' });
    expect(s.pullHistory().map((h) => h.action)).toEqual(['REGISTERED']);
    const events = s.pullDomainEvents();
    expect(events.map((e) => e.eventType)).toEqual(['StudentRegistered']);
    expect(JSON.stringify(events[0]!.payload)).not.toMatch(/عمر|30001010123456/);
  });

  it('applies the lifecycle and refuses every other move; ARCHIVED is read-only and final', () => {
    const s = Student.register(base);
    s.pullHistory();
    s.pullDomainEvents();
    expect(codeOf(() => s.applyLifecycle('REACTIVATE', 'u1', null, clock))).toBe('STUDENT_INVALID_STATUS_TRANSITION');
    s.applyLifecycle('DEACTIVATE', 'u1', 'سبب', clock);
    expect(s.status).toBe('INACTIVE');
    expect(codeOf(() => s.applyLifecycle('DEACTIVATE', 'u1', null, clock))).toBe('STUDENT_INVALID_STATUS_TRANSITION');
    s.applyLifecycle('REACTIVATE', 'u1', null, clock);
    s.applyLifecycle('ARCHIVE', 'u1', null, clock);
    expect(s.status).toBe('ARCHIVED');
    for (const a of ['DEACTIVATE', 'REACTIVATE', 'ARCHIVE'] as const) expect(codeOf(() => s.applyLifecycle(a, 'u1', null, clock)), a).toBe('STUDENT_INVALID_STATUS_TRANSITION');
    expect(codeOf(() => s.updateDetails({ fullName: 'عمر أحمد محمد علي', actorId: 'u1', clock }))).toBe('STUDENT_ARCHIVED');
    const history = s.pullHistory();
    expect(history.map((h) => [h.previousStatus, h.newStatus])).toEqual([['ACTIVE', 'INACTIVE'], ['INACTIVE', 'ACTIVE'], ['ACTIVE', 'ARCHIVED']]);
    expect(history[0]!.reason).toBe('سبب');
  });

  it('updateDetails reports only what really changed and records the previous values', () => {
    const s = Student.register(base);
    s.pullHistory();
    s.pullDomainEvents();
    expect(s.updateDetails({ fullName: base.fullName, joinDate: base.joinDate, actorId: 'u1', clock })).toEqual([]);
    expect(s.pullHistory()).toEqual([]);
    expect(s.pullDomainEvents()).toEqual([]);
    expect(s.updateDetails({ joinDate: '2026-10-01', actorId: 'u1', clock })).toEqual(['JOIN_DATE']);
    const [h] = s.pullHistory();
    expect(h).toMatchObject({ action: 'DETAILS_UPDATED', previousJoinDate: '2026-10-20', newJoinDate: '2026-10-01', previousFullName: null, newFullName: null });
    expect(s.snapshot).toMatchObject({ parentId: 'p1', schoolId: 's1', nationalId: '30001010123456' });
  });
});
