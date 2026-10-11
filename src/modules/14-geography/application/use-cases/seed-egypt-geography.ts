import { SystemClock, type Clock, type TransactionContext, type UnitOfWork } from '../../../00-shared-kernel/public';
import { GeographyNode } from '../../domain/entities/geography-node';
import { EGYPT_COUNTRY_NAME, EGYPT_GOVERNORATE_NAMES } from '../../domain/reference/egypt-reference';
import { formatGeographyCode } from '../../domain/value-objects/geography-code';
import type { CenterKind, GeographyLevel } from '../../domain/value-objects/geography-level';
import type { GeographyRepository } from '../ports/geography-repository';

export interface SeedGeographySummary {
  readonly country: { readonly code: string; readonly created: boolean };
  readonly governorates: { readonly total: number; readonly created: number; readonly existing: number };
}

export interface SeedEgyptGeographyDeps {
  readonly repository: GeographyRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock?: Clock;
}

/**
 * Idempotent V1 reference seed: Egypt and its 27 governorates ONLY (centers, cities and villages are not seeded and
 * the dataset is not complete). One transaction. Existing nodes (same name under the same parent) are left exactly as
 * they are: nothing is renamed, deleted or duplicated. No outbox event is written.
 */
export class SeedEgyptGeography {
  private readonly repository: GeographyRepository;
  private readonly unitOfWork: UnitOfWork;
  private readonly clock: Clock;

  constructor(deps: SeedEgyptGeographyDeps) {
    this.repository = deps.repository;
    this.unitOfWork = deps.unitOfWork;
    this.clock = deps.clock ?? new SystemClock();
  }

  execute(tx?: TransactionContext): Promise<SeedGeographySummary> {
    const work = async (t: TransactionContext): Promise<SeedGeographySummary> => {
      const country = await this.ensure('COUNTRY', null, EGYPT_COUNTRY_NAME, null, t);
      let created = 0;
      for (const name of EGYPT_GOVERNORATE_NAMES) {
        if ((await this.ensure('GOVERNORATE', country.node.id, name, null, t)).created) created += 1;
      }
      return {
        country: { code: country.node.code, created: country.created },
        governorates: { total: EGYPT_GOVERNORATE_NAMES.length, created, existing: EGYPT_GOVERNORATE_NAMES.length - created },
      };
    };
    return tx ? work(tx) : this.unitOfWork.run(work);
  }

  private async ensure(
    level: GeographyLevel,
    parentId: string | null,
    name: string,
    kind: CenterKind | null,
    tx: TransactionContext,
  ): Promise<{ node: GeographyNode; created: boolean }> {
    const existing = await this.repository.findByName(level, parentId, name, kind, tx);
    if (existing) return { node: existing, created: false };
    const code = formatGeographyCode(level, await this.repository.nextCodeSequence(level, tx));
    const node = GeographyNode.create({ level, name, code, parentId, kind: kind ?? undefined, clock: this.clock });
    await this.repository.insert(node, tx);
    return { node, created: true };
  }
}
