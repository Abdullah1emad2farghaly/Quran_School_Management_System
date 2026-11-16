import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { INSIDE, OUTSIDE, START, END, createGuardFakes } from '../../helpers/smart-guard-fakes';

const at = (iso: string) => new Date(iso);
const WINDOW = { opensAt: at('2026-11-02T15:45:00.000Z'), closesAt: END };
const check = (t: ReturnType<typeof createGuardFakes>, over: Record<string, unknown> = {}) => t.guard.checkProtectedAction({ teacherId: 'teacher-1', schoolId: 'school-1', gps: INSIDE, window: WINDOW, ...over } as never);
const refused = async (promise: Promise<unknown>, code: string) => expect(promise).rejects.toMatchObject({ code });

describe('the exam-compatible entry point `checkProtectedAction` (approved with Module 30; additive)', () => {
  it('allows a reading inside the school, accurate enough, inside the supplied window (both ends inclusive)', async () => {
    const t = createGuardFakes();
    for (const iso of ['2026-11-02T15:45:00.000Z', '2026-11-02T16:30:00.000Z', '2026-11-02T17:00:00.000Z']) {
      t.clock.set(at(iso));
      await expect(check(t)).resolves.toBeUndefined();
    }
  });

  it('refuses outside the window, reporting the window; one millisecond outside on either side is refused', async () => {
    const t = createGuardFakes();
    t.clock.set(at('2026-11-02T15:44:59.999Z'));
    await expect(check(t)).rejects.toMatchObject({ code: 'SMART_GUARD_OUTSIDE_SESSION_WINDOW', details: { opensAt: '2026-11-02T15:45:00.000Z', closesAt: '2026-11-02T17:00:00.000Z' } });
    t.clock.set(at('2026-11-02T17:00:00.001Z'));
    await refused(check(t), 'SMART_GUARD_OUTSIDE_SESSION_WINDOW');
  });

  it('a window with no upper bound (an exam without an end time) stays open', async () => {
    const t = createGuardFakes();
    t.clock.set(at('2030-01-01T00:00:00Z'));
    await expect(check(t, { window: { opensAt: WINDOW.opensAt, closesAt: null } })).resolves.toBeUndefined();
    t.clock.set(at('2026-11-02T15:44:00Z'));
    await refused(check(t, { window: { opensAt: WINDOW.opensAt, closesAt: null } }), 'SMART_GUARD_OUTSIDE_SESSION_WINDOW');
  });

  it('the GPS rules are the SAME as for sessions: required, valid, within 50 m of the school, accuracy 20 m or better, the school ACTIVE', async () => {
    const t = createGuardFakes();
    t.clock.set(START);
    await refused(check(t, { gps: undefined }), 'SMART_GUARD_GPS_REQUIRED');
    await refused(check(t, { gps: { latitude: 'x', longitude: 1, accuracyMeters: 1 } }), 'SMART_GUARD_GPS_INVALID');
    await refused(check(t, { gps: OUTSIDE }), 'SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE');
    await refused(check(t, { gps: { ...INSIDE, accuracyMeters: 20.01 } }), 'SMART_GUARD_GPS_ACCURACY_TOO_LOW');
    await expect(check(t, { gps: { ...INSIDE, accuracyMeters: 20 } })).resolves.toBeUndefined();
    const inactive = createGuardFakes({ school: { status: 'ARCHIVED' } });
    inactive.clock.set(START);
    await refused(check(inactive), 'SMART_GUARD_SCHOOL_NOT_ACTIVE');
    const missing = createGuardFakes({ school: null });
    missing.clock.set(START);
    await refused(check(missing), 'SMART_GUARD_SCHOOL_NOT_ACTIVE');
  });

  it('it does not read any session and does not return coordinates', async () => {
    const t = createGuardFakes();
    t.state.session = undefined as never; // a session lookup would blow up
    t.clock.set(START);
    expect(await check(t)).toBeUndefined();
  });
});

describe('Module 25 stays unchanged for every other module', () => {
  const root = path.resolve(__dirname, '../../../src');
  /** Paths are compared in forward-slash form so that the scan also works on Windows (where `path.sep` is a backslash). */
  const posix = (p: string): string => p.split(path.sep).join('/');
  const sourceFiles = (dir: string): string[] => readdirSync(dir).flatMap((name) => { const full = path.join(dir, name); return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : []; });
  it('only Module 30 calls `checkProtectedAction`; Attendance, Memorization, Revision and Evaluations still use `check`', () => {
    const users = sourceFiles(root).filter((f) => !posix(f).includes('/25-smart-guard/') && readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '').includes('checkProtectedAction')).map((f) => posix(path.relative(root, f)));
    expect(users.every((f) => f.startsWith('modules/30-exams/') || f.startsWith('config/'))).toBe(true);
    for (const m of ['26-attendance', '27-memorization', '28-revision', '29-evaluations']) {
      expect(sourceFiles(path.join(root, 'modules', m)).map((f) => readFileSync(f, 'utf8')).join('\n')).not.toMatch(/checkProtectedAction/);
    }
  });
});
