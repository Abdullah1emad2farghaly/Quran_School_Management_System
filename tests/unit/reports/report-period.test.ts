import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import { ReportPeriodService, addDays, firstDayOfPreviousMonth, resolveReportPeriod, startOfBusinessDay, studentReportWindow } from '../../../src/modules/37-reports-core/public';

const NOW = new Date('2026-11-17T09:00:00Z'); // Cairo: 2026-11-17 11:00 (UTC+2)
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const codeOf = (fn: () => unknown) => {
  try {
    fn();
    return 'NO_ERROR';
  } catch (e) {
    return e instanceof AppError ? e.code : `NOT_APP_ERROR:${String(e)}`;
  }
};

describe('start of a Cairo business day (Egypt observes daylight saving time)', () => {
  it('is UTC+2 in winter and UTC+3 in summer', () => {
    expect(iso(startOfBusinessDay('2026-01-01'))).toBe('2025-12-31T22:00:00.000Z');
    expect(iso(startOfBusinessDay('2026-07-01'))).toBe('2026-06-30T21:00:00.000Z');
    expect(iso(startOfBusinessDay('2026-12-01'))).toBe('2026-11-30T22:00:00.000Z');
  });
  it('handles the day the clocks skip midnight (2026-04-24 starts at 01:00 local) and the 25-hour day they fall back (2026-10-29)', () => {
    expect(iso(startOfBusinessDay('2026-04-24'))).toBe('2026-04-23T22:00:00.000Z'); // 00:00 does not exist: the first instant of the date is 01:00 Cairo
    expect(iso(startOfBusinessDay('2026-04-25'))).toBe('2026-04-24T21:00:00.000Z');
    expect(iso(startOfBusinessDay('2026-10-29'))).toBe('2026-10-28T21:00:00.000Z');
    expect(iso(startOfBusinessDay('2026-10-30'))).toBe('2026-10-29T22:00:00.000Z');
  });
  it('calendar arithmetic crosses month and year ends and leap years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(firstDayOfPreviousMonth('2027-01-10')).toBe('2026-12-01');
  });
});

describe('THIS_MONTH: the first day of the current month (Cairo) -> now', () => {
  it('starts at the first Cairo midnight and ends at now', () => {
    const p = resolveReportPeriod({ kind: 'THIS_MONTH' }, NOW);
    expect(p).toMatchObject({ kind: 'THIS_MONTH', startDate: '2026-11-01', endDate: '2026-11-17' });
    expect(iso(p.start)).toBe('2026-10-31T22:00:00.000Z');
    expect(p.endExclusive).toEqual(NOW);
  });
  it('uses the CAIRO month, not the UTC month (22:30Z on 30 Nov is already 1 December in Cairo)', () => {
    const p = resolveReportPeriod({ kind: 'THIS_MONTH' }, new Date('2026-11-30T22:30:00Z'));
    expect(p).toMatchObject({ startDate: '2026-12-01', endDate: '2026-12-01' });
    expect(iso(p.start)).toBe('2026-11-30T22:00:00.000Z');
  });
});

describe('LAST_MONTH: the previous FULL calendar month', () => {
  it('is [1st of last month, 1st of this month) with the DST change inside it', () => {
    const p = resolveReportPeriod({ kind: 'LAST_MONTH' }, NOW);
    expect(p).toMatchObject({ kind: 'LAST_MONTH', startDate: '2026-10-01', endDate: '2026-10-31' });
    expect(iso(p.start)).toBe('2026-09-30T21:00:00.000Z'); // 1 Oct, still summer time (UTC+3)
    expect(iso(p.endExclusive)).toBe('2026-10-31T22:00:00.000Z'); // 1 Nov, winter time (UTC+2)
  });
  it('crosses the year (January -> December of the previous year) and ends on 28 Feb in a common year', () => {
    const jan = resolveReportPeriod({ kind: 'LAST_MONTH' }, new Date('2027-01-10T10:00:00Z'));
    expect(jan).toMatchObject({ startDate: '2026-12-01', endDate: '2026-12-31' });
    expect(iso(jan.start)).toBe('2026-11-30T22:00:00.000Z');
    expect(iso(jan.endExclusive)).toBe('2026-12-31T22:00:00.000Z');
    expect(resolveReportPeriod({ kind: 'LAST_MONTH' }, new Date('2027-03-05T10:00:00Z')).endDate).toBe('2027-02-28');
    expect(resolveReportPeriod({ kind: 'LAST_MONTH' }, new Date('2028-03-05T10:00:00Z')).endDate).toBe('2028-02-29');
  });
  it('a record at 22:30Z on 31 Oct (1 Nov 00:30 in Cairo) is NOT in last month (October) but is in November', () => {
    const at = new Date('2026-10-31T22:30:00Z').getTime();
    const oct = resolveReportPeriod({ kind: 'LAST_MONTH' }, NOW);
    expect(at >= oct.start!.getTime() && at < oct.endExclusive!.getTime()).toBe(false);
    const nov = resolveReportPeriod({ kind: 'THIS_MONTH' }, NOW);
    expect(at >= nov.start!.getTime() && at < nov.endExclusive!.getTime()).toBe(true);
  });
});

