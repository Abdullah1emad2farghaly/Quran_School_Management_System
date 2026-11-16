import { describe, expect, it } from 'vitest';
import { ImportQuranDataset, QuranDatasetValidationError, type QuranDatasetStore } from '../../../src/modules/21-quran-structure/public';
import { FixedClock } from '../../../src/modules/00-shared-kernel/public';
import { buildSyntheticDataset } from '../../helpers/quran-fixture';
import { createQuranHarness, validateSynthetic } from '../../helpers/quran-service-harness';

const B = 'b'.repeat(64);

describe('ImportQuranDataset (repeatable, idempotent, all-or-nothing)', () => {
  it('imports a valid dataset the first time and records the attribution', async () => {
    const { importSynthetic, repository } = createQuranHarness();
    const summary = await importSynthetic();
    expect(summary).toMatchObject({ outcome: 'IMPORTED', checksum: 'a'.repeat(64), counts: { surahs: 114, ayahs: 6236, pages: 604, quarters: 240, quarterMarks: 162 } });
    expect(repository.imports).toHaveLength(1);
    expect((await repository.findActiveImport())!.source.provider).toBe('SYNTHETIC TEST DATA');
  });

  it('is idempotent: the same file again changes nothing', async () => {
    const { importSynthetic, repository } = createQuranHarness();
    await importSynthetic();
    expect((await importSynthetic()).outcome).toBe('UNCHANGED');
    expect((await importSynthetic({ replace: true })).outcome).toBe('UNCHANGED');
    expect(repository.imports).toHaveLength(1);
  });

  it('refuses to replace a different dataset without explicit confirmation, and keeps the active one', async () => {
    const { importSynthetic, repository } = createQuranHarness();
    await importSynthetic();
    await expect(importSynthetic({ checksum: B, mutate: (d) => ((d.source as Record<string, unknown>).version = '2') })).rejects.toMatchObject({ code: 'QURAN_DATASET_REPLACEMENT_NOT_CONFIRMED', kind: 'CONFLICT' });
    expect((await repository.findActiveImport())!.checksum).toBe('a'.repeat(64));
    expect((await repository.findActiveImport())!.source.version).toBe('1');
  });

  it('replaces the active dataset only with replace: true', async () => {
    const { importSynthetic, repository } = createQuranHarness();
    await importSynthetic();
    expect((await importSynthetic({ checksum: B, replace: true, mutate: (d) => ((d.source as Record<string, unknown>).version = '2') })).outcome).toBe('REPLACED');
    expect(await repository.findActiveImport()).toMatchObject({ checksum: B, source: { version: '2' } });
    expect(repository.imports).toHaveLength(2);
  });

  it('never touches the store when the dataset is invalid (an incomplete dataset cannot replace a valid one)', async () => {
    const { importSynthetic, importer, repository } = createQuranHarness();
    await importSynthetic();
    const broken = buildSyntheticDataset() as Record<string, any>;
    broken.lines.splice(500, 3);
    await expect(importer.execute({ raw: broken, checksum: B, replace: true }, validateSynthetic)).rejects.toBeInstanceOf(QuranDatasetValidationError);
    expect(repository.imports).toHaveLength(1);
    expect((await repository.findActiveImport())!.checksum).toBe('a'.repeat(64));
  });

  it('also rejects a dataset invalid for the REAL edition before the database is reached', async () => {
    const calls: string[] = [];
    const store: QuranDatasetStore = {
      findActiveImportForUpdate: async () => void calls.push('lock'),
      replaceDataset: async () => void calls.push('replace'),
    } as unknown as QuranDatasetStore;
    const importer = new ImportQuranDataset({ store, unitOfWork: { run: (w) => w({} as never) }, clock: new FixedClock(new Date()) });
    // default validator = the real Madinah profile: the synthetic dataset is not that edition
    await expect(importer.execute({ raw: buildSyntheticDataset(), checksum: B, replace: false })).rejects.toBeInstanceOf(QuranDatasetValidationError);
    expect(calls).toEqual([]);
  });

  it('lets a failing store propagate so the unit of work rolls back (the previous dataset survives)', async () => {
    const { importSynthetic, repository } = createQuranHarness();
    await importSynthetic();
    const original = repository.replaceDataset.bind(repository);
    repository.replaceDataset = async () => {
      throw new Error('boom');
    };
    await expect(importSynthetic({ checksum: B, replace: true, mutate: (d) => ((d.source as Record<string, unknown>).version = '2') })).rejects.toThrow();
    repository.replaceDataset = original;
    expect((await repository.findActiveImport())!.checksum).toBe('a'.repeat(64));
  });
});
