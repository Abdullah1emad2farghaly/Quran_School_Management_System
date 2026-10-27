import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { registerAllErrorMessages } from '../../../src/app/bootstrap/register-error-messages';
import { defaultMessageCatalog } from '../../../src/modules/03-error-localization/public';
import * as publicApi from '../../../src/modules/22-quran-range-engine/public';
import { QURAN_RANGE_ERROR_MESSAGES, QuranRangeErrorCodes } from '../../../src/modules/22-quran-range-engine/public';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
const ROOT = path.resolve(__dirname, '../../..');
const MODULE = path.join(ROOT, 'src/modules/22-quran-range-engine');
const files = sourceFiles(MODULE);
const code = (file: string) => strip(readFileSync(file, 'utf8'));

describe('Module 22 error messages', () => {
  it('has Arabic and English text for every range error code, and nothing else', () => {
    const codes = Object.values(QuranRangeErrorCodes);
    expect(QURAN_RANGE_ERROR_MESSAGES.map((m) => m.code).sort()).toEqual([...codes].sort());
    for (const entry of QURAN_RANGE_ERROR_MESSAGES) {
      expect(entry.message.ar.length).toBeGreaterThan(0);
      expect(entry.message.en.length).toBeGreaterThan(0);
    }
  });

  it('are registered with the application (registerAllErrorMessages)', () => {
    registerAllErrorMessages();
    for (const c of Object.values(QuranRangeErrorCodes)) {
      expect(defaultMessageCatalog.has(c), c).toBe(true);
      expect(defaultMessageCatalog.message(c, 'ar')).not.toBe(defaultMessageCatalog.message(c, 'en'));
    }
  });
});

describe('Module 22 boundaries (a calculation engine over Module 21\'s public contract)', () => {
  const imports = files.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => ({ file, spec: m[1]! })));

  it('imports other modules only through their public contract, and only lower-numbered modules', () => {
    expect(imports.filter(({ spec }) => /\/\d{2}-[a-z-]+\//.test(spec) && !/\/\d{2}-[a-z-]+\/public$/.test(spec))).toEqual([]);
    expect(imports.filter(({ spec }) => { const m = /\/(\d{2})-[a-z-]+\/public$/.exec(spec); return m !== null && Number(m[1]) >= 22; })).toEqual([]);
    const used = new Set(imports.map(({ spec }) => /\/(\d{2}-[a-z-]+)\/public$/.exec(spec)?.[1]).filter(Boolean));
    expect([...used].sort()).toEqual(['00-shared-kernel', '03-error-localization', '21-quran-structure']);
  });

  it('has no persistence, no HTTP and no tables: it stores nothing and duplicates no Quran data', () => {
    const forbidden = /\b(sequelize|express|queryInterface|createTable|QueryTypes|SELECT\s|INSERT\s|UPDATE\s|DELETE\s|process\.env|readFileSync|fetch\()/i;
    for (const f of files) expect(code(f), f).not.toMatch(forbidden);
    const real = (dir: string) => (statSync(path.join(MODULE, dir), { throwIfNoEntry: false }) ? sourceFiles(path.join(MODULE, dir)) : []);
    expect(real('infrastructure')).toEqual([]);
    expect(real('presentation')).toEqual([]);
    expect(readdirSync(path.join(ROOT, 'database/migrations')).filter((n) => /range/i.test(n))).toEqual([]);
  });

  it('is deterministic: no clock, no randomness, no module-level state', () => {
    for (const f of files) {
      expect(code(f), f).not.toMatch(/\b(Date\.now|new Date|Math\.random|randomUUID|setTimeout|setInterval)\b/);
      expect(code(f), f).not.toMatch(/^let\s/m);
    }
  });

  it('exposes the engine, its types, the units and directions, and the error contract', () => {
    expect(Object.keys(publicApi).sort()).toEqual(['QURAN_RANGE_ERROR_MESSAGES', 'QuranRangeEngine', 'QuranRangeErrorCodes', 'RANGE_DIRECTIONS', 'RANGE_UNITS', 'parseRangeRequest', 'rangeError']);
    expect([...publicApi.RANGE_UNITS]).toEqual(['SURAHS', 'AYAHS', 'QUARTERS', 'PAGES', 'LINES']);
    expect([...publicApi.RANGE_DIRECTIONS]).toEqual(['FORWARD', 'BACKWARD']);
  });
});
