import { FixedClock, type TransactionContext, type UnitOfWork } from '../../src/modules/00-shared-kernel/public';
import { ImportQuranDataset, InMemoryQuranStructureRepository, QuranStructureService, validateQuranDataset } from '../../src/modules/21-quran-structure/public';
import { SYNTHETIC_PROFILE, buildSyntheticDataset } from './quran-fixture';

const tx = {} as TransactionContext;
export const validateSynthetic = (raw: unknown) => validateQuranDataset(raw, SYNTHETIC_PROFILE);

/** In-memory Module 21 wiring over the SYNTHETIC dataset (never real Quran data). */
export function createQuranHarness() {
  const repository = new InMemoryQuranStructureRepository();
  const service = new QuranStructureService(repository);
  const unitOfWork: UnitOfWork = { run: (work) => work(tx) };
  const importer = new ImportQuranDataset({ store: repository, unitOfWork, clock: new FixedClock(new Date('2026-10-22T10:00:00Z')) });
  const importSynthetic = (options: { checksum?: string; replace?: boolean; mutate?: (raw: Record<string, unknown>) => void } = {}) => {
    const raw = buildSyntheticDataset();
    options.mutate?.(raw);
    return importer.execute({ raw, checksum: options.checksum ?? 'a'.repeat(64), replace: options.replace ?? false }, validateSynthetic);
  };
  return { repository, service, importer, importSynthetic };
}
