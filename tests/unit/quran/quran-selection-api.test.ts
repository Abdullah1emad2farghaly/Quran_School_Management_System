import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { QURAN_AYAH_COUNT, QURAN_READ_ROLES, QuranPermissions } from '../../../src/modules/21-quran-structure/public';
import { memorizationApiDoc } from '../../../src/modules/27-memorization/public';
import { revisionApiDoc } from '../../../src/modules/28-revision/public';
import { MEMORIZATION, createMemorizationApi } from '../../helpers/memorization-api-harness';
import { REVISION, createRevisionApi } from '../../helpers/revision-api-harness';
import { syntheticAyahText } from '../../helpers/quran-fixture';

/**
 * GET /memorization/ayahs and GET /revision/ayahs: both read the SAME approved Quran through Module 21's public contract.
 * Real routers, real sessions, real Authorization Engine, the SYNTHETIC dataset (never real Quran text).
 */
const apis = [
  { name: 'memorization', base: MEMORIZATION, create: createMemorizationApi, doc: memorizationApiDoc, operationId: 'getMemorizationAyahs' },
  { name: 'revision', base: REVISION, create: createRevisionApi, doc: revisionApiDoc, operationId: 'getRevisionAyahs' },
] as const;

describe.each(apis)('GET /$name/ayahs', ({ name, base, create, doc, operationId }) => {
  it('requires authentication (401) and the existing quran.structure.read permission (403 without any role)', async () => {
    const { app, t, login } = await create();
    const anonymous = await request(app).get(`${base}/ayahs`);
    expect([anonymous.status, anonymous.body.error.code]).toEqual([401, 'AUTHENTICATION_REQUIRED']);
    const school = await t.newSchool('School');
    await t.h.identity.createUser({ phone: '01090000001', password: 'secret1' }); // authenticated, but truly role-less (the harness createUser() always grants PARENT): the Authorization Engine denies by default
    const denied = await request(app).get(`${base}/ayahs`).set(await login({ phone: '01090000001', password: 'secret1' }));
    expect([denied.status, denied.body.error.code]).toEqual([403, 'ACCESS_DENIED']);
    void school;
  });

  it('any authorized role reads it, with the Module 21 data: real ayah text and identifiers, exactly as stored', async () => {
    const { app, t, login } = await create();
    const school = await t.newSchool('School');
    const manager = await t.newSchoolManager(school.id);
    const res = await request(app).get(`${base}/ayahs`).query({ page: 1, pageSize: 10 }).set(await login(manager));
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 10, total: QURAN_AYAH_COUNT });
    expect(res.body.data).toHaveLength(10);
    res.body.data.forEach((a: { globalPosition: number; surah: number; ayah: number; text: string }, i: number) => {
      expect(a.globalPosition).toBe(i + 1);
      expect(a.text).toBe(syntheticAyahText(a.surah, a.ayah)); // preserved exactly
    });
    expect(res.body.data[0]).toMatchObject({ surah: 1, ayah: 1, globalPosition: 1 });
    expect(res.body.data[6]).toMatchObject({ surah: 1, ayah: 7, globalPosition: 7 });
    expect(res.body.data[0]).toEqual(await t.quran.service.getAyahByGlobalPosition(1)); // the Module 21 DTO, unchanged
  });

  it('pages and reverses the canonical order; rejects unknown parameters and sort fields (400)', async () => {
    const { app, t, login } = await create();
    const school = await t.newSchool('School');
    const auth = await login(await t.newSchoolManager(school.id));
    const last = await request(app).get(`${base}/ayahs`).query({ page: 1, pageSize: 3, sort: '-globalPosition' }).set(auth);
    expect(last.body.data.map((a: { globalPosition: number }) => a.globalPosition)).toEqual([6236, 6235, 6234]);
    expect((await request(app).get(`${base}/ayahs?sort=surah`).set(auth)).status).toBe(400);
    expect((await request(app).get(`${base}/ayahs?foo=1`).set(auth)).status).toBe(400);
    expect((await request(app).get(`${base}/ayahs?page=0`).set(auth)).status).toBe(400);
  });

  it('is documented once, with the existing permission and the same roles as Module 21, and no new permission exists', () => {
    const op = doc.operations.find((o) => o.operationId === operationId)!;
    expect(op).toBeDefined();
    expect([op.method, op.path, op.authorization.authentication, op.authorization.permissionId]).toEqual(['get', '/ayahs', 'required', QuranPermissions.READ]);
    expect(op.authorization.roles).toEqual([...QURAN_READ_ROLES]);
    expect(doc.operations.filter((o) => o.path === '/ayahs')).toHaveLength(1);
    expect(name.length).toBeGreaterThan(0);
  });
});

describe('Memorization and Revision return the same approved Quran dataset', () => {
  it('the same pages, item for item', async () => {
    const m = await createMemorizationApi();
    const r = await createRevisionApi();
    const mAuth = await m.login(await m.t.newSchoolManager((await m.t.newSchool('School')).id));
    const rAuth = await r.login(await r.t.newSchoolManager((await r.t.newSchool('School')).id));
    for (const page of [1, 2, 63]) {
      const a = await request(m.app).get(`${MEMORIZATION}/ayahs`).query({ page, pageSize: 100 }).set(mAuth);
      const b = await request(r.app).get(`${REVISION}/ayahs`).query({ page, pageSize: 100 }).set(rAuth);
      expect(a.status).toBe(200);
      expect(b.body.data).toEqual(a.body.data);
      expect(b.body.meta).toEqual(a.body.meta);
    }
  });
});

// ------------------------------------------------------------------------------------------- architecture
const SRC = path.resolve(__dirname, '../../../src/modules');
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const full = path.join(dir, n);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
const importsOf = (file: string) => [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]!);

describe('architecture: Module 21 stays the single source of Quran data', () => {
  it('Module 21 does not depend on Module 27 or 28 (no reversed dependency)', () => {
    const offending = sourceFiles(path.join(SRC, '21-quran-structure')).filter((f) => importsOf(f).some((s) => /\/(27|28)-[a-z-]+(\/|$)/.test(s)));
    expect(offending).toEqual([]);
  });

  it('Modules 27 and 28 read Quran data only through Module 21\'s public contract, with no Quran table, query or dataset of their own', () => {
    for (const mod of ['27-memorization', '28-revision']) {
      for (const f of sourceFiles(path.join(SRC, mod))) {
        const specs = importsOf(f).filter((s) => /\/21-quran-structure(\/|$)/.test(s));
        expect(specs.filter((s) => !s.endsWith('/21-quran-structure/public')), f).toEqual([]);
        expect(strip(readFileSync(f, 'utf8')), f).not.toMatch(/\bquran_[a-z_]+\b/); // no access to Module 21's tables
      }
    }
  });
});
