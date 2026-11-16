import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { QURAN, createQuranApi } from '../../helpers/quran-api-harness';
import { ApiConformance } from '../support/conformance';

describe('Module 21 endpoints conform to their OpenAPI documentation (real responses)', () => {
  let api: ApiConformance;
  beforeAll(async () => {
    api = await ApiConformance.create();
  });

  it('every operation, with its success and error responses', async () => {
    const { app, as } = await createQuranApi();
    const auth = await as('PARENT');
    const get = async (path: string, headers: Record<string, string> = auth) => api.conforms(await request(app).get(`${QURAN}${path}`).set(headers));

    expect((await get('/dataset')).status).toBe(200);
    expect((await get('/surahs')).status).toBe(200);
    expect((await get('/surahs/2')).status).toBe(200);
    expect((await get('/surahs/2/ayahs?page=1&pageSize=5&sort=-ayah')).status).toBe(200);
    expect((await get('/surahs/1/ayahs/1')).status).toBe(200);
    expect((await get('/ayahs/6236')).status).toBe(200);
    expect((await get('/pages/1')).status).toBe(200);
    expect((await get('/juz')).status).toBe(200);
    expect((await get('/quarters')).status).toBe(200);
    expect((await get('/quarters/106')).status).toBe(200);
    expect((await get('/quarter-marks')).status).toBe(200);

    // error responses
    for (const path of ['/surahs/0', '/surahs/abc', '/surahs/1/ayahs/0', '/ayahs/6237', '/quarters/0', '/quarters/241', '/pages/605', '/surahs/2/ayahs?sort=surah']) expect((await get(path)).status).toBe(400);
    expect((await get('/surahs/1/ayahs/8')).status).toBe(404); // QURAN_AYAH_NOT_FOUND
    api.conforms(await request(app).get(`${QURAN}/surahs`)); // 401
    expect((await get('/surahs', await as())).status).toBe(403); // no role
  });

  it('documents the not-imported answer on every operation', async () => {
    const { app, as } = await createQuranApi({ imported: false });
    const auth = await as('TEACHER');
    for (const path of ['/dataset', '/surahs', '/surahs/1', '/surahs/1/ayahs', '/surahs/1/ayahs/1', '/ayahs/1', '/pages/1', '/juz', '/quarters', '/quarters/1', '/quarter-marks']) {
      const res = api.conforms(await request(app).get(`${QURAN}${path}`).set(auth));
      expect([path, res.status, res.body.error.code]).toEqual([path, 404, 'QURAN_DATASET_NOT_IMPORTED']);
    }
  });

  it('exercised every documented Module 21 operation', () => {
    expect(api.operationCount('21')).toBe(11);
    api.assertAllExercised('21');
  });
});
