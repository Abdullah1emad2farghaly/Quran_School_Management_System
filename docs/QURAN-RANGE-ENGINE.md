# Quran Position & Range Engine (Module 22)

**Status: TESTED (0.30.0).** A pure calculation over Module 21's verified data (Master Specification §47). It stores nothing: **no tables, no migration, no HTTP endpoint, no permission, no domain event.** Other modules use it through `QuranRangeEngine` (`src/modules/22-quran-range-engine/public`); the application wiring is `getQuranRangeEngine()` in `src/config/quran.ts`.

## What it does
`Start position + Unit + Amount + Direction  ->  End position + Generated range`

```ts
const engine = getQuranRangeEngine();            // or: new QuranRangeEngine(quranStructureLookup)
const result = await engine.calculate({
  start: { surah: 114 },                         // a surah alone, or { surah: 2, ayah: 255 }
  unit: 'AYAHS',                                 // SURAHS | AYAHS | QUARTERS | PAGES | LINES
  amount: 10,                                    // a positive integer
  direction: 'BACKWARD',                         // FORWARD | BACKWARD
});
// result.segments -> [{ surah: 113, firstAyah: 2, lastAyah: 5, ayahCount: 4, complete: false },
//                    { surah: 114, firstAyah: 1, lastAyah: 6, ayahCount: 6, complete: true }]
```

| Field | Meaning |
|---|---|
| `request` | The request as understood (`start.ayah` is `null` for a surah-only start). |
| `start` | The ayah the range is **anchored** at. |
| `end` | Where the count ended **in the direction of travel**: the last ayah going FORWARD, the first ayah going BACKWARD. |
| `first`, `last` | The first and last ayah of the range **in Quran order**, whatever the direction. |
| `segments` | The range per surah, **always in Quran order**: `surah, firstAyah, lastAyah, ayahCount, complete` (`complete` = the whole surah). Ranges may cross surahs. |
| `totals` | `ayahs`, `surahs` (= segments), `pages` (first page of the first ayah to last page of the last ayah) and `textLines` (TEXT lines that carry text of the range). |

Ayahs are addressed as `{ surah, ayah }` (and `globalPosition` 1..6236 in the results).

## Approved rules
1. **Start.** `{ surah, ayah }` anchors at that ayah, even when it is ayah 1. `{ surah }` (no ayah) anchors at the surah's **first** ayah going FORWARD and its **last** ayah going BACKWARD. (Approved 2026-10-27: the "start from the surah's end going backward" case is a surah-only start, not a special case of ayah 1.)
2. **Direction.** FORWARD begins at the anchor and moves toward the end of the Quran. BACKWARD **ends** at the anchor (the anchor is included) and moves toward the beginning. Segments are returned in Quran order either way.
3. **Whole ayahs.** A range always consists of whole ayahs.
4. **Units.**
   - **AYAHS:** the amount of ayahs, the anchor included.
   - **SURAHS:** complete surahs. The surah containing the anchor is the first one counted, **in full** (one surah from anywhere inside Al-Baqarah is all 286 ayahs of Al-Baqarah), then the requested number of complete surahs in the direction of travel.
   - **QUARTERS / PAGES:** the quarter/page that contains the anchor is the first one counted (FORWARD: the one where the anchor begins; BACKWARD: where it ends). The range finishes at the end of the final counted unit in the direction of travel. FORWARD from mid-page starts at the anchor and ends at the end of the Nth page (one page from mid-page ends at the end of that same page); BACKWARD mirrors it. A page boundary that falls inside an ayah is rounded **out** to the whole ayah (an ayah that continues on the next page is included). The official edition never splits an ayah across pages, so this only matters for other data.
   - **LINES:** only **TEXT** lines count; surah banner and basmala lines never do. FORWARD counts from the **first** line of the anchor ayah, BACKWARD from its **last** line. The boundary is rounded out to the whole ayah touched by the last counted line, using the real line-to-ayah mapping: a line shared by two ayahs includes both, and an ayah that spans several lines is always included whole.
5. **Boundaries.** A request that goes past the first or last position of the Quran is rejected with `QURAN_RANGE_EXCEEDS_QURAN` (`details.boundary` = `END_OF_QURAN` or `BEGINNING_OF_QURAN`). No wrap-around, no silent clamping.

## Errors (`QuranRangeErrorCodes`, Arabic and English messages registered in `registerAllErrorMessages`)
| Code | Kind | When |
|---|---|---|
| `QURAN_RANGE_UNIT_INVALID` | VALIDATION | The unit is not one of the five. |
| `QURAN_RANGE_DIRECTION_INVALID` | VALIDATION | The direction is not FORWARD/BACKWARD. |
| `QURAN_RANGE_AMOUNT_INVALID` | VALIDATION | The amount is not a positive integer. |
| `QURAN_RANGE_START_INVALID` | VALIDATION | The surah does not exist, or the ayah does not exist in it. |
| `QURAN_RANGE_EXCEEDS_QURAN` | BUSINESS_RULE | The amount goes past the Quran's boundary. |
| `QURAN_RANGE_LAYOUT_INCONSISTENT` | INTERNAL | The imported layout contradicts itself (no range is returned rather than a wrong one). |

The shape of the request is validated **before** any Quran data is read. If no dataset is imported, Module 21's `QURAN_DATASET_NOT_IMPORTED` passes through unchanged.

## Design
- Reads only Module 21's public read contract (`QuranRangeSource` = the `listSurahs`, `getAyah`, `getAyahByGlobalPosition`, `listQuarters`, `getPage` subset of `QuranStructureLookup`). No Module 21 table, repository or internal model is touched; nothing is duplicated.
- Deterministic and stateless: no clock, no randomness, no caching between calls. Within one call each page is read once.
- Cost: AYAHS and SURAHS need a handful of reads; LINES and PAGES read pages in the direction of travel; `totals.textLines` reads the pages the range spans (at most 604).
- A surah or any Quran-shaped source can be supplied, so the engine is testable without a database.

## Tests
`tests/unit/range-engine/` (79 tests, `npm test`):
- `range-engine-units` — exact, hand-computed expectations over a 15-ayah hand-built Quran (`tests/helpers/range-mini-quran.ts`) with an ayah split across lines, a line holding two ayahs, banner/basmala lines and an ayah crossing a page: all five units, both directions, surah-only and ayah starts, starts inside surahs, partial final units, and every boundary.
- `range-engine-structure` — the full 114-surah / 604-page / 240-quarter synthetic structure: the approved An-Nas / Al-Falaq / Al-Ikhlas and Al-Baqarah examples, independent brute-force oracles for every unit, and invariants (segments ordered and contiguous, totals add up, chaining ranges walks the whole Quran exactly once in both directions).
- `range-engine-validation` — every invalid input, and that nothing is read before the request is valid.
- `range-engine-boundaries` — public-contract-only imports, no persistence/HTTP/tables, determinism, error messages.

`tests/db/quran-range-engine.test.ts` (`npm run test:db`): the engine over MariaDB gives exactly the in-memory answers for 400 requests (every unit, direction and start), errors included. It runs inside a transaction that is always rolled back, so a database that already holds the real Quran dataset is left untouched.

## Not verified here
The unit and database tests use the synthetic structure (real Hafs ayah counts, placeholder text, synthetic line/page layout). Results on the real KFGQPC layout (real line-to-ayah mapping) follow the same code but were not run in the build environment.
