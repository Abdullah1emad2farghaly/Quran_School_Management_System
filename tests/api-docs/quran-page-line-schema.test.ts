import type { OpenAPIV3 } from 'openapi-types';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllErrorMessages } from '../../src/app/bootstrap/register-error-messages';
import { buildApiDocument } from '../../src/app/openapi/api-documents';
import { createSubsetChecker } from '../../docs/verification/module21/openapi-subset-checker';
import { createQuranHarness } from '../helpers/quran-service-harness';
import { createSchemaChecker, dereference } from './support/schema-validation';

/**
 * GET /quran/pages/{page}: a TEXT line names its first and last ayah; a SURAH_HEADER (surah banner) or BASMALA line carries a surah and NO ayah,
 * so `firstAyah` / `lastAyah` are `null` there. The documented schema must allow exactly that (and nothing looser), and both validators
 * (the project's Ajv suite and the real-dataset verification script's subset checker) must agree.
 */
const ayahRef = { globalPosition: 1, surah: 1, ayah: 1 };

describe('QuranLine schema: firstAyah / lastAyah are an ayah reference or null', () => {
  let lineSchema: OpenAPIV3.SchemaObject;
  let dereferenced: OpenAPIV3.SchemaObject;
  let schemas: Record<string, unknown>;
  const ajv = createSchemaChecker();

  beforeAll(async () => {
    registerAllErrorMessages();
    const document = buildApiDocument();
    schemas = document.components!.schemas as Record<string, unknown>;
    lineSchema = schemas.QuranLine as OpenAPIV3.SchemaObject;
    dereferenced = (await dereference(document)).components!.schemas!.QuranLine as OpenAPIV3.SchemaObject;
  });

  const text = (over: Record<string, unknown> = {}) => ({ globalLine: 3, page: 1, line: 2, kind: 'TEXT', surah: null, firstAyah: ayahRef, lastAyah: ayahRef, ...over });
  const banner = (over: Record<string, unknown> = {}) => ({ globalLine: 1, page: 1, line: 1, kind: 'SURAH_HEADER', surah: 1, firstAyah: null, lastAyah: null, ...over });

  const validators = (): Array<[string, (value: unknown) => string[]]> => [
    ['project Ajv suite', (value) => ajv.check(dereferenced, value)],
    [
      "verification script's subset checker",
      (value) => {
        const checker = createSubsetChecker(schemas as Record<string, any>);
        checker.conforms(lineSchema, value, 'line');
        return [...checker.problems];
      },
    ],
  ];

  describe.each(validators())('%s', (_name, check) => {
    it('accepts a TEXT line whose ayahs are non-null references', () => {
      expect(check(text())).toEqual([]);
      expect(check(text({ firstAyah: ayahRef, lastAyah: { globalPosition: 2, surah: 1, ayah: 2 } }))).toEqual([]);
    });

    it('accepts SURAH_HEADER and BASMALA lines with null ayahs and their surah', () => {
      expect(check(banner())).toEqual([]);
      expect(check(banner({ kind: 'BASMALA', line: 2, globalLine: 2 }))).toEqual([]);
    });

    it('rejects a malformed ayah reference (wrong type, missing field, wrong field type)', () => {
      expect(check(text({ firstAyah: 'x' })).length).toBeGreaterThan(0);
      expect(check(text({ firstAyah: 7 })).length).toBeGreaterThan(0);
      expect(check(text({ firstAyah: [] })).length).toBeGreaterThan(0);
      expect(check(text({ firstAyah: { surah: 1, ayah: 1 } })).length).toBeGreaterThan(0);
      expect(check(text({ lastAyah: { ...ayahRef, ayah: 'one' } })).length).toBeGreaterThan(0);
    });

    it('still requires the fields: a missing firstAyah / lastAyah is not the same as null', () => {
      const { firstAyah: _first, ...withoutFirst } = text();
      const { lastAyah: _last, ...withoutLast } = text();
      expect(check(withoutFirst).length).toBeGreaterThan(0);
      expect(check(withoutLast).length).toBeGreaterThan(0);
    });

    it('does not make other fields nullable and keeps the kind enum', () => {
      expect(check(text({ page: null })).length).toBeGreaterThan(0);
      expect(check(text({ line: null })).length).toBeGreaterThan(0);
      expect(check(text({ kind: null })).length).toBeGreaterThan(0);
      expect(check(text({ kind: 'FOOTNOTE' })).length).toBeGreaterThan(0);
    });
  });

  it("the verification script's subset checker also rejects undocumented keys and non-objects (the documented schema itself is open to extra keys)", () => {
    const checker = createSubsetChecker(schemas as Record<string, any>);
    checker.conforms(lineSchema, text({ lastAyah: { ...ayahRef, extra: 1 } }), 'line');
    checker.conforms(lineSchema, 'not a line', 'line');
    // inside the nullable reference the detail of a failed branch is not reported, only that no branch matched
    expect(checker.problems.some((p) => p.includes('line.lastAyah: matches 0 of 2 oneOf branches'))).toBe(true);
    expect(checker.problems.some((p) => p.includes('not an object'))).toBe(true);
  });

  it("the page of the service's real data model: banner/basmala lines are null, TEXT lines are not, and every line conforms", async () => {
    const { service, importSynthetic } = createQuranHarness();
    await importSynthetic();
    const page = await service.getPage(1);
    expect(page).not.toBeNull();
    const lines = page!.lines;
    expect(lines.some((l) => l.kind === 'TEXT')).toBe(true);
    expect(lines.some((l) => l.kind !== 'TEXT')).toBe(true);
    for (const line of lines) {
      if (line.kind === 'TEXT') {
        expect(line.firstAyah).not.toBeNull();
        expect(line.lastAyah).not.toBeNull();
        expect(line.surah).toBeNull();
      } else {
        expect(line.firstAyah).toBeNull();
        expect(line.lastAyah).toBeNull();
        expect(line.surah).not.toBeNull();
      }
      for (const [name, check] of validators()) expect(check(line), `${name}: line ${line.line}`).toEqual([]);
    }
  });
});