describe('ACROSS_TIME', () => {
  it('has no date bounds (the authorized scope, not the period, limits the data)', () => {
    expect(resolveReportPeriod({ kind: 'ACROSS_TIME' }, NOW)).toEqual({ kind: 'ACROSS_TIME', start: null, endExclusive: null, startDate: null, endDate: null });
  });
});

describe('CUSTOM: inclusive start and end DATES, internally [start, end + 1 day)', () => {
  it('a single day is [00:00, next 00:00) in Cairo', () => {
    const p = resolveReportPeriod({ kind: 'CUSTOM', startDate: '2026-11-01', endDate: '2026-11-01' }, NOW);
    expect(iso(p.start)).toBe('2026-10-31T22:00:00.000Z');
    expect(iso(p.endExclusive)).toBe('2026-11-01T22:00:00.000Z');
    expect(p).toMatchObject({ startDate: '2026-11-01', endDate: '2026-11-01' });
  });
  it('the end DATE is INCLUDED: the whole last day is inside, the next day is not', () => {
    const p = resolveReportPeriod({ kind: 'CUSTOM', startDate: '2026-11-01', endDate: '2026-11-10' }, NOW);
    const inside = new Date('2026-11-10T21:59:59.999Z').getTime(); // 23:59:59.999 Cairo on 10 Nov
    const outside = new Date('2026-11-10T22:00:00.000Z').getTime(); // 00:00 on 11 Nov
    expect(inside < p.endExclusive!.getTime()).toBe(true);
    expect(outside < p.endExclusive!.getTime()).toBe(false);
  });
  it('a day with a DST change is 23 or 25 hours long, not 24', () => {
    const spring = resolveReportPeriod({ kind: 'CUSTOM', startDate: '2026-04-24', endDate: '2026-04-24' }, NOW);
    const fall = resolveReportPeriod({ kind: 'CUSTOM', startDate: '2026-10-29', endDate: '2026-10-29' }, NOW);
    const hours = (p: { start: Date | null; endExclusive: Date | null }) => (p.endExclusive!.getTime() - p.start!.getTime()) / 3600000;
    expect(hours(spring)).toBe(23);
    expect(hours(fall)).toBe(25);
  });
  it('may end in the future (the specification does not forbid it)', () => {
    expect(codeOf(() => resolveReportPeriod({ kind: 'CUSTOM', startDate: '2026-11-01', endDate: '2027-01-31' }, NOW))).toBe('NO_ERROR');
  });
});

describe('validation (nothing is silently ignored)', () => {
  it('refuses an unknown or wrongly-cased kind', () => {
    for (const kind of ['', 'this_month', 'WEEK', 'YEAR', undefined as unknown as string]) expect(codeOf(() => resolveReportPeriod({ kind }, NOW))).toBe('INVALID_REPORT_PERIOD');
  });
  it('refuses dates on a kind that takes none', () => {
    for (const kind of ['THIS_MONTH', 'LAST_MONTH', 'ACROSS_TIME']) {
      expect(codeOf(() => resolveReportPeriod({ kind, startDate: '2026-11-01' }, NOW))).toBe('REPORT_PERIOD_DATES_NOT_ALLOWED');
      expect(codeOf(() => resolveReportPeriod({ kind, endDate: '2026-11-01' }, NOW))).toBe('REPORT_PERIOD_DATES_NOT_ALLOWED');
    }
  });
  it('CUSTOM needs both dates, real calendar dates, and start <= end', () => {
    expect(codeOf(() => resolveReportPeriod({ kind: 'CUSTOM' }, NOW))).toBe('REPORT_CUSTOM_DATES_REQUIRED');
    expect(codeOf(() => resolveReportPeriod({ kind: 'CUSTOM', startDate: '2026-11-01' }, NOW))).toBe('REPORT_CUSTOM_DATES_REQUIRED');
    expect(codeOf(() => resolveReportPeriod({ kind: 'CUSTOM', endDate: '2026-11-01' }, NOW))).toBe('REPORT_CUSTOM_DATES_REQUIRED');
    for (const bad of ['2026-02-30', '2026-13-01', '2026-1-1', '01/11/2026', '', '2026-11-01T00:00:00Z']) {
      expect(codeOf(() => resolveReportPeriod({ kind: 'CUSTOM', startDate: bad, endDate: '2026-11-10' }, NOW))).toBe('INVALID_REPORT_DATE');
      expect(codeOf(() => resolveReportPeriod({ kind: 'CUSTOM', startDate: '2026-11-01', endDate: bad }, NOW))).toBe('INVALID_REPORT_DATE');
    }
    expect(codeOf(() => resolveReportPeriod({ kind: 'CUSTOM', startDate: '2026-11-10', endDate: '2026-11-09' }, NOW))).toBe('REPORT_PERIOD_START_AFTER_END');
    expect(codeOf(() => resolveReportPeriod({ kind: 'CUSTOM', startDate: '2026-11-10', endDate: '2026-11-10' }, NOW))).toBe('NO_ERROR');
  });
});

