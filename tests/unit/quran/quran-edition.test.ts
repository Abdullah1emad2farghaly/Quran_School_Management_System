import { describe, expect, it } from 'vitest';
import {
  MADINAH_HAFS_604_PROFILE, QURAN_AYAH_COUNT, QURAN_EDITION_CODE, QURAN_SURAH_COUNT, SURAH_AYAH_COUNTS, ayahPositionOf, firstGlobalAyahOf, globalPositionOf, hizbOfQuarter, isSurahNumber, juzOfQuarter,
} from '../../../src/modules/21-quran-structure/public';

describe('the approved edition constants (verification oracle)', () => {
  it('has 114 surahs whose Hafs ayah counts add up to 6236', () => {
    expect(SURAH_AYAH_COUNTS).toHaveLength(QURAN_SURAH_COUNT);
    expect(SURAH_AYAH_COUNTS.reduce((a, b) => a + b, 0)).toBe(QURAN_AYAH_COUNT);
    expect(SURAH_AYAH_COUNTS[0]).toBe(7); // Al-Fatiha, the basmala counted as ayah 1
    expect(SURAH_AYAH_COUNTS[1]).toBe(286); // Al-Baqarah, the longest
    expect(SURAH_AYAH_COUNTS[113]).toBe(6); // An-Nas
  });

  it('identifies the edition as Madinah Mushaf, Hafs from Asim, 604 pages', () => {
    expect(MADINAH_HAFS_604_PROFILE).toMatchObject({ code: QURAN_EDITION_CODE, mushaf: 'MADINAH_MUSHAF', narration: 'HAFS_AN_ASIM', pageCount: 604 });
  });

  it('maps surah:ayah to the global position and back, for every ayah', () => {
    expect(globalPositionOf(1, 1)).toBe(1);
    expect(globalPositionOf(1, 7)).toBe(7);
    expect(globalPositionOf(2, 1)).toBe(8);
    expect(globalPositionOf(114, 6)).toBe(6236);
    expect(firstGlobalAyahOf(3)).toBe(7 + 286 + 1);
    for (let g = 1; g <= QURAN_AYAH_COUNT; g += 1) {
      const p = ayahPositionOf(g)!;
      expect(globalPositionOf(p.surah, p.ayah)).toBe(g);
    }
  });

  it('refuses positions that are not in the Hafs count', () => {
    expect(globalPositionOf(1, 8)).toBeUndefined();
    expect(globalPositionOf(0, 1)).toBeUndefined();
    expect(globalPositionOf(115, 1)).toBeUndefined();
    expect(globalPositionOf(2, 287)).toBeUndefined();
    expect(globalPositionOf(1.5, 1)).toBeUndefined();
    expect(ayahPositionOf(0)).toBeUndefined();
    expect(ayahPositionOf(6237)).toBeUndefined();
    expect(isSurahNumber(114)).toBe(true);
    expect(isSurahNumber(115)).toBe(false);
    expect(isSurahNumber('1')).toBe(false);
  });

  it('derives hizb and juz from the quarter (4 quarters per hizb, 8 per juz)', () => {
    expect([1, 4, 5, 240].map(hizbOfQuarter)).toEqual([1, 1, 2, 60]);
    expect([1, 8, 9, 233, 240].map(juzOfQuarter)).toEqual([1, 1, 2, 30, 30]);
  });
});
