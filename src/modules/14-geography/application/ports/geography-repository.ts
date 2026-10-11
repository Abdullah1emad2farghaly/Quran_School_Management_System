import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { GeographyNode } from '../../domain/entities/geography-node';
import type { CenterKind, GeographyLevel } from '../../domain/value-objects/geography-level';

export interface GeographyRepository {
  /**
   * Throws GEOGRAPHY_NODE_ALREADY_EXISTS (unique name under the parent / unique code) or GEOGRAPHY_PARENT_NOT_FOUND
   * (foreign key). The database constraints are the final guard.
   */
  insert(node: GeographyNode, tx: TransactionContext): Promise<void>;
  findById(level: GeographyLevel, id: string, tx?: TransactionContext): Promise<GeographyNode | undefined>;
  /** Same-name lookup under a parent (`parentId` null for countries); `kind` only for the CENTER level. */
  findByName(level: GeographyLevel, parentId: string | null, name: string, kind: CenterKind | null, tx?: TransactionContext): Promise<GeographyNode | undefined>;
  /** Nodes of `level` under `parentId` (null = all countries), ordered by code. */
  listChildren(level: GeographyLevel, parentId: string | null, tx?: TransactionContext): Promise<GeographyNode[]>;
  /** Next free code sequence for the level (1 for the first). */
  nextCodeSequence(level: GeographyLevel, tx?: TransactionContext): Promise<number>;
}
