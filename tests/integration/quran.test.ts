import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ASSIGNABLE_ROLE_CODES } from '../../src/modules/09-roles-permissions/public';
import { QURAN, createQuranApi } from '../helpers/quran-api-harness';

const GET_PATHS = ['/dataset', '/surahs', '/surahs/1', '/surahs/1/ayahs', '/surahs/1/ayahs/1', '/ayahs/1', '/pages/1', '/juz', '/quarters', '/quarters/1', '/quarter-marks'];

describe('GET /quran: access', () => {
  it('requires authentication on every endpoint', async () => {
    const { app } = await createQuranApi();
    for (const p of GET_PATHS) {
      const res = await request(app).get(`${QURAN}${p}`);
      expect([p, res.status]).toEqual([p, 401]);
    }
  });

  it('lets EVERY assignable role read (all authenticated users), on every endpoint', async () => {
    const api = await createQuranApi();
    for (const role of ASSIGNABLE_ROLE_CODES) {
      const auth = await api.as(role);
      for (const p of GET_PATHS) {
        const res = await request(api.app).get(`${QURAN}${p}`).set(auth);
        expect([role, p, res.status]).toEqual([role, p, 200]);
        expect(res.body.success).toBe(true);
      }
    }
  });

  it('refuses an authenticated account that holds no role', async () => {
    const api = await createQuranApi();
    const res = await request(api.app).get(`${QURAN}/surahs`).set(await api.as());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCESS_DENIED');
  });

  it('exposes no write endpoint: POST, PUT, PATCH and DELETE find no route (the data is immutable through the API)', async () => {
    const api = await createQuranApi();
    const auth = await api.as('MAIN_ADMIN');
    for (const path of ['/surahs', '/surahs/1', '/surahs/1/ayahs/1', '/ayahs/1', '/pages/1', '/dataset', '/quarter-marks']) {
      for (const method of ['post', 'put', 'patch', 'delete'] as const) {
        const res = await request(api.app)[method](`${QURAN}${path}`).set(auth).send({ nameAr: 'x' });
        expect([method, path, res.status]).toEqual([method, path, 404]);
      }
    }
    const surah = await request(api.app).get(`${QURAN}/surahs/1`).set(auth);
    expect(surah.body.data.nameAr).not.toBe('x');
  });
});

describe('GET /quran: before any import', () => {
  it('answers QURAN_DATASET_NOT_IMPORTED (404) on every endpoint', async () => {
    const api = await createQuranApi({ imported: false });
    const auth = await api.as('PARENT');
    for (const p of GET_PATHS) {
      const res = await request(api.app).get(`${QURAN}${p}`).set(auth);
      expect([p, res.status, res.body.error?.code]).toEqual([p, 404, 'QURAN_DATASET_NOT_IMPORTED']);
    }
  });
});

