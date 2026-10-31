import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { registerAllErrorMessages } from '../../../src/app/bootstrap/register-error-messages';
import { defaultMessageCatalog } from '../../../src/modules/03-error-localization/public';
import { SMART_GUARD_ERROR_MESSAGES, SmartGuardErrorCodes } from '../../../src/modules/25-smart-guard/public';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
const MODULE = path.resolve(__dirname, '../../../src/modules/25-smart-guard');
const files = sourceFiles(MODULE);
const imports = files.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => ({ file, spec: m[1]! })));

describe('Smart Guard error messages', () => {
  it('has Arabic and English text for every code, and nothing else', () => {
    expect(SMART_GUARD_ERROR_MESSAGES.map((m) => m.code).sort()).toEqual(Object.values(SmartGuardErrorCodes).sort());
    for (const m of SMART_GUARD_ERROR_MESSAGES) {
      expect(m.message.ar.length).toBeGreaterThan(0);
      expect(m.message.en.length).toBeGreaterThan(0);
    }
  });
  it('are registered, and the geofence and accuracy messages render their limit', () => {
    registerAllErrorMessages();
    for (const c of Object.values(SmartGuardErrorCodes)) expect(defaultMessageCatalog.has(c), c).toBe(true);
    expect(defaultMessageCatalog.message('SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE', 'en', { maxMeters: 50 })).toContain('50 meters');
    expect(defaultMessageCatalog.message('SMART_GUARD_GPS_ACCURACY_TOO_LOW', 'ar', { maxMeters: 20 })).toContain('20');
  });
});

describe('Smart Guard boundaries', () => {
  it('imports other modules only through their public contract, and only lower-numbered modules', () => {
    expect(imports.filter(({ spec }) => /\/\d{2}-[a-z-]+\//.test(spec) && !/\/\d{2}-[a-z-]+\/public$/.test(spec))).toEqual([]);
    expect(imports.filter(({ spec }) => { const m = /\/(\d{2})-[a-z-]+\/public$/.exec(spec); return m !== null && Number(m[1]) >= 25; })).toEqual([]);
  });

  it('its actual code dependencies are exactly Modules 00, 03, 05, 16 and 24 (12, 18, 22 and 23 are NOT imported: nothing in the approved behaviour needs them)', () => {
    const used = new Set(imports.map(({ spec }) => /\/(\d{2})-[a-z-]+\/public$/.exec(spec)?.[1]).filter(Boolean));
    expect([...used].sort()).toEqual(['00', '03', '05', '16', '24']);
  });

  it('is stateless: no database, no SQL, no persistence, no HTTP', () => {
    for (const f of files) {
      const code = strip(readFileSync(f, 'utf8'));
      expect(code, f).not.toMatch(/from 'sequelize'|from 'express'|\bSELECT\s|\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b|\bDELETE\s+FROM\b|\.query\(|\bRouter\(/);
    }
    expect(files.map((f) => path.relative(MODULE, f).replace(/\\/g, '/')).filter((f) => /persistence|presentation|jobs/.test(f))).toEqual([]);
  });

  it('is deterministic apart from the injected clock: no Date.now / new Date() / Math.random', () => {
    for (const f of files) expect(strip(readFileSync(f, 'utf8')), f).not.toMatch(/\b(Date\.now|new Date\(\s*\)|Math\.random)/);
  });

  it('never logs a location: its log calls mention only the rejection code and the session id', () => {
    const service = strip(readFileSync(path.join(MODULE, 'application/services/smart-guard.ts'), 'utf8'));
    const logCalls = [...service.matchAll(/logger\?\.\w+\([^;]*\);/g)].map((m) => m[0]);
    expect(logCalls.length).toBeGreaterThan(0);
    for (const call of logCalls) expect(call).not.toMatch(/gps|latitude|longitude|accuracy|distance|school/i);
  });

  it('does not import Session cancellation or any Module 24 write: cancelling a session is not a protected action', () => {
    const service = strip(readFileSync(path.join(MODULE, 'application/services/smart-guard.ts'), 'utf8'));
    expect(service).not.toMatch(/cancelSession|generateDueSessions|advanceDueSessions/);
    expect(service).toMatch(/Pick<ClassSessionService, 'getSession'>/);
  });
});
