import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RECOVERY_ERROR_MESSAGES, RecoveryErrorCodes } from '../../../src/modules/11-otp-password-recovery/public';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}

describe('recovery error messages', () => {
  it('has Arabic and English text for every recovery error code', () => {
    for (const code of Object.values(RecoveryErrorCodes)) {
      const entry = RECOVERY_ERROR_MESSAGES.find((m) => m.code === code);
      expect(entry, code).toBeDefined();
      expect(entry!.message.ar.length).toBeGreaterThan(0);
      expect(entry!.message.en.length).toBeGreaterThan(0);
    }
  });
});

describe('Module 11 boundaries and secrecy', () => {
  const root = path.resolve(__dirname, '../../../src/modules/11-otp-password-recovery');
  const files = sourceFiles(root);
  const importsOf = (file: string) => [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
  const all = files.flatMap((file) => importsOf(file).map((spec) => ({ file, spec })));

  it('imports other modules only through their public contract', () => {
    expect(all.filter(({ spec }) => /\/\d{2}-[a-z-]+\//.test(spec) && !/\/\d{2}-[a-z-]+\/public$/.test(spec))).toEqual([]);
  });

  it('depends only on lower-numbered modules (no circular dependency)', () => {
    const higher = all.filter(({ spec }) => {
      const m = /\/(\d{2})-[a-z-]+\/public$/.exec(spec);
      return m !== null && Number(m[1]) >= 11;
    });
    expect(higher).toEqual([]);
  });

  it('keeps frameworks out of the domain and application layers', () => {
    const inner = all.filter(({ file }) => /\/(domain|application)\//.test(file.split(path.sep).join('/')));
    expect(inner.filter(({ spec }) => ['express', 'sequelize', 'node:crypto', 'node:fs', 'node:fs/promises'].includes(spec))).toEqual([]);
  });

  it('never passes an OTP, reset token or password to a logger', () => {
    // looks at the FIELDS object passed to a logger call, not at the message text
    const offenders = files.filter((f) => /logger\.(error|warn|info|debug)\(\s*['"`][^'"`]*['"`]\s*,\s*\{[^}]*(otp|resetToken|password|phone)/i.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('reads no environment variables itself (configuration comes from Module 01)', () => {
    expect(files.filter((f) => /process\.env/.test(readFileSync(f, 'utf8')))).toEqual([]);
  });
});
