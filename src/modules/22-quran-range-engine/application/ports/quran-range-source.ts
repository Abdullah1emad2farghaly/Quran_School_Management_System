import type { QuranStructureLookup } from '../../../21-quran-structure/public';

/**
 * The only thing the Range Engine reads: the read-only Module 21 contract (never its tables). Typed as a subset so the engine can be tested
 * against any Quran-shaped source, and so it cannot reach anything else.
 */
export type QuranRangeSource = Pick<QuranStructureLookup, 'listSurahs' | 'getAyah' | 'getAyahByGlobalPosition' | 'listQuarters' | 'getPage'>;
