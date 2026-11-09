import { describe, expect, it } from 'vitest';
import { currentBillingMonth, isBillingMonth } from '../../../src/modules/33-subscriptions/public';
import { daysInMonth, firstUnpaidReminderDueAt, monthEndReminderDueAt, monthEndWindowStartDate } from '../../../src/modules/32-notification-rules/public';

const cairo = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const cairoLocal = (d: Date): string => {
  const p = Object.fromEntries(cairo.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};

describe('the subscription month (Africa/Cairo)', () => {
  it('is the Cairo calendar month of the instant, across the UTC boundary and both Egyptian offsets', () => {
    expect(currentBillingMonth(new Date('2026-10-31T21:30:00Z'))).toBe('2026-10'); // 23:30 Oct 31 Cairo (winter, UTC+2)
    expect(currentBillingMonth(new Date('2026-10-31T22:30:00Z'))).toBe('2026-11'); // 00:30 Nov 1 Cairo
    expect(currentBillingMonth(new Date('2026-06-30T20:59:00Z'))).toBe('2026-06'); // 23:59 Jun 30 Cairo (summer, UTC+3)
    expect(currentBillingMonth(new Date('2026-06-30T21:00:00Z'))).toBe('2026-07'); // 00:00 Jul 1 Cairo
    expect(currentBillingMonth(new Date('2026-12-31T22:00:00Z'))).toBe('2027-01'); // year change
  });

  it('accepts only YYYY-MM', () => {
    for (const ok of ['2026-01', '2026-12', '1999-09']) expect(isBillingMonth(ok)).toBe(true);
    for (const bad of ['2026-13', '2026-00', '2026-1', '26-11', '2026/11', '2026-11-01', '', null, 202611]) expect(isBillingMonth(bad)).toBe(false);
  });
});

describe('end-of-month reminder window: the start of the FINAL FIVE calendar days (actual month length)', () => {
  it('30-day month -> 26th, 31-day month -> 27th, February by its real length (leap years included)', () => {
    expect(daysInMonth('2026-11')).toBe(30);
    expect(monthEndWindowStartDate('2026-11')).toBe('2026-11-26');
    expect(monthEndWindowStartDate('2026-12')).toBe('2026-12-27');
    expect(monthEndWindowStartDate('2026-10')).toBe('2026-10-27');
    expect(monthEndWindowStartDate('2026-02')).toBe('2026-02-24'); // 28 days
    expect(monthEndWindowStartDate('2028-02')).toBe('2028-02-25'); // 29 days (leap)
    expect(monthEndWindowStartDate('2026-04')).toBe('2026-04-26');
  });

  it('the window is exactly five calendar days long for every month of two years', () => {
    for (const year of [2026, 2028]) {
      for (let m = 1; m <= 12; m += 1) {
        const month = `${year}-${String(m).padStart(2, '0')}`;
        const start = Number(monthEndWindowStartDate(month).slice(8));
        expect(daysInMonth(month) - start + 1, month).toBe(5);
      }
    }
  });

  it('is due at 00:00 Africa/Cairo of that day (winter and summer offsets)', () => {
    expect(cairoLocal(monthEndReminderDueAt('2026-11'))).toBe('2026-11-26 00:00');
    expect(cairoLocal(monthEndReminderDueAt('2026-12'))).toBe('2026-12-27 00:00');
    expect(cairoLocal(monthEndReminderDueAt('2026-06'))).toBe('2026-06-26 00:00');
    expect(cairoLocal(monthEndReminderDueAt('2026-02'))).toBe('2026-02-24 00:00');
    expect(monthEndReminderDueAt('2026-11').toISOString()).toBe('2026-11-25T22:00:00.000Z');
  });
});

describe('first unpaid reminder: 3 CALENDAR days after the creation date (not 72 elapsed hours)', () => {
  it('is 00:00 Cairo of creation date + 3 days, whatever the time of day the subscription was created', () => {
    expect(cairoLocal(firstUnpaidReminderDueAt('2026-11-10'))).toBe('2026-11-13 00:00');
    expect(cairoLocal(firstUnpaidReminderDueAt('2026-11-29'))).toBe('2026-12-02 00:00'); // across a month end
    expect(cairoLocal(firstUnpaidReminderDueAt('2026-12-30'))).toBe('2027-01-02 00:00'); // across a year end
    expect(cairoLocal(firstUnpaidReminderDueAt('2026-02-26'))).toBe('2026-03-01 00:00'); // across February
  });

  it('stays a calendar-day rule across the Egyptian daylight-saving change (the elapsed hours differ, the local date does not)', () => {
    for (const created of ['2026-04-22', '2026-04-23', '2026-04-24', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']) {
      const due = firstUnpaidReminderDueAt(created);
      const expected = new Date(Date.UTC(Number(created.slice(0, 4)), Number(created.slice(5, 7)) - 1, Number(created.slice(8)) + 3)).toISOString().slice(0, 10);
      expect(cairoLocal(due), created).toBe(`${expected} 00:00`);
    }
  });
});
