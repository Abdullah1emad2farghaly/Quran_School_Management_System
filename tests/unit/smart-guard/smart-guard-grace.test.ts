import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_AFTER_END_MINUTES, isInsideProtectedWindow, protectedWindowOf } from '../../../src/modules/25-smart-guard/public';
import { END, INSIDE, createGuardFakes } from '../../helpers/smart-guard-fakes';

const at = (iso: string) => new Date(iso);
const check = (t: ReturnType<typeof createGuardFakes>, extra: Record<string, unknown> = {}) => t.guard.check({ teacherId: 'teacher-1', sessionId: 'session-1', gps: INSIDE, ...extra } as never);
const refused = async (promise: Promise<unknown>, code: string) => expect(promise).rejects.toMatchObject({ code });

describe('the narrow Module 29 exception: `allowAfterEndMinutes` keeps the window open after the scheduled end, and nothing else changes', () => {
  it('WITHOUT the option the general window is untouched: the end is inclusive and one millisecond later is refused (Attendance, Memorization and Revision never pass it)', async () => {
    const t = createGuardFakes();
    t.clock.set(END);
    expect((await check(t)).sessionId).toBe('session-1');
    t.clock.set(at('2026-11-02T17:00:00.001Z'));
    await refused(check(t), 'SMART_GUARD_OUTSIDE_SESSION_WINDOW');
    await refused(check(t, { allowAfterEndMinutes: 0 }), 'SMART_GUARD_OUTSIDE_SESSION_WINDOW');
    t.clock.set(at('2026-11-02T17:05:00Z'));
    await refused(check(t), 'SMART_GUARD_OUTSIDE_SESSION_WINDOW');
  });

  it('WITH allowAfterEndMinutes = 15 the window closes exactly 15 minutes after the scheduled end (inclusive), and the refusal reports that closing time', async () => {
    const t = createGuardFakes();
    t.clock.set(at('2026-11-02T17:00:00.001Z'));
    expect((await check(t, { allowAfterEndMinutes: 15 })).sessionId).toBe('session-1');
    t.clock.set(at('2026-11-02T17:15:00.000Z'));
    expect((await check(t, { allowAfterEndMinutes: 15 })).sessionId).toBe('session-1');
    t.clock.set(at('2026-11-02T17:15:00.001Z'));
    await expect(check(t, { allowAfterEndMinutes: 15 })).rejects.toMatchObject({ code: 'SMART_GUARD_OUTSIDE_SESSION_WINDOW', details: { opensAt: '2026-11-02T15:45:00.000Z', closesAt: '2026-11-02T17:15:00.000Z' } });
  });

  it('the opening of the window (15 minutes before the start) is unchanged by the option', async () => {
    const t = createGuardFakes();
    t.clock.set(at('2026-11-02T15:44:59.999Z'));
    await refused(check(t, { allowAfterEndMinutes: 15 }), 'SMART_GUARD_OUTSIDE_SESSION_WINDOW');
    t.clock.set(at('2026-11-02T15:45:00.000Z'));
    expect((await check(t, { allowAfterEndMinutes: 15 })).sessionId).toBe('session-1');
  });

  it('GPS, geofence, accuracy, ownership and cancellation are ALL still enforced during the extra minutes (Smart Guard and GPS remain mandatory)', async () => {
    const t = createGuardFakes();
    t.clock.set(at('2026-11-02T17:10:00Z'));
    await refused(check(t, { allowAfterEndMinutes: 15, gps: undefined }), 'SMART_GUARD_GPS_REQUIRED');
    await refused(check(t, { allowAfterEndMinutes: 15, gps: { ...INSIDE, latitude: INSIDE.latitude + 0.0001 } }), 'SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE');
    await refused(check(t, { allowAfterEndMinutes: 15, gps: { ...INSIDE, accuracyMeters: 25 } }), 'SMART_GUARD_GPS_ACCURACY_TOO_LOW');
    await refused(check(t, { allowAfterEndMinutes: 15, teacherId: 'teacher-2' }), 'SMART_GUARD_NOT_SESSION_TEACHER');
    t.state.session = { ...t.state.session, status: 'CANCELLED' };
    await refused(check(t, { allowAfterEndMinutes: 15 }), 'SMART_GUARD_SESSION_CANCELLED');
  });

  it('the exception is capped: no module can ask for more than 15 minutes, and a negative, fractional or non-numeric value is a programming error', async () => {
    expect(MAX_AFTER_END_MINUTES).toBe(15);
    const t = createGuardFakes();
    t.clock.set(at('2026-11-02T17:10:00Z'));
    for (const bad of [16, 60, -1, 1.5, NaN, '15']) await expect(check(t, { allowAfterEndMinutes: bad })).rejects.toThrow(/allowAfterEndMinutes/);
  });

  it('the window helper defaults to the general window', () => {
    const start = at('2026-11-02T16:00:00Z');
    expect(protectedWindowOf(start, END, 15).closesAt).toEqual(END);
    expect(isInsideProtectedWindow(at('2026-11-02T17:00:00.001Z'), protectedWindowOf(start, END, 15))).toBe(false);
    expect(protectedWindowOf(start, END, 15, 15).closesAt.toISOString()).toBe('2026-11-02T17:15:00.000Z');
  });
});

describe('only Module 29 may use the exception', () => {
  const root = path.resolve(__dirname, '../../../src');
  /** Paths are compared in forward-slash form so that the scan also works on Windows (where `path.sep` is a backslash). */
  const posix = (p: string): string => p.split(path.sep).join('/');
  const sourceFiles = (dir: string): string[] => readdirSync(dir).flatMap((name) => { const full = path.join(dir, name); return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : []; });
  it('no source file outside Module 25 itself and Module 29 mentions `allowAfterEndMinutes`', () => {
    const offenders = sourceFiles(root).filter((f) => !posix(f).includes('/25-smart-guard/') && !posix(f).includes('/29-evaluations/') && readFileSync(f, 'utf8').includes('allowAfterEndMinutes'));
    expect(offenders).toEqual([]);
  });
  it('Module 29 passes it from exactly one place, with its own 15-minute constant', () => {
    const service = readFileSync(path.join(root, 'modules/29-evaluations/application/services/evaluation-service.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
    expect([...service.matchAll(/allowAfterEndMinutes/g)]).toHaveLength(1);
    expect(service).toContain('allowAfterEndMinutes: GRACE_MINUTES');
  });
});
