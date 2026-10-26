import { SystemClock } from '../modules/00-shared-kernel/public';
import { ImportQuranDataset, QuranStructureService, SequelizeQuranStructureRepository, registerQuranAuthorization } from '../modules/21-quran-structure/public';
import { getAuthorizationPolicyRegistry } from './authorization';
import { getSequelize, getUnitOfWork } from './database';

let repository: SequelizeQuranStructureRepository | undefined;
let service: QuranStructureService | undefined;

function getRepository(): SequelizeQuranStructureRepository {
  repository ??= new SequelizeQuranStructureRepository(getSequelize());
  return repository;
}

/** Inject into other modules' use cases (read-only: type it as `QuranStructureLookup`). */
export function getQuranStructureService(): QuranStructureService {
  service ??= new QuranStructureService(getRepository());
  return service;
}

/** Only for the import CLI (`npm run import:quran`). */
export function getImportQuranDataset(): ImportQuranDataset {
  return new ImportQuranDataset({ store: getRepository(), unitOfWork: getUnitOfWork(), clock: new SystemClock() });
}

/** The read permission is registered ONCE, when this module is loaded, through the shared Authorization Engine (nothing touches the database at import). */
registerQuranAuthorization({ policies: getAuthorizationPolicyRegistry() });
