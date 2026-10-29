import { describe, expect, it } from 'vitest';
import { AppError, FixedClock } from '../../../src/modules/00-shared-kernel/public';
import {
  DAYS_OF_WEEK,
  GroupScheduleSlot,
  formatMinutes,
  parseDayOfWeek,
  parseMinutes,
  slotsOverlap,
  weekOrderOf,
} from '../../../src/modules/23-group-schedules/public';

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return e instanceof AppError ? e.code : `NOT_APP_ERROR:${String(e)}`;
  }
  return 'NO_ERROR';
};
const clock = new FixedClock(new Date('2026-10-28T08:00:00Z'));
const GROUP = '11111111-1111-4111-8111-111111111111';
const SCHOOL = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

describe('weekdays', () => {
  it('are the seven English names, listed in the Egyptian week order (Saturday first)', () => {
    expect([...DAYS_OF_WEEK]).toEqual(['SATURDAY', 'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']);
    expect(DAYS_OF_WEEK.map(weekOrderOf)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('accept exactly the seven upper-case names', () => {
    for (const d of DAYS_OF_WEEK) expect(parseDayOfWeek(d)).toBe(d);
    for (const bad of ['saturday', 'Sat', 'MON', '', ' MONDAY', 1, 0, null, undefined, {}]) expect(codeOf(() => parseDayOfWeek(bad)), String(bad)).toBe('SCHEDULE_DAY_INVALID');
  });
});

describe('clock times', () => {
  it('parse HH:MM on a 24-hour clock into minutes since midnight and format back', () => {
    expect(parseMinutes('00:00')).toBe(0);
    expect(parseMinutes('18:00')).toBe(1080);
    expect(parseMinutes('18:30')).toBe(1110);
    expect(parseMinutes('23:59')).toBe(1439);
    for (const m of [0, 1, 59, 60, 1080, 1439]) expect(parseMinutes(formatMinutes(m))).toBe(m);
    expect(formatMinutes(1110)).toBe('18:30');
    expect(formatMinutes(5)).toBe('00:05');
  });

  it('reject anything that is not exactly HH:MM (no seconds, no 24:00, no single digits, no text, no zone)', () => {
    for (const bad of ['24:00', '18:60', '1:00', '18:0', '18:00:00', '6pm', '18.00', '18-00', ' 18:00', '18:00 ', '٠٦:٠٠', '', 1800, null, undefined, {}]) {
      expect(codeOf(() => parseMinutes(bad)), String(bad)).toBe('SCHEDULE_TIME_INVALID');
    }
  });
});

describe('overlap (a boundary that merely touches is NOT an overlap)', () => {
  const r = (a: string, b: string) => ({ startMinute: parseMinutes(a), endMinute: parseMinutes(b) });
  it('is true only when the ranges share some time', () => {
    expect(slotsOverlap(r('18:00', '19:00'), r('18:30', '19:30'))).toBe(true); // the specification's example
    expect(slotsOverlap(r('18:30', '19:30'), r('18:00', '19:00'))).toBe(true);
    expect(slotsOverlap(r('18:00', '19:00'), r('18:00', '19:00'))).toBe(true);
    expect(slotsOverlap(r('18:00', '20:00'), r('18:30', '19:00'))).toBe(true); // one inside the other
    expect(slotsOverlap(r('18:00', '19:00'), r('18:59', '20:00'))).toBe(true); // one minute of overlap
  });
  it('is false when they touch or are apart', () => {
    expect(slotsOverlap(r('18:00', '19:00'), r('19:00', '20:00'))).toBe(false); // the specification's example
    expect(slotsOverlap(r('19:00', '20:00'), r('18:00', '19:00'))).toBe(false);
    expect(slotsOverlap(r('08:00', '09:00'), r('17:00', '18:00'))).toBe(false);
  });
});

describe('a schedule slot', () => {
  const make = (over: Partial<Parameters<typeof GroupScheduleSlot.create>[0]> = {}) =>
    GroupScheduleSlot.create({ groupId: GROUP, schoolId: SCHOOL, dayOfWeek: 'MONDAY', startTime: '18:00', endTime: '19:00', createdBy: USER, clock, ...over });

  it('is created ACTIVE with its day and times, and records one created event of identifiers only', () => {
    const slot = make();
    expect(slot.snapshot).toMatchObject({ groupId: GROUP, schoolId: SCHOOL, dayOfWeek: 'MONDAY', startMinute: 1080, endMinute: 1140, createdBy: USER, retiredAt: null, retiredBy: null, retireReason: null, replacedBySlotId: null });
    expect(slot.isActive).toBe(true);
    const events = slot.pullDomainEvents();
    expect(events.map((e) => e.eventType)).toEqual(['GroupScheduleSlotCreated']);
    expect(events[0]!.payload).toMatchObject({ groupId: GROUP, schoolId: SCHOOL, slotId: slot.id, dayOfWeek: 'MONDAY', startTime: '18:00', endTime: '19:00', actorId: USER });
  });

  it('needs the end to be AFTER the start on the same day: no zero-length and no crossing midnight', () => {
    expect(codeOf(() => make({ startTime: '19:00', endTime: '18:00' }))).toBe('SCHEDULE_TIME_RANGE_INVALID');
    expect(codeOf(() => make({ startTime: '18:00', endTime: '18:00' }))).toBe('SCHEDULE_TIME_RANGE_INVALID');
    expect(codeOf(() => make({ startTime: '23:00', endTime: '00:30' }))).toBe('SCHEDULE_TIME_RANGE_INVALID');
    expect(codeOf(() => make({ startTime: '00:00', endTime: '00:01' }))).toBe('NO_ERROR');
    expect(codeOf(() => make({ startTime: '23:58', endTime: '23:59' }))).toBe('NO_ERROR');
  });

  it('is retired, never edited: the times and the day never change, only the retirement is recorded', () => {
    const slot = make();
    slot.pullDomainEvents();
    expect(slot.retire({ reason: 'REMOVED', actorId: USER, clock })).toBe(true);
    expect(slot.isActive).toBe(false);
    expect(slot.snapshot).toMatchObject({ dayOfWeek: 'MONDAY', startMinute: 1080, endMinute: 1140, retireReason: 'REMOVED', retiredBy: USER, replacedBySlotId: null });
    expect(slot.snapshot.retiredAt).toEqual(clock.now());
    expect(slot.pullDomainEvents().map((e) => e.eventType)).toEqual(['GroupScheduleSlotRetired']);
  });

  it('keeps which slot replaced it, and retiring twice is a no-op', () => {
    const slot = make();
    slot.pullDomainEvents();
    expect(slot.retire({ reason: 'REPLACED', actorId: USER, clock, replacedBySlotId: 'new-slot' })).toBe(true);
    expect(slot.snapshot.replacedBySlotId).toBe('new-slot');
    slot.pullDomainEvents();
    expect(slot.retire({ reason: 'REMOVED', actorId: USER, clock })).toBe(false);
    expect(slot.snapshot.retireReason).toBe('REPLACED');
    expect(slot.pullDomainEvents()).toEqual([]);
  });

  it('can be retired by the system when its group is archived', () => {
    const slot = make();
    expect(slot.retire({ reason: 'GROUP_ARCHIVED', actorId: USER, clock })).toBe(true);
    expect(slot.snapshot.retireReason).toBe('GROUP_ARCHIVED');
  });
});