describe('student report effective start: MAX(join date, requested start) (§67)', () => {
  const nov = resolveReportPeriod({ kind: 'THIS_MONTH' }, NOW);
  const oct = resolveReportPeriod({ kind: 'LAST_MONTH' }, NOW);

  it('a student who joined BEFORE the period is reported from the period start', () => {
    const w = studentReportWindow(nov, '2026-03-15');
    expect(w.start).toEqual(nov.start);
    expect(w.isEmpty).toBe(false);
  });
  it('a student who joined DURING the period is reported only from the join day (never before it)', () => {
    const w = studentReportWindow(nov, '2026-11-10');
    expect(iso(w.start)).toBe('2026-11-09T22:00:00.000Z');
    expect(w.start.getTime()).toBeGreaterThan(nov.start!.getTime());
    expect(w.endExclusive).toEqual(NOW);
  });
  it('joining on the very first day of the period changes nothing', () => {
    expect(studentReportWindow(nov, '2026-11-01').start).toEqual(nov.start);
  });
  it('a student who joined AFTER the period ended has nothing to report', () => {
    expect(studentReportWindow(oct, '2026-11-02').isEmpty).toBe(true);
    expect(studentReportWindow(oct, '2026-11-01').isEmpty).toBe(true); // joined the day the period ended (exclusive end)
    expect(studentReportWindow(oct, '2026-10-31').isEmpty).toBe(false); // joined on its last day: that day counts
  });
  it('ACROSS_TIME starts at the join date and is unbounded at the end', () => {
    const across = resolveReportPeriod({ kind: 'ACROSS_TIME' }, NOW);
    const w = studentReportWindow(across, '2025-09-01');
    expect(iso(w.start)).toBe('2025-08-31T21:00:00.000Z');
    expect(w.endExclusive).toBeNull();
    expect(w.isEmpty).toBe(false);
  });
  it('a CUSTOM period that ends before the join date is empty; one that contains it starts at the join day', () => {
    expect(studentReportWindow(resolveReportPeriod({ kind: 'CUSTOM', startDate: '2026-01-01', endDate: '2026-01-31' }, NOW), '2026-02-01').isEmpty).toBe(true);
    const w = studentReportWindow(resolveReportPeriod({ kind: 'CUSTOM', startDate: '2026-01-01', endDate: '2026-01-31' }, NOW), '2026-01-20');
    expect(iso(w.start)).toBe('2026-01-19T22:00:00.000Z');
    expect(w.isEmpty).toBe(false);
  });
  it('the window NEVER starts before the join date, whatever the period', () => {
    const periods = [nov, oct, resolveReportPeriod({ kind: 'ACROSS_TIME' }, NOW), resolveReportPeriod({ kind: 'CUSTOM', startDate: '2020-01-01', endDate: '2030-01-01' }, NOW)];
    for (const joinDate of ['2019-05-05', '2026-04-24', '2026-10-29', '2026-11-17', '2027-02-01']) {
      for (const p of periods) expect(studentReportWindow(p, joinDate).start.getTime()).toBeGreaterThanOrEqual(startOfBusinessDay(joinDate).getTime());
    }
  });
  it('refuses a join date that is not a real calendar date', () => {
    expect(codeOf(() => studentReportWindow(nov, '2026-02-30'))).toBe('INVALID_REPORT_DATE');
    expect(codeOf(() => studentReportWindow(nov, ''))).toBe('INVALID_REPORT_DATE');
  });
});

describe('ReportPeriodService', () => {
  it('uses the injected clock for the current month', () => {
    const service = new ReportPeriodService({ clock: { now: () => new Date('2026-12-02T08:00:00Z') } });
    expect(service.resolvePeriod({ kind: 'THIS_MONTH' }).startDate).toBe('2026-12-01');
    const period = service.resolvePeriod({ kind: 'LAST_MONTH' });
    expect(service.studentWindow(period, '2026-11-15').start.toISOString()).toBe('2026-11-14T22:00:00.000Z');
  });
});
