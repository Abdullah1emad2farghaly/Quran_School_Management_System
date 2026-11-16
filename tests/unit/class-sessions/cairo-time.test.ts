import { describe, expect, it } from 'vitest';
import { addDays, cairoOffsetMs, cairoWallClockToUtc, isoWeekdayOfDate } from '../../../src/modules/24-sessions/public';

const HOUR = 3_600_000;
const at = (iso: string) => new Date(iso);

describe('Cairo wall-clock time to UTC (Module 24)', () => {
  it('uses UTC+2 in winter and UTC+3 in summer', () => {
    expect(cairoWallClockToUtc('2026-01-15', 18 * 60)).toEqual(at('2026-01-15T16:00:00Z'));
    expect(cairoWallClockToUtc('2026-07-15', 18 * 60)).toEqual(at('2026-07-15T15:00:00Z'));
    expect(cairoOffsetMs(at('2026-01-15T12:00:00Z'))).toBe(2 * HOUR);
    expect(cairoOffsetMs(at('2026-07-15T12:00:00Z'))).toBe(3 * HOUR);
  });

  it('follows the end of daylight saving time (clocks go back at the end of Thursday 2026-10-29)', () => {
    expect(cairoWallClockToUtc('2026-10-29', 18 * 60)).toEqual(at('2026-10-29T15:00:00Z')); // still summer time
    expect(cairoWallClockToUtc('2026-10-30', 18 * 60)).toEqual(at('2026-10-30T16:00:00Z')); // winter time
  });

  it('a wall time that happens twice is the FIRST occurrence', () => {
    expect(cairoWallClockToUtc('2026-10-29', 23 * 60 + 30)).toEqual(at('2026-10-29T20:30:00Z'));
  });

  it('a wall time that does not exist (clocks go forward at midnight 2026-04-24) is read with the offset before the change', () => {
    expect(cairoWallClockToUtc('2026-04-24', 30)).toEqual(at('2026-04-23T22:30:00Z'));
    expect(cairoWallClockToUtc('2026-04-24', 90)).toEqual(at('2026-04-23T22:30:00Z')); // 01:30 exists (summer time) and is the same instant
    expect(cairoWallClockToUtc('2026-04-24', 2 * 60)).toEqual(at('2026-04-23T23:00:00Z')); // 02:00 summer time
  });

  it('date arithmetic and the ISO weekday involve no zone', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(isoWeekdayOfDate('2026-11-02')).toBe(1); // Monday
    expect(isoWeekdayOfDate('2026-11-01')).toBe(7); // Sunday
    expect(isoWeekdayOfDate('2026-10-31')).toBe(6); // Saturday
  });
});