describe('GET /quran: data', () => {
  it('serves the dataset attribution', async () => {
    const api = await createQuranApi();
    const res = await request(api.app).get(`${QURAN}/dataset`).set(await api.as('TEACHER'));
    expect(res.body.data).toMatchObject({ editionCode: 'SYNTHETIC_TEST_EDITION', source: { provider: 'SYNTHETIC TEST DATA' }, counts: { surahs: 114, ayahs: 6236, pages: 604, quarters: 240, quarterMarks: 162 } });
    expect(res.body.data.coverage.quarters).toEqual({ expected: 240, imported: 240 });
    expect(res.body.data.coverage.printedQuarterMarkers).toBe(162);
    expect(res.body.data.source.attributions).toEqual([{ role: 'Synthetic test data', provider: 'tests', name: 'quran-fixture', version: '1', license: null, notice: null }]);
    expect(res.body.data.coverage.juz.total).toBe(30);
    expect(res.body.data.source.files).toEqual([{ name: 'synthetic.json', sha256: 'a'.repeat(64) }]);
  });

  it('serves the surahs, one surah and its ayahs (paginated, sortable)', async () => {
    const api = await createQuranApi();
    const auth = await api.as('SCHOOL_MANAGER');
    const all = await request(api.app).get(`${QURAN}/surahs`).set(auth);
    expect(all.body.data).toHaveLength(114);
    expect(all.body.data[1]).toMatchObject({ number: 2, ayahCount: 286, firstGlobalPosition: 8 });
    expect((await request(api.app).get(`${QURAN}/surahs/114`).set(auth)).body.data).toMatchObject({ number: 114, ayahCount: 6 });

    const ayahs = await request(api.app).get(`${QURAN}/surahs/2/ayahs?pageSize=50&page=2`).set(auth);
    expect(ayahs.status).toBe(200);
    expect(ayahs.body.data).toHaveLength(50);
    expect(ayahs.body.data[0]).toMatchObject({ surah: 2, ayah: 51 });
    expect(ayahs.body.meta).toMatchObject({ page: 2, pageSize: 50, total: 286 });
    const desc = await request(api.app).get(`${QURAN}/surahs/2/ayahs?pageSize=2&sort=-ayah`).set(auth);
    expect(desc.body.data.map((a: { ayah: number }) => a.ayah)).toEqual([286, 285]);
    expect((await request(api.app).get(`${QURAN}/surahs/2/ayahs?sort=surah`).set(auth)).status).toBe(400);
  });

  it('serves an ayah by surah/ayah and by global position, identically', async () => {
    const api = await createQuranApi();
    const auth = await api.as('PARENT');
    const a = await request(api.app).get(`${QURAN}/surahs/3/ayahs/10`).set(auth);
    const b = await request(api.app).get(`${QURAN}/ayahs/${7 + 286 + 10}`).set(auth);
    expect(a.status).toBe(200);
    expect(a.body.data).toEqual(b.body.data);
    expect(a.body.data).toMatchObject({ surah: 3, ayah: 10, globalPosition: 303, startsRubMarker: false });
    expect(a.body.data.text).toContain('۝١٠'); // the official text, verbatim, with its end-of-ayah mark and number
    expect((await request(api.app).get(`${QURAN}/ayahs/6236`).set(auth)).body.data).toMatchObject({ surah: 114, ayah: 6, lastPage: 604, juz: 30, quarter: 240, hizb: 60 });
  });

  it('serves a page with its lines, the juz starts with their evidence status, and the printed quarter markers', async () => {
    const api = await createQuranApi();
    const auth = await api.as('ORGANIZATION_MANAGER');
    const page = await request(api.app).get(`${QURAN}/pages/1`).set(auth);
    expect(page.body.data).toMatchObject({ page: 1, firstAyah: { surah: 1, ayah: 1, globalPosition: 1 } });
    expect(page.body.data.lines).toHaveLength(page.body.data.lineCount);
    expect(page.body.data.lines[0]).toMatchObject({ kind: 'SURAH_HEADER', surah: 1 });
    const juz = await request(api.app).get(`${QURAN}/juz`).set(auth);
    expect(juz.body.data).toHaveLength(30);
    expect(juz.body.data[0]).toMatchObject({ juz: 1, start: { surah: 1, ayah: 1 }, verification: 'SURAH_START_NO_MARKER' });
    expect(juz.body.data.map((j: { verification: string }) => j.verification)).toContain('MARKER_CONFLICT'); // unresolved evidence is exposed, never hidden
    const marks = await request(api.app).get(`${QURAN}/quarter-marks`).set(auth);
    expect(marks.body.data).toHaveLength(162);
    expect(marks.body.data[0]).toMatchObject({ mark: 1 });
    expect(marks.status).toBe(200);
    const quarters = await request(api.app).get(`${QURAN}/quarters`).set(auth);
    expect(quarters.body.data).toHaveLength(240);
    expect(quarters.body.data.map((q: { quarter: number }) => q.quarter)).toEqual(Array.from({ length: 240 }, (_, i) => i + 1));
    expect(quarters.body.data[0]).toMatchObject({ quarter: 1, hizb: 1, start: { surah: 1, ayah: 1 } });
    expect((await request(api.app).get(`${QURAN}/quarters/106`).set(auth)).body.data).toEqual(quarters.body.data[105]);
    expect((await request(api.app).get(`${QURAN}/hizb`).set(auth)).status).toBe(404); // no hizb endpoint in V1
  });
});

describe('GET /quran: errors', () => {
  it('rejects numbers outside the structure with VALIDATION_FAILED (400)', async () => {
    const api = await createQuranApi();
    const auth = await api.as('TEACHER');
    for (const p of ['/surahs/0', '/surahs/115', '/surahs/abc', '/surahs/1.5', '/surahs/01', '/surahs/1/ayahs/0', '/surahs/115/ayahs', '/quarters/0', '/quarters/241', '/ayahs/0', '/ayahs/6237', '/pages/0', '/pages/605']) {
      const res = await request(api.app).get(`${QURAN}${p}`).set(auth);
      expect([p, res.status, res.body.error?.code]).toEqual([p, 400, 'VALIDATION_FAILED']);
    }
  });

  it('answers 404 for a valid number that has no such ayah', async () => {
    const api = await createQuranApi();
    const auth = await api.as('TEACHER');
    const res = await request(api.app).get(`${QURAN}/surahs/1/ayahs/8`).set(auth);
    expect([res.status, res.body.error.code]).toEqual([404, 'QURAN_AYAH_NOT_FOUND']);
    expect((await request(api.app).get(`${QURAN}/surahs/1/ayahs/286`).set(auth)).body.error.code).toBe('QURAN_AYAH_NOT_FOUND');
  });

  it('localizes the error message (Arabic by default, English on request)', async () => {
    const api = await createQuranApi({ imported: false });
    const auth = await api.as('TEACHER');
    const ar = await request(api.app).get(`${QURAN}/surahs`).set(auth);
    const en = await request(api.app).get(`${QURAN}/surahs`).set(auth).set('Accept-Language', 'en');
    expect(ar.body.error.message).toContain('لم يتم استيراد');
    expect(en.body.error.message).toBe('The Quran structure data has not been imported yet.');
  });
});
