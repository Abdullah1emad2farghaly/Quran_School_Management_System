import { describe, expect, it } from 'vitest';
import { QURAN_AYAH_COUNT, ayahPositionOf } from '../../../src/modules/21-quran-structure/public';
import { createQuranHarness } from '../../helpers/quran-service-harness';
import { syntheticAyahText } from '../../helpers/quran-fixture';

describe('QuranStructureService.listAyahs (all ayahs of the approved edition, paged)', () => {
  it('needs an imported dataset (a consumer never silently gets an empty Quran)', async () => {
    const { service } = createQuranHarness();
    await expect(service.listAyahs({ page: 1, pageSize: 10 })).rejects.toMatchObject({ code: 'QURAN_DATASET_NOT_IMPORTED' });
  });

  it('pages the complete dataset in canonical order with the 6236 total, ascending and descending', async () => {
    const { service, importSynthetic } = createQuranHarness();
    await importSynthetic();
    const first = await service.listAyahs({ page: 1, pageSize: 100 });
    expect(first.total).toBe(QURAN_AYAH_COUNT);
    expect(first.totalPages).toBe(Math.ceil(QURAN_AYAH_COUNT / 100));
    expect(first.items.map((a) => a.globalPosition)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    const last = await service.listAyahs({ page: 63, pageSize: 100 });
    expect(last.items).toHaveLength(36);
    expect(last.items.at(-1)!.globalPosition).toBe(QURAN_AYAH_COUNT);
    const desc = await service.listAyahs({ page: 1, pageSize: 3 }, 'desc');
    expect(desc.items.map((a) => a.globalPosition)).toEqual([6236, 6235, 6234]);
  });

  it('every item is exactly the existing Module 21 ayah: same identifiers, same text, same DTO as getAyah / getAyahByGlobalPosition', async () => {
    const { service, importSynthetic } = createQuranHarness();
    await importSynthetic();
    const seen: number[] = [];
    for (let page = 1; page <= 63; page += 1) {
      const result = await service.listAyahs({ page, pageSize: 100 });
      for (const ayah of result.items) {
        seen.push(ayah.globalPosition);
        const position = ayahPositionOf(ayah.globalPosition)!;
        expect([ayah.surah, ayah.ayah]).toEqual([position.surah, position.ayah]); // identifiers are consistent with the canonical order
        expect(ayah.text).toBe(syntheticAyahText(ayah.surah, ayah.ayah)); // the stored text, byte for byte
      }
    }
    expect(seen).toEqual(Array.from({ length: QURAN_AYAH_COUNT }, (_, i) => i + 1)); // no gap, no duplicate
    for (const g of [1, 7, 8, 293, 6236]) {
      const listed = (await service.listAyahs({ page: g, pageSize: 1 })).items[0]!;
      expect(listed).toEqual(await service.getAyahByGlobalPosition(g));
      expect(listed).toEqual(await service.getAyah(listed.surah, listed.ayah));
    }
  });

  it('returns the same ayahs as the per-surah listing (no second source of truth)', async () => {
    const { service, importSynthetic } = createQuranHarness();
    await importSynthetic();
    const bySurah = (await service.listAyahsOfSurah(2, { page: 1, pageSize: 100 })).items;
    const global = (await service.listAyahs({ page: 1, pageSize: 100 })).items.filter((a) => a.surah === 2);
    expect(global).toEqual(bySurah.slice(0, global.length));
  });
});
