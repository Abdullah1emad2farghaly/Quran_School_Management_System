import { SystemClock } from '../modules/00-shared-kernel/public';
import { GeographyService, SeedEgyptGeography, SequelizeGeographyRepository } from '../modules/14-geography/public';
import { getSequelize, getUnitOfWork } from './database';

let repository: SequelizeGeographyRepository | undefined;
let service: GeographyService | undefined;

function getRepository(): SequelizeGeographyRepository {
  repository ??= new SequelizeGeographyRepository(getSequelize());
  return repository;
}

/** Inject into other modules' use cases (read-only: type it as `GeographyLookup`). */
export function getGeographyService(): GeographyService {
  service ??= new GeographyService(getRepository());
  return service;
}

/** Only for the seed CLI (`npm run seed:geography`). */
export function getSeedEgyptGeography(): SeedEgyptGeography {
  return new SeedEgyptGeography({ repository: getRepository(), unitOfWork: getUnitOfWork(), clock: new SystemClock() });
}
