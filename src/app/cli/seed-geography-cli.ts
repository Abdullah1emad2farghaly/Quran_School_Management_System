import { AppError } from '../../modules/00-shared-kernel/public';
import type { SeedEgyptGeography } from '../../modules/14-geography/public';
import { EXIT_FAILED, EXIT_OK } from './bootstrap-main-admin-cli';

export interface SeedGeographyCliDeps {
  readonly seeder: Pick<SeedEgyptGeography, 'execute'>;
  readonly describeCode?: (code: string) => string | undefined;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/** Idempotent reference seed. No prompts. Exit codes: 0 ok (created or already there), 1 failed (nothing changed). */
export async function runSeedGeographyCli(deps: SeedGeographyCliDeps): Promise<number> {
  try {
    const { country, governorates } = await deps.seeder.execute();
    deps.out(`Country: ${country.code} (${country.created ? 'created' : 'already existed'}).`);
    deps.out(`Governorates: ${governorates.created} created, ${governorates.existing} already existed (${governorates.total} in the reference list).`);
    deps.out('Reference seed only: centers, cities and villages are NOT included; this is not a complete geography dataset.');
    return EXIT_OK;
  } catch (error) {
    if (error instanceof AppError) {
      const text = deps.describeCode?.(error.code);
      deps.err(`Geography was not seeded (nothing changed). [${error.code}]${text ? ` ${text}` : ''}`);
    } else {
      deps.err(`Geography was not seeded (nothing changed). Unexpected error (${error instanceof Error ? error.name : 'UnknownError'}); check that npm run db:migrate has been run.`);
    }
    return EXIT_FAILED;
  }
}
